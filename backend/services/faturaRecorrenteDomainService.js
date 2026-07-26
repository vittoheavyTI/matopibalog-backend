// backend/services/faturaRecorrenteDomainService.js
// Frente #5 (Billing v2) — PR 2: regras PURAS de domínio da FATURA RECORRENTE
// mensal. Sem I/O: não toca banco, não fala com o Asaas, não cria fatura, não
// importa supabase. Apenas DECIDE elegibilidade e MONTA payload/snapshot — no
// mesmo estilo testável de upgradeDomainService, paymentDomainService e
// planoPrecoService.
//
// NINGUÉM importa este módulo em runtime neste PR. Ele é CÓDIGO MORTO de
// propósito: o job que o consumirá (buscar empresas, inserir fatura, criar
// cobrança no Asaas) é um PR posterior. Aqui só mora a decisão, para que ela
// seja provável sem rede/DB.
//
// APOIA-SE EM DUAS TRAVAS DO BANCO (migration 031, já aplicada):
//   * CHECK dia-1: periodo_referencia, quando existe, é o 1º dia do mês;
//   * índice único parcial ux_faturas_recorrente_empresa_periodo em
//     (empresa_id, periodo_referencia) WHERE origem='recorrente' — no máximo UMA
//     fatura recorrente por empresa e competência.
// A lógica abaixo é o espelho em código dessas travas: gera período sempre no
// dia 1, e só considera colisão as faturas com origem='recorrente' do mesmo mês.

// Único estado de conta cobrável na recorrência. Fail-closed: trial, suspenso,
// e qualquer outro (expirado/bloqueado/desconhecido) NÃO são cobrados neste PR.
// Trial fica de fora por decisão de produto (cobrar trial exige decisão à parte).
const STATUS_COBRAVEL = new Set(['ativo']);

// MVP: apenas PIX (mesma decisão de produto do upgrade).
const TIPO_PAGAMENTO = 'PIX';

// Origem que marca a fatura como nascida do fluxo recorrente. É este valor que o
// índice único parcial da 031 observa.
const ORIGEM_RECORRENTE = 'recorrente';

// Teto comercial padrão (motoristas/caminhões) acima do qual não há preço de
// tabela — é "sob proposta". Espelha LIMITE_NEGOCIACAO_PADRAO da
// calculadoraComercialService de propósito: este módulo é ZERO-REQUIRE (pura
// decisão, sem I/O e sem acoplar a calculadora). A regra "acima do teto → sob
// proposta" é um invariante comercial estável; um plano pode declarar o seu
// próprio teto em `limite_negociacao`.
const LIMITE_NEGOCIACAO_PADRAO = 40;

// Motivos de decisão (estáveis, para log/telemetria do job futuro).
const MOTIVOS = Object.freeze({
  OK: 'ok',
  EMPRESA_AUSENTE: 'empresa_ausente',
  EMPRESA_ARQUIVADA: 'empresa_arquivada',
  PERIODO_INVALIDO: 'periodo_invalido',
  STATUS_NAO_COBRAVEL: 'empresa_status_nao_cobravel',
  ASSINATURA_ASAAS_EXISTENTE: 'assinatura_asaas_existente',
  CUSTOMER_ASAAS_AUSENTE: 'customer_asaas_ausente',
  PLANO_INVALIDO: 'plano_invalido',
  PLANO_GRATUITO: 'plano_gratuito',
  // Plano marcado como sob negociação (Enterprise): não tem preço de tabela, então
  // a recorrência self-service NÃO cobra — o valor é fechado fora do fluxo automático.
  PLANO_REQUER_NEGOCIACAO: 'plano_requer_negociacao',
  // A quantidade contratada estoura o teto comercial do plano (> limite_negociacao,
  // padrão 40): acima disso é "sob proposta", sem preço de tabela para cobrar.
  QUANTIDADE_REQUER_NEGOCIACAO: 'quantidade_requer_negociacao',
  FATURA_RECORRENTE_JA_EXISTE: 'fatura_recorrente_ja_existe',
});

// Teto de negociação efetivo do plano: o próprio (se declarar um inteiro >= 1) ou
// o padrão global. Réplica mínima e estável de tetoNegociacao da calculadora,
// mantida aqui para preservar a pureza zero-require deste módulo.
function tetoNegociacaoDe(plano) {
  const doPlano = plano && plano.limite_negociacao;
  if (typeof doPlano === 'number' && Number.isInteger(doPlano) && doPlano >= 1) return doPlano;
  return LIMITE_NEGOCIACAO_PADRAO;
}

// Normaliza qualquer entrada de data para um Date válido, ou null.
// Aceita Date ou string/number parseável. Não muta a entrada.
function paraData(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }
  if (typeof valor === 'string' || typeof valor === 'number') {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Retorna o 1º dia do mês de `data`, no formato 'YYYY-MM-DD'.
// Calculado em UTC de propósito: assim '2026-07-01' não vira '2026-06-30' num
// fuso negativo. Sempre dia 01 → compatível com o CHECK dia-1 da migration 031.
// Retorna null se a data for inválida (o caller decide o que fazer).
function calcularPeriodoReferencia(data) {
  const d = paraData(data);
  if (!d) return null;
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}-01`;
}

// due_date = referência + 7 dias, em 'YYYY-MM-DD' (mesma convenção do upgrade,
// upgradeRequestService.dueDatePadrao). Puro: não usa "agora", deriva da
// referência recebida.
function calcularDueDate(dataReferencia) {
  const d = paraData(dataReferencia);
  if (!d) return null;
  const venc = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  return venc.toISOString().slice(0, 10);
}

// client_request_id determinístico por empresa e competência:
//   recorrente:<empresa_id>:YYYY-MM
// Duas execuções do mesmo mês para a mesma empresa geram a MESMA chave — segunda
// camada de idempotência, sobre o índice único de faturas.client_request_id
// (migration 021), além do índice parcial (empresa_id, periodo_referencia) da 031.
function montarClientRequestId(empresaId, periodoReferencia) {
  const anoMes = String(periodoReferencia || '').slice(0, 7); // 'YYYY-MM'
  return `${ORIGEM_RECORRENTE}:${empresaId}:${anoMes}`;
}

// Snapshot da composição do preço, CONGELADO na cobrança (migration 030).
// RÉPLICA COMPORTAMENTAL de upgradeRequestService.montarSnapshotFatura — copiada
// de propósito para manter este módulo livre de I/O (importar aquele serviço
// puxaria crypto/asaasSubscriptionService no require). O teste de PARIDADE prova
// que os dois produzem o mesmo objeto para as mesmas entradas.
//
// fixo          → unitário e quantidade NULL (não houve conta; o valor foi digitado);
// por_motorista → unitário=preco_por_motorista, quantidade=limite_motoristas.
// O `valor` final NÃO sai daqui: vem de plano.preco_mensal (já derivado pelo backend).
// `extras` (opcional, mega-frente extras por empresa): quando presente, congela a
// composição base+extras na fatura — quantidade_snapshot passa a ser a quantidade
// CONTRATADA, e grava capacidade_inclusa/quantidade_extra/valor_extra + o unitário
// do extra. Ausente → comportamento idêntico ao anterior (compat).
function montarSnapshotFaturaRecorrente(plano, extras = null) {
  const p = plano || {};
  const porMotorista = p.modelo_cobranca === 'por_motorista';
  const base = {
    plano_id: p.id || null,
    plano_nome_snapshot: p.nome != null ? String(p.nome) : null,
    modelo_cobranca_snapshot: porMotorista ? 'por_motorista' : 'fixo',
    preco_unitario_snapshot:
      porMotorista && p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
    quantidade_snapshot:
      porMotorista && p.limite_motoristas != null ? Number(p.limite_motoristas) : null,
  };
  if (!extras) return base;
  return {
    ...base,
    quantidade_snapshot: extras.quantidade_contratada != null ? Number(extras.quantidade_contratada) : base.quantidade_snapshot,
    capacidade_inclusa_snapshot: extras.capacidade_inclusa != null ? Number(extras.capacidade_inclusa) : null,
    quantidade_extra_snapshot: extras.quantidade_extra != null ? Number(extras.quantidade_extra) : null,
    valor_extra_snapshot: extras.valor_extra != null ? Number(extras.valor_extra) : null,
    // unitário do extra, quando houve extra (informativo — o base é preco_mensal).
    preco_unitario_snapshot: extras.preco_motorista_extra != null ? Number(extras.preco_motorista_extra) : base.preco_unitario_snapshot,
  };
}

// Preço numérico do plano (ou NaN).
function precoDe(plano) {
  return Number(plano && plano.preco_mensal);
}

// Já existe, entre as faturas conhecidas da empresa, uma RECORRENTE deste mesmo
// período? Só conta origem='recorrente' com periodo_referencia igual — faturas de
// upgrade/manual/importadas (origem NULL ou outra) NÃO bloqueiam, exatamente como
// o índice único parcial da 031. periodo_referencia é comparado pelos 10 chars
// 'YYYY-MM-DD' (o banco pode devolver 'YYYY-MM-DDT00:00:00').
function existeRecorrenteNoPeriodo(faturasExistentes, periodo) {
  if (!Array.isArray(faturasExistentes) || !periodo) return false;
  return faturasExistentes.some(
    (f) =>
      f &&
      f.origem === ORIGEM_RECORRENTE &&
      String(f.periodo_referencia || '').slice(0, 10) === periodo
  );
}

// Decide se a empresa deve receber fatura recorrente na competência de
// `dataReferencia`. Sem banco e sem Asaas: recebe os dados prontos.
//
// Retorna { resultado, motivo, elegivel, periodo, status? }, onde:
//   resultado = 'cobrar' → gerar a fatura (elegivel: true);
//   resultado = 'pular'  → não cobrar agora, situação esperada/benigna;
//   resultado = 'erro'   → entrada malformada; o job deve sinalizar, não cobrar.
//
// Parâmetros:
//   empresa           → { id, status, asaas_customer_id, asaas_subscription_id }
//   plano             → { id, nome, ativo, arquivado_em, preco_mensal, modelo_cobranca,
//                         preco_por_motorista, limite_motoristas } | null
//   faturasExistentes → array de faturas já conhecidas da empresa (para dedupe)
//   dataReferencia    → Date|string; a competência é derivada dela (dia 1)
function avaliarElegibilidadeFaturaRecorrente({ empresa, plano, faturasExistentes, dataReferencia }) {
  // 1. Empresa precisa existir.
  if (!empresa || !empresa.id) {
    return { resultado: 'erro', motivo: MOTIVOS.EMPRESA_AUSENTE, elegivel: false, periodo: null };
  }

  // 2. Período precisa ser derivável (e cairá sempre no dia 1).
  const periodo = calcularPeriodoReferencia(dataReferencia);
  if (!periodo) {
    return { resultado: 'erro', motivo: MOTIVOS.PERIODO_INVALIDO, elegivel: false, periodo: null };
  }

  // 2.5 Conta arquivada (tirada da operação) NÃO é cobrada — nunca. arquivada_em
  // só existe após a migration 036; antes disso é undefined e ninguém é pulado
  // por este motivo (deploy-safe).
  if (empresa.arquivada_em != null) {
    return { resultado: 'pular', motivo: MOTIVOS.EMPRESA_ARQUIVADA, elegivel: false, periodo };
  }

  // 3. Estado da conta: só 'ativo' cobra (fail-closed; trial não cobra neste PR).
  const status = empresa.status || null;
  if (!STATUS_COBRAVEL.has(status)) {
    return { resultado: 'pular', motivo: MOTIVOS.STATUS_NAO_COBRAVEL, elegivel: false, periodo, status };
  }

  // 4. Já tem assinatura Asaas → o motor recorrente não cobra (evita duplicidade
  //    com a cobrança recorrente da própria assinatura).
  if (empresa.asaas_subscription_id) {
    return { resultado: 'pular', motivo: MOTIVOS.ASSINATURA_ASAAS_EXISTENTE, elegivel: false, periodo };
  }

  // 5. Sem cliente Asaas não há como cobrar agora. Situação recuperável (o job
  //    futuro pode criar o customer antes) → pular, não erro.
  if (!empresa.asaas_customer_id) {
    return { resultado: 'pular', motivo: MOTIVOS.CUSTOMER_ASAAS_AUSENTE, elegivel: false, periodo };
  }

  // 6. Plano precisa existir, estar ativo e não arquivado.
  if (!plano || !plano.id || plano.ativo === false || plano.arquivado_em != null) {
    return { resultado: 'pular', motivo: MOTIVOS.PLANO_INVALIDO, elegivel: false, periodo };
  }

  // 6.5 Plano sob negociação (Enterprise): não há preço de tabela para o motor
  // automático cobrar — o valor é fechado fora do self-service. ANTES da checagem
  // de preço, para dar o motivo correto mesmo quando o placeholder do plano é 0.
  // Fecha a borda em que, sem esta trava, a recorrência cairia no fallback
  // preco_mensal e cobraria um valor que não é o negociado.
  if (plano.requer_negociacao === true) {
    return { resultado: 'pular', motivo: MOTIVOS.PLANO_REQUER_NEGOCIACAO, elegivel: false, periodo };
  }

  // 7. Plano gratuito / sem preço válido não gera cobrança.
  const preco = precoDe(plano);
  if (!Number.isFinite(preco) || preco <= 0) {
    return { resultado: 'pular', motivo: MOTIVOS.PLANO_GRATUITO, elegivel: false, periodo };
  }

  // 7.5 Quantidade contratada acima do teto comercial do plano → sob proposta.
  // Sem preço de tabela para a quantidade, a recorrência NÃO cobra (evita o
  // fallback silencioso para preco_mensal, que cobraria só a base ignorando o
  // excedente). Só se aplica quando há quantidade contratada declarada; planos
  // normais (sem quantidade ou dentro do teto) seguem inalterados.
  const qtd = empresa.quantidade_contratada;
  if (qtd != null && Number.isFinite(Number(qtd)) && Number(qtd) > tetoNegociacaoDe(plano)) {
    return { resultado: 'pular', motivo: MOTIVOS.QUANTIDADE_REQUER_NEGOCIACAO, elegivel: false, periodo };
  }

  // 8. Já existe fatura recorrente desta competência → idempotência.
  if (existeRecorrenteNoPeriodo(faturasExistentes, periodo)) {
    return { resultado: 'pular', motivo: MOTIVOS.FATURA_RECORRENTE_JA_EXISTE, elegivel: false, periodo };
  }

  return { resultado: 'cobrar', motivo: MOTIVOS.OK, elegivel: true, periodo };
}

// Monta o OBJETO LÓGICO da fatura recorrente. NÃO insere nada. Campos que só o
// Asaas conhece (asaas_id, invoice_url, pix_qr_code) ficam para o PR do job.
// `valor` vem de plano.preco_mensal — nunca recalculado aqui.
//
// Chamar somente quando avaliarElegibilidade... retornou resultado 'cobrar'.
// Ainda assim é puro: se receber lixo, monta o objeto correspondente.
// `valorEfetivo` (opcional): valor total base+extras (mega-frente extras por
// empresa). Quando informado (>0), é o `valor` da fatura; senão cai para
// plano.preco_mensal (compat forward-safe: com quantidade = capacidade inclusa,
// valorEfetivo == preco_mensal). `extras` alimenta o snapshot da composição.
function montarPayloadFaturaRecorrente({ empresa, plano, dataReferencia, valorEfetivo = null, extras = null }) {
  const empresaId = empresa && empresa.id ? empresa.id : null;
  const periodo = calcularPeriodoReferencia(dataReferencia);
  const valor = valorEfetivo != null && Number.isFinite(Number(valorEfetivo)) && Number(valorEfetivo) > 0
    ? Number(valorEfetivo)
    : precoDe(plano);
  return {
    empresa_id: empresaId,
    valor,
    tipo_pagamento: TIPO_PAGAMENTO,
    status: 'pendente',
    due_date: calcularDueDate(dataReferencia),
    periodo_referencia: periodo,
    origem: ORIGEM_RECORRENTE,
    client_request_id: montarClientRequestId(empresaId, periodo),
    ...montarSnapshotFaturaRecorrente(plano, extras),
  };
}

module.exports = {
  STATUS_COBRAVEL,
  TIPO_PAGAMENTO,
  ORIGEM_RECORRENTE,
  LIMITE_NEGOCIACAO_PADRAO,
  MOTIVOS,
  tetoNegociacaoDe,
  calcularPeriodoReferencia,
  calcularDueDate,
  montarClientRequestId,
  montarSnapshotFaturaRecorrente,
  existeRecorrenteNoPeriodo,
  avaliarElegibilidadeFaturaRecorrente,
  montarPayloadFaturaRecorrente,
};

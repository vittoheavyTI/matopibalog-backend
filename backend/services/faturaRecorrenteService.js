// backend/services/faturaRecorrenteService.js
// Frente #5 (Billing v2) — PR 3: geração de FATURA RECORRENTE mensal em SANDBOX.
//
// Este é o primeiro serviço da frente que toca I/O e o caminho do dinheiro.
// Injeção de dependências (supabase, http, config) para ser testável sem rede/DB
// — mesmo estilo de upgradeRequestService/asaasSubscriptionService. O gate hard
// de sandbox (bloquearSeNaoSandbox) fica na ROTA, ANTES de chamar este serviço.
//
// A DECISÃO (elegibilidade, período, payload, snapshot) vem inteira do domínio
// puro faturaRecorrenteDomainService. Aqui mora só o I/O e a COREOGRAFIA segura
// contra duplicidade.
//
// ORDEM SEGURA — RESERVA-PRIMEIRO + RECONCILIAÇÃO POR externalReference
// (decisão de produto do PR 3): para a recorrência, o pior caso é cobrar a mesma
// empresa/competência duas vezes. Uma reserva local sem asaas_id é recuperável;
// uma cobrança Asaas órfã, não. Por isso a fatura local nasce PRIMEIRO (status
// 'pendente', asaas_id NULL), ancorada pelas duas travas de unicidade do banco
// (021 client_request_id; 031 (empresa_id, periodo_referencia) WHERE
// origem='recorrente'). Só então criamos a cobrança no Asaas — e, antes de criar,
// procuramos um payment já existente pela externalReference determinística, para
// que um retry reutilize em vez de cobrar de novo.
//
// NÃO faz (travas do PR 3): assinatura Asaas (garantirAssinatura/subscriptions),
// aplicação de plano, suspensão de empresa, webhook, job/cron. Cobrança é sempre
// AVULSA (POST /payments), nunca assinatura.

const {
  ORIGEM_RECORRENTE,
  MOTIVOS,
  calcularPeriodoReferencia,
  avaliarElegibilidadeFaturaRecorrente,
  montarPayloadFaturaRecorrente,
} = require('./faturaRecorrenteDomainService');
const { garantirCustomer } = require('./asaasSubscriptionService');
const { derivarValorEfetivoFatura } = require('./calculadoraComercialService');
const { normalizarStatusAsaas } = require('./paymentDomainService');
const { podeCriarCobranca, MOTIVO_CADASTRO_INCOMPLETO } = require('../utils/cadastroAsaas');

const TIPO_PAGAMENTO = 'PIX';

function headersAsaas(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

// Erro recuperável (o caller/endpoint reporta; o retry re-executa e reconcilia).
// motivo é estável para telemetria; recuperavel=true significa "reserva pode
// ter ficado sem asaas_id; rodar de novo completa sem duplicar".
function erroServico(motivo, recuperavel = false) {
  const e = new Error(motivo);
  e.motivo = motivo;
  e.recuperavel = recuperavel;
  return e;
}

// Colunas lidas da empresa: elegibilidade + o que garantirCustomer precisa.
const CAMPOS_EMPRESA =
  'id, status, asaas_customer_id, asaas_subscription_id, plano_id, nome, cnpj, email_contato, telefone_contato';

// Snapshot do plano vive na fatura (migration 030). Aqui só carregamos o plano
// e deixamos o domínio montar o snapshot dentro do payload.
const CAMPOS_PLANO =
  'id, nome, ativo, arquivado_em, preco_mensal, modelo_cobranca, preco_por_motorista, limite_motoristas, capacidade_inclusa, preco_motorista_extra';

function planoDe(empresa) {
  const p = empresa && empresa.planos;
  return Array.isArray(p) ? (p[0] || null) : (p || null);
}

// SELECT das empresas candidatas à recorrência (com o plano no join, no formato
// que o domínio espera). Exportado para ser reutilizado pelo job one-shot sem
// duplicar a string de select. NÃO decide elegibilidade fina (isso é do domínio,
// dentro do lote) — só faz o recorte grosso e barato no banco.
// `*` (em vez de CAMPOS_EMPRESA) traz arquivada_em SÓ SE a coluna existir
// (deploy-safe: antes da migration 036 a coluna some do retorno, sem erro). É
// superset das colunas que o domínio usa — nada quebra.
const SELECT_EMPRESA_RECORRENTE =
  `*, planos(id, nome, ativo, arquivado_em, preco_mensal, modelo_cobranca, preco_por_motorista, limite_motoristas, capacidade_inclusa, preco_motorista_extra)`;

// Seleciona empresas ATIVAS, SEM assinatura Asaas, com o plano carregado.
// `allowlist` (array de UUIDs) é OBRIGATÓRIA para o job: quando passada, restringe
// a esses ids; recorte grosso + fail-closed do caller garantem que ninguém fora
// da lista é tocado. `limite` limita o lote. NÃO filtra por período/plano pago —
// isso o domínio decide por empresa no lote (com os motivos corretos).
async function selecionarEmpresasRecorrentes(supabase, { allowlist = null, limite = 20 } = {}) {
  let query = supabase
    .from('empresas')
    .select(SELECT_EMPRESA_RECORRENTE)
    .eq('status', 'ativo')
    .is('asaas_subscription_id', null);
  if (Array.isArray(allowlist)) {
    // Sentinela impossível quando a lista está vazia — não retorna ninguém
    // (fail-closed), embora o job já aborte antes nesse caso.
    query = query.in('id', allowlist.length ? allowlist : ['00000000-0000-0000-0000-000000000000']);
  }
  const { data, error } = await query.limit(limite);
  if (error) throw erroServico('erro_selecionar_empresas');
  return data || [];
}

// Faturas recorrentes já existentes desta empresa (só o necessário para o
// domínio decidir dedupe por período).
async function carregarFaturasRecorrentes(supabase, empresaId) {
  const { data, error } = await supabase
    .from('faturas')
    .select('id, origem, periodo_referencia, client_request_id, asaas_id, status, valor, tipo_pagamento, invoice_url, due_date')
    .eq('empresa_id', empresaId)
    .eq('origem', ORIGEM_RECORRENTE);
  if (error) throw erroServico('erro_consulta_faturas');
  return data || [];
}

async function buscarFaturaPorClientRequestId(supabase, clientRequestId) {
  const { data, error } = await supabase
    .from('faturas')
    .select('*')
    .eq('client_request_id', clientRequestId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw erroServico('erro_consulta_fatura');
  return data || null;
}

// PIX copia-e-cola (best-effort). Falha aqui não invalida a cobrança.
async function obterPixQrCode(http, config, paymentId) {
  try {
    const { data } = await http.get(
      `${config.baseURL}/payments/${paymentId}/pixQrCode`,
      { headers: headersAsaas(config.apiKey) }
    );
    return (data && data.payload) || null;
  } catch (_) {
    return null;
  }
}

// Reconciliação: já existe no Asaas um payment para esta externalReference
// (= client_request_id determinístico)? Cobre "payment criado mas o update local
// falhou". 404/erro de rede → null (o caller então cria). Best-effort, nunca
// lança: na dúvida, seguimos para criar (e a unicidade local ainda protege a
// fatura; o risco remanescente é sandbox).
async function buscarPaymentPorReferencia(http, config, clientRequestId) {
  try {
    const { data } = await http.get(`${config.baseURL}/payments`, {
      headers: headersAsaas(config.apiKey),
      params: { externalReference: clientRequestId },
    });
    const lista = (data && data.data) || [];
    return lista[0] || null;
  } catch (_) {
    return null;
  }
}

// Cria a cobrança avulsa no Asaas (PIX). externalReference = client_request_id.
async function criarPaymentAsaas({ http, config, customerId, valor, dueDate, periodo, clientRequestId, planoNome }) {
  try {
    const { data } = await http.post(
      `${config.baseURL}/payments`,
      {
        customer: customerId,
        value: valor,
        description: `Assinatura Matopiba Log — ${planoNome || 'plano'} — competência ${periodo}`,
        dueDate,
        postalService: false,
        billingType: 'PIX',
        externalReference: clientRequestId,
      },
      { headers: headersAsaas(config.apiKey) }
    );
    return data;
  } catch (_) {
    // Recuperável: a reserva local (sem asaas_id) fica para o retry reconciliar.
    throw erroServico('falha_criar_cobranca_asaas', true);
  }
}

// Completa a reserva com os dados do payment. Idempotente por natureza: só
// preenche; rodar de novo com o mesmo payment não muda o resultado.
async function completarFaturaComPayment({ supabase, http, config, faturaId, payment, tipo }) {
  const statusInterno = normalizarStatusAsaas(payment.status).status;
  const pixQrCode = tipo === 'PIX' ? await obterPixQrCode(http, config, payment.id) : null;
  const patch = {
    asaas_id: payment.id,
    status: statusInterno,
    invoice_url: payment.invoiceUrl || null,
    bank_slip_url: payment.bankSlipUrl || null,
  };
  if (pixQrCode) patch.pix_qr_code = pixQrCode;

  const { data, error } = await supabase
    .from('faturas')
    .update(patch)
    .eq('id', faturaId)
    .select()
    .single();
  if (error) throw erroServico('erro_atualizar_fatura', true);
  return data;
}

// Garante o payment de uma reserva (fatura sem asaas_id): reconcilia por
// externalReference; se não achar, garante customer e cria a cobrança avulsa.
// Retorna a fatura já completada.
async function garantirCobrancaParaReserva({ supabase, http, config, empresa, plano, fatura, payload }) {
  // 1. Reconcilia: payment já existe no Asaas para esta chave?
  let payment = await buscarPaymentPorReferencia(http, config, fatura.client_request_id);

  // 2. Não achou → garante customer (cria em sandbox só p/ empresa elegível) e cria.
  if (!payment) {
    // garantirCustomer lança falha(400) se o cadastro estiver incompleto →
    // vira "pulada controlada" no caller (sem cobrança).
    const { customerId } = await garantirCustomer(empresa, { config, supabase, http });
    payment = await criarPaymentAsaas({
      http,
      config,
      customerId,
      valor: payload.valor,
      dueDate: payload.due_date,
      periodo: payload.periodo_referencia,
      clientRequestId: fatura.client_request_id,
      planoNome: plano.nome,
    });
  }

  return completarFaturaComPayment({ supabase, http, config, faturaId: fatura.id, payment, tipo: payload.tipo_pagamento });
}

// Ponto de entrada por empresa. supabase/http/config injetados.
// Retorna { resultado, motivo, periodo, fatura?, idempotente? }, onde resultado:
//   'gerada'      → reserva criada/completada com cobrança (fatura preenchida);
//   'idempotente' → já existia recorrente do período (retorna a existente);
//   'pulada'      → domínio decidiu não cobrar (motivo do domínio);
//   'erro'        → falha (recuperável ou não) — nenhuma segunda cobrança.
//
// empresa pode vir do caller já carregada; se não vier o plano no join, o serviço
// carrega. dataReferencia deriva o período (dia 1).
async function gerarFaturaRecorrenteParaEmpresa({ supabase, http, config, empresa, dataReferencia }) {
  if (!empresa || !empresa.id) return { resultado: 'erro', motivo: 'empresa_ausente', periodo: null };

  const periodo = calcularPeriodoReferencia(dataReferencia);
  if (!periodo) return { resultado: 'erro', motivo: 'periodo_invalido', periodo: null };

  // Plano: usa o join se veio; senão carrega pelo plano_id.
  let plano = planoDe(empresa);
  if (!plano && empresa.plano_id) {
    const { data, error } = await supabase.from('planos').select(CAMPOS_PLANO).eq('id', empresa.plano_id).maybeSingle();
    if (error) throw erroServico('erro_consulta_plano');
    plano = data || null;
  }

  const faturasExistentes = await carregarFaturasRecorrentes(supabase, empresa.id);

  // Decisão do domínio puro. Decisão de produto do PR 3: para empresa ELEGÍVEL
  // sem asaas_customer_id, o serviço cria o customer (garantirCustomer) durante a
  // cobrança — então avaliamos com um customer placeholder para que o domínio
  // ainda aplique TODAS as demais regras (status, assinatura, plano válido/pago,
  // gratuito, recorrente já existente). Assim NÃO criamos customer para um plano
  // gratuito ou empresa inelegível: nesses casos o domínio devolve o motivo
  // correto (plano_gratuito/…), não "customer_ausente".
  const empresaParaDecisao = empresa.asaas_customer_id
    ? empresa
    : { ...empresa, asaas_customer_id: '__sera_criado_no_charge__' };
  const decisao = avaliarElegibilidadeFaturaRecorrente({ empresa: empresaParaDecisao, plano, faturasExistentes, dataReferencia });

  // payload é puro; a client_request_id determinística serve tanto para a reserva
  // quanto para localizar/recuperar uma recorrente já existente do período.
  // Valor EFETIVO (base + extras) pela quantidade CONTRATADA (mega-frente extras).
  // Forward-safe: sem quantidade_contratada / não acomoda → cai para preco_mensal.
  const { valorEfetivo, extras } = derivarValorEfetivoFatura({ plano, quantidade_contratada: empresa && empresa.quantidade_contratada });
  const payload = montarPayloadFaturaRecorrente({ empresa, plano, dataReferencia, valorEfetivo, extras });

  // "Já existe recorrente do período" NÃO é um pular de verdade — é idempotência.
  // Se a existente for uma reserva sem asaas_id, completa/reconcilia (retry seguro);
  // se já tem asaas_id, devolve idempotente. É o que distingue esta camada do
  // domínio puro (que só sabe dizer "existe"), sem duplicar cobrança.
  if (decisao.resultado === 'pular' && decisao.motivo === MOTIVOS.FATURA_RECORRENTE_JA_EXISTE) {
    const jaExiste = await buscarFaturaPorClientRequestId(supabase, payload.client_request_id);
    if (jaExiste && !jaExiste.asaas_id) {
      const fatura = await garantirCobrancaParaReserva({ supabase, http, config, empresa, plano, fatura: jaExiste, payload });
      return { resultado: 'gerada', motivo: 'reconciliada', periodo, fatura };
    }
    return { resultado: 'idempotente', motivo: 'fatura_recorrente_ja_existe', periodo, fatura: jaExiste || null };
  }

  // Demais skips e erros do domínio: nenhum Asaas, nenhum insert.
  if (decisao.resultado !== 'cobrar') {
    return { resultado: decisao.resultado === 'erro' ? 'erro' : 'pulada', motivo: decisao.motivo, periodo };
  }

  // PRÉ-VALIDAÇÃO DO CADASTRO ANTES DA RESERVA: empresa sem customer e sem
  // nome+CPF/CNPJ+e-mail não pode ser cobrada — reservar aqui criaria fatura
  // local órfã (sem asaas_id). Fail-closed: nenhum insert, nenhuma cobrança.
  const cadastro = podeCriarCobranca(empresa);
  if (!cadastro.ok) {
    return { resultado: 'pulada', motivo: MOTIVO_CADASTRO_INCOMPLETO, periodo, camposFaltantes: cadastro.camposFaltantes };
  }

  // Reserva: insere a fatura local SEM asaas_id. As travas 021+031 garantem
  // unicidade sob corrida. 23505 → outra execução criou; recupera e segue.
  let reserva;
  const { data: inserida, error: insErr } = await supabase
    .from('faturas')
    .insert({ ...payload, asaas_id: null })
    .select()
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      // Corrida: busca por client_request_id (031 também pode ter batido; a chave
      // determinística resolve os dois casos).
      const existente = await buscarFaturaPorClientRequestId(supabase, payload.client_request_id);
      if (!existente) throw erroServico('erro_reserva_fatura', true);
      if (existente.asaas_id) return { resultado: 'idempotente', motivo: 'corrida_resolvida', periodo, fatura: existente };
      reserva = existente;
    } else {
      throw erroServico('erro_reserva_fatura');
    }
  } else {
    reserva = inserida;
  }

  // Garante a cobrança (reconcilia ou cria) e completa a reserva.
  const fatura = await garantirCobrancaParaReserva({ supabase, http, config, empresa, plano, fatura: reserva, payload });
  return { resultado: 'gerada', motivo: 'ok', periodo, fatura };
}

// Lote fino: itera empresas candidatas e agrega o resumo. dryRun apenas AVALIA
// (chama o domínio), sem Asaas, sem insert, sem customer. A seleção/limite de
// empresas é responsabilidade do caller (rota); aqui recebemos a lista pronta.
async function gerarFaturaRecorrenteEmLote({ supabase, http, config, empresas, dataReferencia, dryRun = false }) {
  const periodo = calcularPeriodoReferencia(dataReferencia);
  const geradas = [];
  const puladas = [];
  const erros = [];

  for (const empresa of empresas || []) {
    try {
      if (dryRun) {
        let plano = planoDe(empresa);
        if (!plano && empresa.plano_id) {
          const { data } = await supabase.from('planos').select(CAMPOS_PLANO).eq('id', empresa.plano_id).maybeSingle();
          plano = data || null;
        }
        const faturasExistentes = await carregarFaturasRecorrentes(supabase, empresa.id);
        const d = avaliarElegibilidadeFaturaRecorrente({ empresa, plano, faturasExistentes, dataReferencia });
        if (d.resultado === 'cobrar') geradas.push({ empresa_id: empresa.id, dry_run: true, periodo });
        else puladas.push({ empresa_id: empresa.id, motivo: d.motivo });
        continue;
      }

      const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config, empresa, dataReferencia });
      if (r.resultado === 'gerada' || r.resultado === 'idempotente') {
        geradas.push({ empresa_id: empresa.id, resultado: r.resultado, fatura_id: r.fatura && r.fatura.id, periodo });
      } else if (r.resultado === 'pulada') {
        puladas.push({ empresa_id: empresa.id, motivo: r.motivo });
      } else {
        erros.push({ empresa_id: empresa.id, motivo: r.motivo });
      }
    } catch (err) {
      erros.push({ empresa_id: empresa.id, motivo: err.motivo || 'erro_desconhecido', recuperavel: Boolean(err.recuperavel) });
    }
  }

  return { periodo, geradas, puladas, erros };
}

module.exports = {
  TIPO_PAGAMENTO,
  CAMPOS_EMPRESA,
  CAMPOS_PLANO,
  gerarFaturaRecorrenteParaEmpresa,
  gerarFaturaRecorrenteEmLote,
  selecionarEmpresasRecorrentes,
  SELECT_EMPRESA_RECORRENTE,
  // exportados para teste isolado
  buscarPaymentPorReferencia,
  carregarFaturasRecorrentes,
};

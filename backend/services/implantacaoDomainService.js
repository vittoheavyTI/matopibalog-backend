// backend/services/implantacaoDomainService.js
// MEGA-FRENTE Billing Comercial Avançado — FASE 4: regras PURAS da TAXA DE
// IMPLANTAÇÃO/AQUISIÇÃO. Sem I/O: não toca banco, não fala com o Asaas, não cria
// fatura — mesmo estilo testável de regularizacaoDomainService,
// faturaRecorrenteDomainService e calculadoraComercialService.
//
// NINGUÉM importa este módulo em runtime neste PR — é CÓDIGO MORTO de propósito
// (mesma decisão da 031/faturaRecorrenteDomainService): a fiação com rota/job é
// frente posterior, com autorização. Aqui só mora a DECISÃO e o PAYLOAD, para
// serem prováveis sem rede/DB e sem risco de criar cobrança sozinho.
//
// O QUE É a implantação: taxa ÚNICA de aquisição, SEPARADA da mensalidade,
// cobrada de EMPRESAS na entrada. Vale as regras (decisões do prompt):
//   * autônomo é ISENTO por regra (implantação é para empresa);
//   * cobrança separada, origem='implantacao', periodo_referencia NULL;
//   * idempotente: no máximo UMA implantação por empresa, PARA SEMPRE
//     (client_request_id 'implantacao:<empresa_id>' + índice único da migration 021);
//   * super-admin pode marcar ISENTA (valor 0, status 'cancelado', flag isenta);
//   * aberta a DESCONTO/ISENÇÃO por promoção no futuro (o valor efetivo entra como
//     parâmetro; o motor de promoções — FASE 5 — o calcula e passa pronto).
//
// PREÇO: o valor vem de plano.valor_implantacao (autoridade no backend). Este
// módulo NÃO inventa valor: se o plano não tem taxa (NULL/0), não há o que cobrar.

const ORIGEM_IMPLANTACAO = 'implantacao';
const TIPO_PAGAMENTO = 'PIX';

const MOTIVOS = Object.freeze({
  OK: 'ok',
  EMPRESA_AUSENTE: 'empresa_ausente',
  AUTONOMO_ISENTO: 'autonomo_isento_por_regra',
  JA_REGISTRADA: 'implantacao_ja_registrada',
  ISENCAO_MANUAL: 'isencao_manual',
  SEM_TAXA: 'sem_taxa_implantacao',
});

// Autônomo? Implantação não vale para autônomo. Considera tanto o TIPO da empresa
// quanto a CATEGORIA do plano (qualquer um marcando autônomo já isenta).
function empresaEhAutonomo(empresa, plano) {
  const tipo = empresa && empresa.tipo ? String(empresa.tipo) : null;
  const cat = plano && plano.categoria ? String(plano.categoria) : null;
  return tipo === 'autonomo' || cat === 'autonomo';
}

// Chave de idempotência LIFETIME (sem mês): uma implantação por empresa, sempre.
function montarClientRequestIdImplantacao(empresaId) {
  return `${ORIGEM_IMPLANTACAO}:${empresaId}`;
}

// Valor da taxa do plano (ou 0 se ausente/ inválido).
function valorImplantacaoDe(plano) {
  const v = Number(plano && plano.valor_implantacao);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// A implantação desta empresa já está RESOLVIDA (cobrada, em cobrança, ou
// isentada)? Só faturas origem='implantacao' contam. Uma implantação:
//   * 'pendente'/'pago'      → resolvida (não recobrar);
//   * implantacao_isenta=true → resolvida (dispensada);
//   * 'cancelado'/'estornado' SEM isenta → NÃO resolvida (pode cobrar de novo —
//     ex.: cobrança cancelada por engano, implantação ainda devida).
function implantacaoResolvida(faturasExistentes) {
  if (!Array.isArray(faturasExistentes)) return false;
  return faturasExistentes.some((f) => {
    if (!f || f.origem !== ORIGEM_IMPLANTACAO) return false;
    if (f.implantacao_isenta === true) return true;
    return f.status === 'pendente' || f.status === 'pago';
  });
}

// Decide o que fazer com a implantação de uma empresa AGORA.
// Retorna { acao, motivo, valor? }:
//   'cobrar'       → gerar fatura de implantação (valor = plano.valor_implantacao
//                    OU valorEfetivo, quando uma promoção já calculou o desconto);
//   'isentar'      → super-admin pediu isenção manual → registrar isenta (valor 0);
//   'ja_registrada'→ implantação já resolvida (idempotência) — nada a fazer;
//   'pular'        → autônomo (isento por regra) ou plano sem taxa;
//   'erro'         → entrada malformada.
//
// Parâmetros:
//   empresa                     → { id, tipo }
//   plano                       → { categoria, valor_implantacao }
//   faturasImplantacaoExistentes→ faturas da empresa (só as origem='implantacao' contam)
//   isencaoManual               → true quando o super-admin pede isenção
//   valorEfetivo                → opcional; valor já com desconto de promoção
//                                 (>=0). Ausente → usa plano.valor_implantacao.
function avaliarImplantacao({ empresa, plano, faturasImplantacaoExistentes, isencaoManual = false, valorEfetivo } = {}) {
  if (!empresa || !empresa.id) {
    return { acao: 'erro', motivo: MOTIVOS.EMPRESA_AUSENTE };
  }

  // Autônomo é isento por regra — antes de qualquer coisa.
  if (empresaEhAutonomo(empresa, plano)) {
    return { acao: 'pular', motivo: MOTIVOS.AUTONOMO_ISENTO };
  }

  // Idempotência: já resolvida → não repete.
  if (implantacaoResolvida(faturasImplantacaoExistentes)) {
    return { acao: 'ja_registrada', motivo: MOTIVOS.JA_REGISTRADA };
  }

  // Isenção manual do super-admin (mesmo sem promoção).
  if (isencaoManual === true) {
    return { acao: 'isentar', motivo: MOTIVOS.ISENCAO_MANUAL };
  }

  // Valor efetivo: promoção pode ter zerado a taxa → isenção via promoção.
  let valor;
  if (valorEfetivo !== undefined && valorEfetivo !== null) {
    const v = Number(valorEfetivo);
    if (!Number.isFinite(v) || v < 0) return { acao: 'pular', motivo: MOTIVOS.SEM_TAXA };
    if (v === 0) return { acao: 'isentar', motivo: MOTIVOS.ISENCAO_MANUAL };
    valor = v;
  } else {
    valor = valorImplantacaoDe(plano);
    if (valor <= 0) return { acao: 'pular', motivo: MOTIVOS.SEM_TAXA };
  }

  return { acao: 'cobrar', motivo: MOTIVOS.OK, valor };
}

// Snapshot próprio da implantação (congela plano + composição na fatura).
function montarSnapshotImplantacao(plano) {
  const p = plano || {};
  return {
    plano_id: p.id || null,
    plano_nome_snapshot: p.nome != null ? String(p.nome) : null,
  };
}

// Payload lógico da fatura de implantação a COBRAR. `valor` já vem decidido por
// avaliarImplantacao (plano.valor_implantacao ou valorEfetivo da promoção).
// periodo_referencia NULL de propósito: implantação não é competência mensal.
function montarPayloadImplantacao({ empresa, plano, valor, dueDate = null }) {
  const empresaId = empresa && empresa.id ? empresa.id : null;
  return {
    empresa_id: empresaId,
    valor: Number(valor),
    tipo_pagamento: TIPO_PAGAMENTO,
    status: 'pendente',
    due_date: dueDate,
    periodo_referencia: null,
    origem: ORIGEM_IMPLANTACAO,
    client_request_id: montarClientRequestIdImplantacao(empresaId),
    implantacao_isenta: false,
    implantacao_isencao_motivo: null,
    implantacao_isento_por: null,
    ...montarSnapshotImplantacao(plano),
  };
}

// Payload lógico da ISENÇÃO de implantação (manual ou por promoção que zerou).
// valor 0, status 'cancelado' (não será cobrada), flag isenta=true + auditoria.
// Mesma client_request_id → ocupa a única vaga de implantação da empresa,
// bloqueando cobrança futura (idempotência).
function montarPayloadImplantacaoIsenta({ empresa, plano, motivo, isentoPor = null }) {
  const empresaId = empresa && empresa.id ? empresa.id : null;
  return {
    empresa_id: empresaId,
    valor: 0,
    tipo_pagamento: TIPO_PAGAMENTO,
    status: 'cancelado',
    due_date: null,
    periodo_referencia: null,
    origem: ORIGEM_IMPLANTACAO,
    client_request_id: montarClientRequestIdImplantacao(empresaId),
    implantacao_isenta: true,
    implantacao_isencao_motivo: motivo != null ? String(motivo) : null,
    implantacao_isento_por: isentoPor || null,
    ...montarSnapshotImplantacao(plano),
  };
}

module.exports = {
  ORIGEM_IMPLANTACAO,
  TIPO_PAGAMENTO,
  MOTIVOS,
  empresaEhAutonomo,
  valorImplantacaoDe,
  implantacaoResolvida,
  montarClientRequestIdImplantacao,
  avaliarImplantacao,
  montarSnapshotImplantacao,
  montarPayloadImplantacao,
  montarPayloadImplantacaoIsenta,
};

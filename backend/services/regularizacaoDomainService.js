// backend/services/regularizacaoDomainService.js
// Macrofrente fluxo financeiro — regras PURAS da FATURA DE REGULARIZAÇÃO.
// Sem I/O: não toca banco nem Asaas. Apenas DECIDE elegibilidade e MONTA o
// payload/snapshot — mesmo estilo de faturaRecorrenteDomainService.
//
// O QUE É a fatura de regularização: a cobrança que destrava uma conta parada
// por pendência FINANCEIRA quando não existe nenhuma fatura aberta para pagar.
// Dois estados a destravam:
//   * trial vencido (a conta nunca foi cobrada — primeira mensalidade);
//   * suspenso por motivo financeiro (ou sem motivo registrado — legado manual).
// Suspensão administrativa/segurança/legacy_unknown NÃO gera cobrança: pagar
// não reativaria (decisão do paymentDomainService) e seria dinheiro em beco
// sem saída. Fail-closed.
//
// IDEMPOTÊNCIA em três camadas (mesma filosofia da recorrência):
//   1. pré-condição de negócio: existe fatura aberta (pendente/vencido) de
//      QUALQUER origem → não gera outra, devolve a existente;
//   2. client_request_id determinístico regularizacao:<empresa>:<YYYY-MM>
//      (índice único da migration 021) — no máximo UMA por empresa/mês;
//   3. reconciliação por externalReference no serviço de I/O.

const {
  calcularPeriodoReferencia,
  calcularDueDate,
  montarSnapshotFaturaRecorrente,
} = require('./faturaRecorrenteDomainService');

const ORIGEM_REGULARIZACAO = 'regularizacao';
const TIPO_PAGAMENTO = 'PIX';

// Motivos de suspensão que a regularização PODE destravar. NULL entra porque a
// suspensão manual do super-admin (PUT /empresas) não grava motivo — e gerar a
// fatura de regularização é a afirmação formal de que a pendência é financeira.
const REASONS_REGULARIZAVEIS = new Set(['financial', null]);

const MOTIVOS_REG = Object.freeze({
  OK: 'ok',
  EMPRESA_AUSENTE: 'empresa_ausente',
  PERIODO_INVALIDO: 'periodo_invalido',
  ESTADO_SEM_PENDENCIA: 'estado_sem_pendencia_financeira',
  TRIAL_ATIVO: 'trial_ainda_ativo',
  SUSPENSAO_NAO_FINANCEIRA: 'suspensao_nao_financeira',
  FATURA_ABERTA_EXISTENTE: 'fatura_aberta_existente',
  PLANO_INVALIDO: 'plano_invalido',
  PLANO_GRATUITO: 'plano_gratuito',
});

function paraDataISO(valor) {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trialVencido(empresa, agora) {
  if (!empresa || empresa.status !== 'trial') return false;
  const fim = paraDataISO(empresa.trial_ends_at);
  if (!fim) return false;
  return fim < agora;
}

// Há fatura ABERTA (pendente/vencido) de qualquer origem? Se sim, o caminho de
// regularização é PAGÁ-LA, não criar outra.
function encontrarFaturaAberta(faturasExistentes) {
  if (!Array.isArray(faturasExistentes)) return null;
  const abertas = faturasExistentes
    .filter((f) => f && ['pendente', 'vencido'].includes(f.status))
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  return abertas[0] || null;
}

// Decide se a empresa deve receber fatura de regularização AGORA.
// Retorna { resultado, motivo, elegivel, periodo, faturaAberta? }:
//   'cobrar'        → gerar a fatura;
//   'fatura_aberta' → já existe fatura aberta — devolvê-la, não criar;
//   'pular'         → nada a cobrar (estado/plano);
//   'erro'          → entrada malformada.
function avaliarElegibilidadeRegularizacao({ empresa, plano, faturasExistentes, dataReferencia, agora = new Date() }) {
  if (!empresa || !empresa.id) {
    return { resultado: 'erro', motivo: MOTIVOS_REG.EMPRESA_AUSENTE, elegivel: false, periodo: null };
  }

  const periodo = calcularPeriodoReferencia(dataReferencia || agora);
  if (!periodo) {
    return { resultado: 'erro', motivo: MOTIVOS_REG.PERIODO_INVALIDO, elegivel: false, periodo: null };
  }

  // 1. Estado da conta precisa ter pendência financeira destravável.
  const status = empresa.status || null;
  if (status === 'trial') {
    if (!trialVencido(empresa, agora)) {
      return { resultado: 'pular', motivo: MOTIVOS_REG.TRIAL_ATIVO, elegivel: false, periodo };
    }
  } else if (status === 'suspenso') {
    const reason = empresa.suspension_reason || null;
    if (!REASONS_REGULARIZAVEIS.has(reason)) {
      return { resultado: 'pular', motivo: MOTIVOS_REG.SUSPENSAO_NAO_FINANCEIRA, elegivel: false, periodo };
    }
  } else {
    // ativo (nada a regularizar), bloqueado/expirado (administrativo), outros.
    return { resultado: 'pular', motivo: MOTIVOS_REG.ESTADO_SEM_PENDENCIA, elegivel: false, periodo, status };
  }

  // 2. Fatura aberta existente (qualquer origem) → devolver, nunca duplicar.
  const faturaAberta = encontrarFaturaAberta(faturasExistentes);
  if (faturaAberta) {
    return { resultado: 'fatura_aberta', motivo: MOTIVOS_REG.FATURA_ABERTA_EXISTENTE, elegivel: false, periodo, faturaAberta };
  }

  // 3. Plano precisa existir, estar ativo, não arquivado e ser PAGO.
  if (!plano || !plano.id || plano.ativo === false || plano.arquivado_em != null) {
    return { resultado: 'pular', motivo: MOTIVOS_REG.PLANO_INVALIDO, elegivel: false, periodo };
  }
  const preco = Number(plano.preco_mensal);
  if (!Number.isFinite(preco) || preco <= 0) {
    return { resultado: 'pular', motivo: MOTIVOS_REG.PLANO_GRATUITO, elegivel: false, periodo };
  }

  return { resultado: 'cobrar', motivo: MOTIVOS_REG.OK, elegivel: true, periodo };
}

function montarClientRequestIdRegularizacao(empresaId, periodo) {
  const anoMes = String(periodo || '').slice(0, 7);
  return `${ORIGEM_REGULARIZACAO}:${empresaId}:${anoMes}`;
}

// Payload lógico da fatura de regularização. `valor` = plano.preco_mensal (o
// backend é a autoridade do preço; nunca recalculado aqui). periodo_referencia
// no dia 1 (CHECK dia-1 da migration 031 vale para toda fatura com período).
// `valorEfetivo`/`extras` (mega-frente extras por empresa): quando informado, o
// valor da regularização é o total base+extras e o snapshot congela a composição.
// Ausente → plano.preco_mensal (compat). Autônomo não tem extra (helper garante).
function montarPayloadFaturaRegularizacao({ empresa, plano, dataReferencia, valorEfetivo = null, extras = null }) {
  const empresaId = empresa && empresa.id ? empresa.id : null;
  const periodo = calcularPeriodoReferencia(dataReferencia);
  const valor = valorEfetivo != null && Number.isFinite(Number(valorEfetivo)) && Number(valorEfetivo) > 0
    ? Number(valorEfetivo)
    : Number(plano && plano.preco_mensal);
  return {
    empresa_id: empresaId,
    valor,
    tipo_pagamento: TIPO_PAGAMENTO,
    status: 'pendente',
    due_date: calcularDueDate(dataReferencia),
    periodo_referencia: periodo,
    origem: ORIGEM_REGULARIZACAO,
    client_request_id: montarClientRequestIdRegularizacao(empresaId, periodo),
    ...montarSnapshotFaturaRecorrente(plano, extras),
  };
}

module.exports = {
  ORIGEM_REGULARIZACAO,
  TIPO_PAGAMENTO,
  MOTIVOS_REG,
  REASONS_REGULARIZAVEIS,
  trialVencido,
  encontrarFaturaAberta,
  avaliarElegibilidadeRegularizacao,
  montarClientRequestIdRegularizacao,
  montarPayloadFaturaRegularizacao,
};

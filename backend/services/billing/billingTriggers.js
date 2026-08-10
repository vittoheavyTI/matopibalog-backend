// Gatilhos de billing (macrofrente 3A-2, §5/§25).
//
// Converte uma MUDANÇA COMERCIAL em um evento no outbox. É o ponto ÚNICO por onde
// o resto do sistema pede reconciliação de billing — nada de chamar Asaas direto
// em controllers. O enfileiramento é idempotente (dedupe_key).
//
// Uso: nos pontos de transição comercial (contrato assinado, trial iniciado/
// finalizado, plano/add-on alterado, cancelamento, webhook processado), chamar
// emitirEventoBilling(supabase, { empresaId, tipo, competencia }).

const { enfileirar } = require('./billingOutboxRepository');

const EVENTOS = Object.freeze([
  'contratacao_apta',
  'contrato_assinado',
  'trial_iniciado',
  'trial_finalizado',
  'plano_alterado',
  'addon_alterado',
  'cancelamento',
  'webhook',
  'reconciliacao',
]);

// dedupe_key: para eventos "one-shot" (contrato assinado) usamos empresa:tipo.
// Para eventos recorrentes/competência, o chamador passa `competencia` (ex.: mês)
// para permitir reprocessamento por período sem duplicar dentro do mesmo período.
function montarDedupeKey({ empresaId, tipo, competencia }) {
  return competencia ? `${empresaId}:${tipo}:${competencia}` : `${empresaId}:${tipo}`;
}

// Fail-open: um erro ao enfileirar NÃO deve derrubar o fluxo de negócio que o
// disparou (o reconcile periódico recupera). Devolve o resultado para telemetria.
async function emitirEventoBilling(supabase, { empresaId, tipo, competencia, payload = {} } = {}) {
  if (!empresaId || !EVENTOS.includes(tipo)) {
    return { enfileirado: false, code: 'entrada_invalida' };
  }
  try {
    const dedupeKey = montarDedupeKey({ empresaId, tipo, competencia });
    return await enfileirar(supabase, { empresaId, eventType: tipo, dedupeKey, payload });
  } catch (err) {
    return { enfileirado: false, code: 'erro', error: err };
  }
}

module.exports = { EVENTOS, montarDedupeKey, emitirEventoBilling };

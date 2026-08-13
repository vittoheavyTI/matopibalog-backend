// Job de reconciliação periódica (I/O) — macrofrente 3A-2 (§11/§15/§16).
//
// Carrega empresas candidatas, decide (decisor puro) e ENFILEIRA eventos
// `reconciliacao` idempotentes (dedupe por dia). NÃO chama Asaas: o runner do
// outbox processa. É o safety net que garante convergência sem request humana.
//
// One-shot (script/cron do Railway) ou chamável por endpoint de contingência.

const { selecionarParaReconciliar, competenciaDia } = require('./billingReconcileJobDomainService');
const { emitirEventoBilling } = require('./billingTriggers');

async function executarReconcilePeriodico({ supabase, agora = new Date(), janelaTrialDias = 3, limite = 500 } = {}) {
  // Carrega um lote conservador de empresas com os campos necessários.
  const { data, error } = await supabase
    .from('empresas')
    .select('id, status, commercial_flow_version, trial_ends_at, asaas_customer_id, asaas_subscription_id')
    .limit(limite);
  if (error) return { avaliadas: 0, enfileiradas: 0, indisponivel: true };

  const empresas = data || [];
  const selecionadas = selecionarParaReconciliar({ empresas, agora, janelaTrialDias });
  const competencia = competenciaDia(agora);

  let enfileiradas = 0;
  for (const s of selecionadas) {
    try {
      const r = await emitirEventoBilling(supabase, { empresaId: s.empresaId, tipo: 'reconciliacao', competencia, payload: { motivo: s.motivo } });
      if (r.enfileirado) enfileiradas += 1;
    } catch { /* fail-open: próxima rodada tenta de novo */ }
  }

  return { avaliadas: empresas.length, selecionadas: selecionadas.length, enfileiradas };
}

module.exports = { executarReconcilePeriodico };

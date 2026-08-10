// One-shot: reconciliação periódica de billing (macrofrente 3A-2, §11/§15).
//
// Safety net TEMPORAL: encontra trials vencidos por relógio e mapeamentos ausentes
// e ENFILEIRA eventos `reconciliacao` idempotentes (dedupe por dia). O runner do
// outbox processa depois. Garante que "trial vence sem ninguém logar → billing
// continua automaticamente". NÃO chama Asaas aqui. NÃO ativa produção.
//
//   node backend/scripts/billing/reconcile_periodico.mjs
//
// Env: SUPABASE_URL/SERVICE_KEY. `--dry-run` apenas avalia (não enfileira).

import process from 'node:process';

async function main() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const supabase = require('../../config/supabase');
  const { executarReconcilePeriodico } = require('../../services/billing/billingReconcileJob');
  const { selecionarParaReconciliar } = require('../../services/billing/billingReconcileJobDomainService');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    const { data } = await supabase
      .from('empresas')
      .select('id, status, commercial_flow_version, trial_ends_at, asaas_customer_id, asaas_subscription_id')
      .limit(500);
    const sel = selecionarParaReconciliar({ empresas: data || [], agora: new Date() });
    console.log('[billing/reconcile_periodico] DRY-RUN', JSON.stringify({ avaliadas: (data || []).length, selecionadas: sel.length }));
    return;
  }

  const r = await executarReconcilePeriodico({ supabase });
  console.log('[billing/reconcile_periodico]', JSON.stringify(r));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[billing/reconcile_periodico] erro fatal:', String(err && err.message).slice(0, 200));
  process.exit(1);
});

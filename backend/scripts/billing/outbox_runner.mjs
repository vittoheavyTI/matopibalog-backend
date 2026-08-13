// One-shot: processa UMA rodada do outbox de billing (macrofrente 3A-2).
//
// Uso: agendado por um cron service do Railway (mesmo padrão dos jobs existentes).
// Cada execução processa um lote e sai. A exclusividade multi-réplica vem do CLAIM
// CAS do outbox, não deste script. Provider por política (fake|sandbox; produção
// fail-closed). NÃO ativa produção.
//
//   node backend/scripts/billing/outbox_runner.mjs
//
// Env: BILLING_OUTBOX_BATCH_SIZE (opcional). Requer SUPABASE_URL/SERVICE_KEY.

import process from 'node:process';

async function main() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const supabase = require('../../config/supabase');
  const { executarUmaRodada } = require('../../services/billing/billingOutboxRunner');

  const resumo = await executarUmaRodada({ supabase });
  // Log conciso e sanitizado (o worker já sanitiza os erros por evento).
  console.log('[billing/outbox_runner]', JSON.stringify({
    processados: resumo.processados,
    falhados: resumo.falhados,
    mortos: resumo.mortos,
    vazios: resumo.vazios,
    erro_rodada: resumo.erro_rodada || null,
  }));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[billing/outbox_runner] erro fatal:', String(err && err.message).slice(0, 200));
  process.exit(1);
});

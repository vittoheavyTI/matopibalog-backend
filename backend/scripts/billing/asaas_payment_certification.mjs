// Harness de CERTIFICAÇÃO read-only do pagamento Asaas production (F5A).
//
// SÓ LEITURA: Supabase SELECT + Asaas GET + flags de env. NUNCA aceita --execute,
// NUNCA cria/edita nada. Exit 0 = estado consistente (PASS/NEEDS_OWNER); exit 1 =
// divergência perigosa (FAIL). Sem @supabase/supabase-js (usa REST) e sem Realtime.
//
// Uso (read-only):
//   railway run --service matopibalog-backend node backend/scripts/billing/asaas_payment_certification.mjs \
//     --empresa-id=<uuid> --charge-id=<pay_...> --expected-value-centavos=500 --expected-status=PENDING
//
// Sem ASAAS_API_KEY no ambiente → result NEEDS_OWNER_RAILWAY_RUN (rodar via Railway).

import process from 'node:process';

async function main() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  const { certificarPagamento, exitCodePara } = require('../../services/billing/asaasPaymentCertification');
  const { resumoBillingProductionGate } = require('../../services/billing/billingProductionGate');
  const rest = require('../../services/billing/oneShotSupabaseRestClient');
  const { certificarAsaas } = require('../../services/billing/asaasReconcileClient');

  const argv = process.argv.slice(2);

  const deps = {
    log: (obj) => console.log('[asaas_certify]', JSON.stringify(obj)),
    gateResumo: () => resumoBillingProductionGate(process.env),
    consultarLocal: async () => {
      let empresa = null;
      let outbox = null;
      let faturasEmpresa = null;
      let faturasGlobal = null;
      const empresaId = (argv.find((a) => a.startsWith('--empresa-id=')) || '').split('=')[1] || null;
      try { outbox = await rest.contarOutboxPendentes({ env: process.env }); } catch { outbox = null; }
      if (empresaId) {
        try { empresa = await rest.buscarEmpresaPorId(empresaId, { env: process.env }); } catch { empresa = null; }
        try { faturasEmpresa = await rest.contarFaturas({ empresaId, env: process.env }); } catch { faturasEmpresa = null; }
      }
      try { faturasGlobal = await rest.contarFaturas({ env: process.env }); } catch { faturasGlobal = null; }
      return {
        billing_outbox_count: outbox,
        pilot_local_customer_id: empresa ? (empresa.asaas_customer_id || null) : null,
        pilot_subscription_id: empresa ? (empresa.asaas_subscription_id || null) : null,
        pilot_faturas_count: faturasEmpresa,
        global_faturas_count: faturasGlobal,
        empresa_existe: !!empresa,
      };
    },
    consultarAsaas: async ({ empresaId, chargeRef, subscriptionRef, env }) => {
      const axios = require('axios');
      return certificarAsaas({ empresaId, chargeRef, subscriptionRef, env, http: axios });
    },
  };

  try {
    const r = await certificarPagamento({ argv, env: process.env, deps });
    process.exit(exitCodePara(r && r.result));
  } catch (err) {
    console.error('[asaas_certify] erro:', String(err && err.message).slice(0, 200));
    process.exit(1);
  }
}

main();

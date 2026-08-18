// Sync LOCAL idempotente da cobrança one-shot Asaas → tabela `faturas` (F5B-1A).
//
// DRY-RUN por padrão (só LÊ: Supabase SELECT + Asaas GET). A escrita local futura
// (F5B-1C) exige --execute-local-sync + --confirm-local-invoice-upsert. NUNCA cria
// cobrança, NUNCA chama Asaas com escrita. Sem @supabase/supabase-js (usa REST).
//
// Uso (dry-run — seguro, não escreve):
//   railway run --service matopibalog-backend node backend/scripts/billing/asaas_sync_one_shot_invoice_local.mjs \
//     --empresa-id=<uuid> --charge-id=<pay_...> --expected-value-centavos=500 --expected-status=PENDING

import process from 'node:process';

async function main() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  const { sincronizarFaturaLocal } = require('../../services/billing/asaasOneShotInvoiceLocalSync');
  const rest = require('../../services/billing/oneShotSupabaseRestClient');
  const { buscarChargePorId } = require('../../services/billing/asaasReconcileClient');

  const argv = process.argv.slice(2);
  const CAMPOS_UPDATE = ['status', 'asaas_raw_status', 'valor', 'tipo_pagamento', 'due_date', 'invoice_url', 'bank_slip_url', 'pago_em', 'last_synced_at'];

  const deps = {
    log: (obj) => console.log('[asaas_local_sync]', JSON.stringify(obj)),
    carregarEmpresa: async (empresaId) => rest.buscarEmpresaPorId(empresaId, { env: process.env }),
    buscarChargeAsaas: async ({ chargeId, env }) => {
      const axios = require('axios');
      return buscarChargePorId(chargeId, { env, http: axios });
    },
    buscarFaturaPorAsaasId: async (asaasId) => rest.buscarFaturaPorAsaasId(asaasId, { env: process.env }),
    // ESCRITA local — só é chamada no modo execute (2 flags). Nunca no dry-run.
    upsertFaturaLocal: async ({ plano }) => {
      const axios = require('axios');
      const { url, key } = rest.resolverEnvRest(process.env);
      const headers = rest.montarHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=representation' });
      if (plano.will_update && plano.fatura_existente_id) {
        const patch = {};
        for (const k of CAMPOS_UPDATE) if (plano.fatura[k] !== undefined) patch[k] = plano.fatura[k];
        const { data } = await axios.patch(`${url}/rest/v1/faturas?id=eq.${encodeURIComponent(plano.fatura_existente_id)}`, patch, { headers });
        return Array.isArray(data) && data.length ? data[0] : { id: plano.fatura_existente_id };
      }
      const { data } = await axios.post(`${url}/rest/v1/faturas`, plano.fatura, { headers });
      return Array.isArray(data) && data.length ? data[0] : null;
    },
    atualizarCustomerLocal: async ({ empresaId, asaasCustomerId }) => {
      const axios = require('axios');
      const { url, key } = rest.resolverEnvRest(process.env);
      const headers = rest.montarHeaders(key, { 'Content-Type': 'application/json' });
      await axios.patch(`${url}/rest/v1/empresas?id=eq.${encodeURIComponent(empresaId)}`, { asaas_customer_id: asaasCustomerId }, { headers });
    },
  };

  try {
    const r = await sincronizarFaturaLocal({ argv, env: process.env, deps });
    const falhou = r && r.modo === 'execute-local-sync' && r.ok === false;
    process.exit(falhou ? 1 : 0);
  } catch (err) {
    console.error('[asaas_local_sync] abortado:', String(err && err.message).slice(0, 200));
    process.exit(1);
  }
}

main();

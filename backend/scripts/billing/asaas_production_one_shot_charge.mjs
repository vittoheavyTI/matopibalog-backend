// One-shot de COBRANÇA AVULSA Asaas production (frente Pagamento/Aquisição real).
//
// DRY-RUN por padrão. NÃO cria nada sem TODAS as flags de execução + o gate
// production ACTIVE. Cria customer idempotente + UMA cobrança PIX avulsa (nunca
// subscription). Toda a lógica/validação vive em
// services/billing/asaasProductionOneShotCharge.js (testável, sem I/O).
//
// Uso (dry-run — seguro, não escreve):
//   node backend/scripts/billing/asaas_production_one_shot_charge.mjs --empresa-id=<uuid>
//
// Uso (execução real — só em F3, com env production armado por humano):
//   node backend/scripts/billing/asaas_production_one_shot_charge.mjs \
//     --execute --confirm-production-one-shot \
//     --empresa-id=<uuid> --empresa-nome-esperado="Empresa Foxtrot Teste" \
//     --valor-centavos=100
//
// Requer (execução): SUPABASE_URL/SUPABASE_SERVICE_KEY + gate production ACTIVE
// (BILLING_PROVIDER_MODE=asaas_production, BILLING_PRODUCTION_ENABLED=true,
//  BILLING_OUTBOX_ENABLED=true, BILLING_PRODUCTION_ALLOWLIST=<uuid único>, ASAAS_API_KEY).
//
// F3A — hardening de runtime: a leitura da empresa/outbox usa um cliente REST
// mínimo (oneShotSupabaseRestClient), NÃO o config/supabase — assim NÃO carregamos
// @supabase/supabase-js (Realtime/WebSocket), que no Windows deixava handles
// abertos e derrubava o processo com UV_HANDLE_CLOSING após o dry-run.
//
// LEMBRETE: PRODUCTION_ASAAS_WRITES NÃO é controle real (o gate não a lê). Nunca
// logar segredo. Este script NUNCA liga runner contínuo.

import process from 'node:process';

async function main() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  const { executarOneShotCharge } = require('../../services/billing/asaasProductionOneShotCharge');
  const { resolvePolicy } = require('../../services/billing/billingPolicyConfig');
  const { selecionarProvider } = require('../../services/billing/billingOrchestratorService');

  const argv = process.argv.slice(2);
  const vaiExecutar = argv.includes('--execute');

  // Leitura via cliente REST mínimo (SEM @supabase/supabase-js → SEM Realtime/WS).
  const rest = require('../../services/billing/oneShotSupabaseRestClient');

  const deps = {
    agora: new Date(),
    log: (obj) => console.log('[asaas_one_shot]', JSON.stringify(obj)),
    // Read-only via PostgREST. Sem env → lança (necessário só quando há --empresa-id).
    carregarEmpresa: async (empresaId) => rest.buscarEmpresaPorId(empresaId, { env: process.env }),
    // Best-effort: sem env ou falha → null (não bloqueia o dry-run em qualquer lugar).
    contarOutboxPendentes: async () => {
      try { return await rest.contarOutboxPendentes({ env: process.env }); }
      catch { return null; }
    },
    // Provider REAL só é instanciado na execução — e via selecionarProvider, que
    // re-aplica o billingProductionGate (fail-closed). Sem gate aprovado, lança.
    criarProvider: ({ empresaId, env }) => {
      const axios = require('axios');
      const policy = resolvePolicy({}, env);
      return selecionarProvider(policy, { http: axios, empresaId, env });
    },
    // Reconcile READ-ONLY (--reconcile): só GET no Asaas por externalReference.
    reconciliarAsaas: async ({ empresaId, chargeRef, env }) => {
      const axios = require('axios');
      const { reconciliar } = require('../../services/billing/asaasReconcileClient');
      return reconciliar({ empresaId, chargeRef, env, http: axios });
    },
  };

  try {
    const r = await executarOneShotCharge({ argv, env: process.env, deps });
    const falhou = r && r.execucao_real && r.ok === false;
    process.exit(vaiExecutar && falhou ? 1 : 0);
  } catch (err) {
    console.error('[asaas_one_shot] abortado:', String(err && err.message).slice(0, 200));
    process.exit(1);
  }
}

main();

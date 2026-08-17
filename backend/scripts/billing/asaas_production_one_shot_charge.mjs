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

  // config/supabase faz process.exit(1) se as envs faltarem. Guardamos o require
  // para que o dry-run (sem --empresa-id) rode em qualquer lugar sem derrubar o
  // processo. As leituras são SELECT puros (read-only).
  const getSupabaseOrNull = () => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
    return require('../../config/supabase');
  };

  const deps = {
    agora: new Date(),
    log: (obj) => console.log('[asaas_one_shot]', JSON.stringify(obj)),
    carregarEmpresa: async (empresaId) => {
      const supabase = getSupabaseOrNull();
      if (!supabase) throw new Error('SUPABASE_URL/SERVICE_KEY ausentes (necessarios para --empresa-id)');
      const { data, error } = await supabase
        .from('empresas')
        .select('id, nome, cnpj, email_contato, asaas_customer_id, asaas_subscription_id, plano_id, commercial_flow_version')
        .eq('id', empresaId)
        .maybeSingle();
      if (error) throw new Error('falha ao carregar empresa (read-only)');
      return data || null;
    },
    contarOutboxPendentes: async () => {
      const supabase = getSupabaseOrNull();
      if (!supabase) return null; // best-effort
      const { count, error } = await supabase
        .from('billing_outbox')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendente', 'failed']);
      if (error) return null; // best-effort
      return count || 0;
    },
    // Provider REAL só é instanciado na execução — e via selecionarProvider, que
    // re-aplica o billingProductionGate (fail-closed). Sem gate aprovado, lança.
    criarProvider: ({ empresaId, env }) => {
      const axios = require('axios');
      const policy = resolvePolicy({}, env);
      return selecionarProvider(policy, { http: axios, empresaId, env });
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

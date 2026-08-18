const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  certificarPagamento,
  exitCodePara,
  parseArgs,
} = require('../services/billing/asaasPaymentCertification');

const EMP = 'bc54e9a6-b54b-4ed2-9b7a-3833edebded6';
const CHG = 'pay_moeewnn1bslsyg9c';
const OUTRA = '22222222-2222-4222-8222-222222222222';

function envOk(over = {}) {
  return { ASAAS_API_KEY: 'aact_dummy', BILLING_PRODUCTION_ALLOWLIST: EMP, ...over };
}
function gateArmed(over = {}) {
  return { state: 'PRODUCTION_ARMED', provider_mode: 'asaas_production', runner_enabled: false, production_enabled: true, allowlist_count: 1, production_secret_present: true, ...over };
}
function localOk(over = {}) {
  return { billing_outbox_count: 0, pilot_local_customer_id: null, pilot_subscription_id: null, pilot_faturas_count: 0, global_faturas_count: 24, empresa_existe: true, ...over };
}
function asaasOk(over = {}) {
  return { secret_present: true, customer: { id: 'cus_000194574257' }, charges_count: 1, charge: { id: CHG, status: 'PENDING', value: 5, billingType: 'PIX' }, subscriptions_count: 0, ...over };
}
function mkDeps({ local = localOk(), asaas = asaasOk(), gate = gateArmed() } = {}) {
  const calls = { asaas: 0, local: 0 };
  const logs = [];
  const deps = {
    log: (o) => logs.push(o),
    gateResumo: () => gate,
    consultarLocal: async () => { calls.local += 1; return local; },
    consultarAsaas: async () => { calls.asaas += 1; return asaas; },
  };
  return { deps, calls, logs };
}
const ARGV = [`--empresa-id=${EMP}`, `--charge-id=${CHG}`, '--expected-value-centavos=500', '--expected-status=PENDING', `--expected-customer-id=cus_000194574257`];

test('read_only sempre true; nunca há dep de escrita', async () => {
  const { deps } = mkDeps();
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.equal(r.read_only, true);
  // deps só têm consultas (consultarLocal/consultarAsaas/gateResumo) — não há criarProvider/create*.
  assert.equal(typeof deps.criarProvider, 'undefined');
});

test('estado esperado → PASS_PAYMENT_CREATED_PENDING_NO_LOCAL_INTEGRATION (exit 0)', async () => {
  const { deps } = mkDeps();
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.equal(r.result, 'PASS_PAYMENT_CREATED_PENDING_NO_LOCAL_INTEGRATION');
  assert.deepEqual(r.divergencias, []);
  assert.equal(r.charge.id, CHG);
  assert.equal(r.charge.value, 5);
  assert.equal(r.subscription_found, false);
  assert.equal(exitCodePara(r.result), 0);
});

test('--execute é rejeitado (divergência → FAIL)', async () => {
  const { deps } = mkDeps();
  const r = await certificarPagamento({ argv: [...ARGV, '--execute'], env: envOk(), deps });
  assert.ok(r.divergencias.includes('execute_nao_permitido_no_harness'));
  assert.ok(r.result.startsWith('FAIL'));
  assert.equal(exitCodePara(r.result), 1);
});

test('charge duplicada (charges_count>1) → FAIL', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ charges_count: 2 }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('charge_duplicada'));
  assert.equal(exitCodePara(r.result), 1);
});

test('valor divergente → FAIL', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ charge: { id: CHG, status: 'PENDING', value: 1, billingType: 'PIX' } }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('valor_divergente'));
});

test('subscription indevida (Asaas) → FAIL', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ subscriptions_count: 1 }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('subscription_asaas_indevida'));
  assert.equal(r.subscription_found, true);
});

test('billing_outbox != 0 → FAIL', async () => {
  const { deps } = mkDeps({ local: localOk({ billing_outbox_count: 3 }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('billing_outbox_nao_zero'));
});

test('allowlist com mais de uma empresa → FAIL', async () => {
  const { deps } = mkDeps();
  const r = await certificarPagamento({ argv: ARGV, env: envOk({ BILLING_PRODUCTION_ALLOWLIST: `${EMP},${OUTRA}` }), deps });
  assert.ok(r.divergencias.includes('allowlist_nao_unica'));
});

test('outbox persistente true (gate ACTIVE) → FAIL', async () => {
  const { deps } = mkDeps({ gate: gateArmed({ state: 'PRODUCTION_ACTIVE', runner_enabled: true }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('outbox_enabled_persistente'));
  assert.ok(r.divergencias.includes('gate_active_inesperado'));
});

test('customer não encontrado → FAIL', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ customer: null }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('customer_asaas_nao_encontrado'));
});

test('charge não encontrada → FAIL', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ charges_count: 0, charge: null }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.includes('charge_asaas_nao_encontrada'));
});

test('status avançou para RECEIVED → PASS_PAYMENT_CONFIRMED (aviso, sem divergência)', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ charge: { id: CHG, status: 'RECEIVED', value: 5, billingType: 'PIX' } }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.equal(r.result, 'PASS_PAYMENT_CONFIRMED');
  assert.deepEqual(r.divergencias, []);
  assert.ok(r.avisos.some((a) => a.startsWith('status_avancou')));
  assert.equal(exitCodePara(r.result), 0);
});

test('status inesperado (ex.: OVERDUE) → divergência', async () => {
  const { deps } = mkDeps({ asaas: asaasOk({ charge: { id: CHG, status: 'OVERDUE', value: 5, billingType: 'PIX' } }) });
  const r = await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  assert.ok(r.divergencias.some((d) => d.startsWith('status_inesperado')));
});

test('sem ASAAS_API_KEY → NEEDS_OWNER_RAILWAY_RUN (exit 0, não chama Asaas)', async () => {
  const { deps, calls } = mkDeps();
  const env = envOk(); delete env.ASAAS_API_KEY;
  const r = await certificarPagamento({ argv: ARGV, env, deps });
  assert.equal(r.result, 'NEEDS_OWNER_RAILWAY_RUN');
  assert.equal(calls.asaas, 0);
  assert.equal(exitCodePara(r.result), 0);
});

test('logs não expõem ASAAS_API_KEY (provider_mode com segredo é sanitizado)', async () => {
  const { deps, logs } = mkDeps({ gate: gateArmed({ provider_mode: 'aact_vazado_por_engano' }) });
  await certificarPagamento({ argv: ARGV, env: envOk(), deps });
  const blob = JSON.stringify(logs);
  assert.equal(blob.includes('aact_vazado_por_engano'), false);
});

test('exitCodePara: PASS/NEEDS_OWNER=0, FAIL=1', () => {
  assert.equal(exitCodePara('PASS_PAYMENT_CREATED_PENDING_NO_LOCAL_INTEGRATION'), 0);
  assert.equal(exitCodePara('PASS_PAYMENT_CONFIRMED'), 0);
  assert.equal(exitCodePara('NEEDS_OWNER_RAILWAY_RUN'), 0);
  assert.equal(exitCodePara('FAIL:charge_duplicada'), 1);
});

test('parseArgs: defaults 500/PENDING; não expõe --execute como aceito', () => {
  const a = parseArgs([`--empresa-id=${EMP}`]);
  assert.equal(a.expectedValueCentavos, 500);
  assert.equal(a.expectedStatus, 'PENDING');
  assert.equal(a.executeRejeitado, false);
});

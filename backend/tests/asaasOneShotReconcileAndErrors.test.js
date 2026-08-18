const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  executarOneShotCharge,
  soDigitos,
  sanitizarErroAsaas,
} = require('../services/billing/asaasProductionOneShotCharge');

const EMP = 'bc54e9a6-b54b-4ed2-9b7a-3833edebded6';
const OUTRA = '22222222-2222-4222-8222-222222222222';

function envProd(over = {}) {
  return {
    BILLING_PROVIDER_MODE: 'asaas_production',
    BILLING_PRODUCTION_ENABLED: 'true',
    BILLING_OUTBOX_ENABLED: 'true',
    BILLING_PRODUCTION_ALLOWLIST: EMP,
    ASAAS_API_KEY: 'aact_dummy',
    NODE_ENV: 'production',
    ...over,
  };
}

function empresa(over = {}) {
  return { id: EMP, nome: 'Empresa Foxtrot Teste', cnpj: '24.847.274/0001-89', email_contato: 'f@x.com', asaas_customer_id: null, asaas_subscription_id: null, ...over };
}

function mkDeps({ emp = empresa(), chargeImpl, customerImpl, reconcileImpl } = {}) {
  const calls = { createCustomer: 0, createCharge: 0, createSubscription: 0, providerBuilt: 0, reconcile: 0 };
  const captured = {};
  const logs = [];
  const provider = {
    createCustomer: async (a) => { calls.createCustomer += 1; captured.customerArg = a; return customerImpl ? customerImpl(a) : { id: 'cus_1' }; },
    createCharge: async (a) => { calls.createCharge += 1; return chargeImpl ? chargeImpl(a) : { id: 'pay_1', status: 'PENDING', value: 1 }; },
    createSubscription: async () => { calls.createSubscription += 1; return { id: 'sub_x' }; },
  };
  const deps = {
    agora: new Date('2026-08-18T12:00:00Z'),
    log: (o) => logs.push(o),
    carregarEmpresa: async () => emp,
    contarOutboxPendentes: async () => 0,
    criarProvider: () => { calls.providerBuilt += 1; return provider; },
    reconciliarAsaas: async (a) => { calls.reconcile += 1; return reconcileImpl ? reconcileImpl(a) : { secret_present: true, customer: null, charge: null }; },
  };
  return { deps, calls, captured, logs };
}

const RECON = ['--reconcile', `--empresa-id=${EMP}`, '--valor-centavos=100'];
const EXEC = ['--execute', '--confirm-production-one-shot', `--empresa-id=${EMP}`, '--valor-centavos=100'];

// ---------------- utils ----------------

test('soDigitos remove máscara do CNPJ', () => {
  assert.equal(soDigitos('24.847.274/0001-89'), '24847274000189');
});

test('sanitizarErroAsaas extrai status + errors[].code/description', () => {
  const err = { response: { status: 400, data: { errors: [{ code: 'invalid_cpfCnpj', description: 'CPF/CNPJ inválido' }] } } };
  const s = sanitizarErroAsaas(err);
  assert.equal(s.http_status, 400);
  assert.equal(s.errors[0].code, 'invalid_cpfCnpj');
});

// ---------------- reconcile (read-only) ----------------

test('reconcile: NO_CUSTOMER_NO_CHARGE quando nada existe; NÃO chama create*', async () => {
  const { deps, calls } = mkDeps({ reconcileImpl: () => ({ secret_present: true, customer: null, charge: null }) });
  const r = await executarOneShotCharge({ argv: RECON, env: envProd({ BILLING_OUTBOX_ENABLED: 'false' }), deps });
  assert.equal(r.modo, 'reconcile');
  assert.equal(r.read_only, true);
  assert.equal(r.RECONCILE_RESULT, 'NO_CUSTOMER_NO_CHARGE');
  assert.equal(calls.createCustomer, 0);
  assert.equal(calls.createCharge, 0);
  assert.equal(calls.createSubscription, 0);
  assert.equal(calls.providerBuilt, 0);
  assert.equal(calls.reconcile, 1);
});

test('reconcile: CUSTOMER_ONLY_NO_CHARGE', async () => {
  const { deps } = mkDeps({ reconcileImpl: () => ({ secret_present: true, customer: { id: 'cus_9' }, charge: null }) });
  const r = await executarOneShotCharge({ argv: RECON, env: envProd(), deps });
  assert.equal(r.RECONCILE_RESULT, 'CUSTOMER_ONLY_NO_CHARGE');
  assert.equal(r.ASAAS_CUSTOMER_FOUND, true);
  assert.equal(r.ASAAS_CUSTOMER_ID, 'cus_9');
  assert.equal(r.ASAAS_CHARGE_FOUND, false);
});

test('reconcile: CHARGE_FOUND_DO_NOT_REPEAT', async () => {
  const { deps } = mkDeps({ reconcileImpl: () => ({ secret_present: true, customer: { id: 'cus_9' }, charge: { id: 'pay_9', status: 'PENDING', value: 1, billingType: 'PIX' } }) });
  const r = await executarOneShotCharge({ argv: RECON, env: envProd(), deps });
  assert.equal(r.RECONCILE_RESULT, 'CHARGE_FOUND_DO_NOT_REPEAT');
  assert.equal(r.ASAAS_CHARGE_ID, 'pay_9');
  assert.equal(r.ASAAS_CHARGE_BILLING_TYPE, 'PIX');
});

test('reconcile: funciona sem --execute e sem outbox=true (estado ARMED)', async () => {
  const { deps } = mkDeps();
  const r = await executarOneShotCharge({ argv: RECON, env: envProd({ BILLING_OUTBOX_ENABLED: 'false' }), deps });
  assert.equal(r.modo, 'reconcile');
  assert.ok(['NO_CUSTOMER_NO_CHARGE', 'CUSTOMER_ONLY_NO_CHARGE', 'CHARGE_FOUND_DO_NOT_REPEAT'].includes(r.RECONCILE_RESULT));
});

test('reconcile: sem ASAAS_API_KEY → NEEDS_OWNER_RAILWAY_RUN (fallback seguro)', async () => {
  const { deps, calls } = mkDeps();
  const env = envProd(); delete env.ASAAS_API_KEY;
  const r = await executarOneShotCharge({ argv: RECON, env, deps });
  assert.equal(r.RECONCILE_RESULT, 'NEEDS_OWNER_RAILWAY_RUN');
  assert.equal(r.secret_present, false);
  assert.equal(calls.reconcile, 0);
});

test('reconcile: allowlist != 1 → bloqueado por escopo (fail-closed)', async () => {
  const { deps, calls } = mkDeps();
  const r = await executarOneShotCharge({ argv: RECON, env: envProd({ BILLING_PRODUCTION_ALLOWLIST: `${EMP},${OUTRA}` }), deps });
  assert.equal(r.RECONCILE_RESULT, 'BLOQUEADO_ESCOPO');
  assert.ok(r.motivos.includes('allowlist_precisa_ter_exatamente_1'));
  assert.equal(calls.reconcile, 0);
});

test('reconcile: empresa fora da allowlist → bloqueado', async () => {
  const { deps } = mkDeps();
  const r = await executarOneShotCharge({ argv: RECON, env: envProd({ BILLING_PRODUCTION_ALLOWLIST: OUTRA }), deps });
  assert.equal(r.RECONCILE_RESULT, 'BLOQUEADO_ESCOPO');
});

// ---------------- cpfCnpj normalization ----------------

test('execute: cpfCnpj é enviado ao Asaas SOMENTE com dígitos', async () => {
  const { deps, captured } = mkDeps({ emp: empresa({ cnpj: '24.847.274/0001-89' }) });
  const r = await executarOneShotCharge({ argv: EXEC, env: envProd(), deps });
  assert.equal(r.ok, true);
  assert.equal(captured.customerArg.empresa.cnpj, '24847274000189');
});

test('cpfCnpj inválido após normalização → aborta antes do provider', async () => {
  const { deps, calls } = mkDeps({ emp: empresa({ cnpj: '123' }) });
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC, env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('cpfcnpj_invalido_apos_normalizacao'),
  );
  assert.equal(calls.providerBuilt, 0);
});

// ---------------- 4xx logging ----------------

test('4xx no createCustomer → failed_step=createCustomer + corpo sanitizado, sem segredo', async () => {
  const err = new Error('Request failed with status code 400 aact_supersecreto');
  err.response = { status: 400, data: { errors: [{ code: 'invalid_cpfCnpj', description: 'CPF/CNPJ inválido' }] } };
  const { deps, calls, logs } = mkDeps({ customerImpl: () => { throw err; } });
  await assert.rejects(() => executarOneShotCharge({ argv: EXEC, env: envProd(), deps }), (e) => e.code === 'ONE_SHOT_FALHA');
  assert.equal(calls.createCharge, 0);
  const rel = logs[logs.length - 1];
  assert.equal(rel.http_status, 400);
  assert.equal(rel.failed_step, 'createCustomer');
  assert.equal(rel.asaas_error_sanitized.errors[0].code, 'invalid_cpfCnpj');
  assert.equal(JSON.stringify(rel).includes('aact_supersecreto'), false);
});

test('4xx no createCharge → failed_step=createCharge (customer criado antes)', async () => {
  const err = new Error('Request failed with status code 400');
  err.response = { status: 400, data: { errors: [{ code: 'invalid_value', description: 'valor abaixo do minimo' }] } };
  const { deps, calls, logs } = mkDeps({ chargeImpl: () => { throw err; } });
  await assert.rejects(() => executarOneShotCharge({ argv: EXEC, env: envProd(), deps }), (e) => e.code === 'ONE_SHOT_FALHA');
  assert.equal(calls.createCustomer, 1);
  const rel = logs[logs.length - 1];
  assert.equal(rel.failed_step, 'createCharge');
  assert.equal(rel.asaas_error_sanitized.errors[0].code, 'invalid_value');
});

// ---------------- guards preservados ----------------

test('execute sem --confirm-production-one-shot ainda aborta; nunca subscription', async () => {
  const { deps, calls } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: ['--execute', `--empresa-id=${EMP}`, '--valor-centavos=100'], env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('falta_confirm_production_one_shot'),
  );
  assert.equal(calls.createSubscription, 0);
});

test('dry-run continua sem chamar Asaas', async () => {
  const { deps, calls } = mkDeps();
  const r = await executarOneShotCharge({ argv: [`--empresa-id=${EMP}`, '--valor-centavos=100'], env: envProd(), deps });
  assert.equal(r.modo, 'dry-run');
  assert.equal(calls.providerBuilt, 0);
  assert.equal(calls.createCustomer, 0);
});

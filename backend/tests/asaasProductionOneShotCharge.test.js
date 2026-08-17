const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  executarOneShotCharge,
  parseArgs,
  coletarValidacoes,
  centavosParaReais,
} = require('../services/billing/asaasProductionOneShotCharge');
const { AsaasCommitUncertainError } = require('../services/billing/asaasProviderSafety');

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';

function envProd(over = {}) {
  return {
    BILLING_PROVIDER_MODE: 'asaas_production',
    BILLING_PRODUCTION_ENABLED: 'true',
    BILLING_OUTBOX_ENABLED: 'true',
    BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
    ASAAS_API_KEY: 'aact_dummy_para_teste',
    NODE_ENV: 'production',
    ...over,
  };
}

function empresaFoxtrot(over = {}) {
  return {
    id: EMPRESA,
    nome: 'Empresa Foxtrot Teste',
    cnpj: '11222333000181',
    email_contato: 'foxtrot@example.com',
    asaas_customer_id: null,
    asaas_subscription_id: null,
    ...over,
  };
}

function mkDeps({ empresa = empresaFoxtrot(), chargeImpl, customerImpl, outbox = 0 } = {}) {
  const calls = { createCustomer: 0, createCharge: 0, createSubscription: 0, providerBuilt: 0 };
  const logs = [];
  const provider = {
    createCustomer: async (a) => { calls.createCustomer += 1; return customerImpl ? customerImpl(a) : { id: 'cus_123' }; },
    createCharge: async (a) => { calls.createCharge += 1; return chargeImpl ? chargeImpl(a) : { id: 'pay_123', status: 'PENDING', value: 1 }; },
    createSubscription: async () => { calls.createSubscription += 1; return { id: 'sub_naodeveria' }; },
  };
  const deps = {
    agora: new Date('2026-08-17T12:00:00Z'),
    log: (o) => logs.push(o),
    carregarEmpresa: async () => empresa,
    contarOutboxPendentes: async () => outbox,
    criarProvider: () => { calls.providerBuilt += 1; return provider; },
  };
  return { deps, calls, logs };
}

const EXEC = (over = []) => ['--execute', '--confirm-production-one-shot', `--empresa-id=${EMPRESA}`, '--valor-centavos=100', ...over];

// ---------------- parsing / utils ----------------

test('centavosParaReais converte corretamente', () => {
  assert.equal(centavosParaReais(100), 1);
  assert.equal(centavosParaReais(2999), 29.99);
});

test('parseArgs: dry-run é o default (sem --execute)', () => {
  const a = parseArgs([`--empresa-id=${EMPRESA}`]);
  assert.equal(a.execute, false);
  assert.equal(a.valorCentavos, 100);
  assert.equal(a.empresaId, EMPRESA);
});

// ---------------- dry-run ----------------

test('dry-run NÃO chama provider e não escreve', async () => {
  const { deps, calls } = mkDeps();
  const r = await executarOneShotCharge({ argv: [`--empresa-id=${EMPRESA}`], env: envProd(), deps });
  assert.equal(r.modo, 'dry-run');
  assert.equal(r.execucao_real, false);
  assert.equal(calls.providerBuilt, 0);
  assert.equal(calls.createCustomer, 0);
  assert.equal(calls.createCharge, 0);
  assert.equal(calls.createSubscription, 0);
});

// ---------------- guardas de execução ----------------

test('--execute sem --confirm-production-one-shot aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: ['--execute', `--empresa-id=${EMPRESA}`, '--valor-centavos=100'], env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('falta_confirm_production_one_shot'),
  );
});

test('allowlist vazia aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd({ BILLING_PRODUCTION_ALLOWLIST: '' }), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('allowlist_vazia'),
  );
});

test('allowlist com mais de uma empresa aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd({ BILLING_PRODUCTION_ALLOWLIST: `${EMPRESA},${OUTRA}` }), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('allowlist_com_mais_de_uma_empresa'),
  );
});

test('empresa fora da allowlist aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd({ BILLING_PRODUCTION_ALLOWLIST: OUTRA }), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('empresa_fora_da_allowlist'),
  );
});

test('valor != 100 sem --confirm-valor aborta', async () => {
  const { deps } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: ['--execute', '--confirm-production-one-shot', `--empresa-id=${EMPRESA}`, '--valor-centavos=500'], env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('valor_diferente_do_padrao_sem_confirmacao'),
  );
});

test('gate bloqueado (provider fake) aborta antes de escrever', async () => {
  const { deps, calls } = mkDeps();
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd({ BILLING_PROVIDER_MODE: 'fake' }), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('gate_bloqueado'),
  );
  assert.equal(calls.providerBuilt, 0);
});

test('empresa sem cnpj aborta', async () => {
  const { deps } = mkDeps({ empresa: empresaFoxtrot({ cnpj: null }) });
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('empresa_sem_cnpj'),
  );
});

test('outbox não vazia aborta', async () => {
  const { deps } = mkDeps({ outbox: 3 });
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_ABORTADO' && e.motivos.includes('outbox_nao_vazia'),
  );
});

// ---------------- caminho feliz ----------------

test('caminho feliz: createCustomer + createCharge exatamente 1x, sem subscription', async () => {
  const { deps, calls } = mkDeps();
  const r = await executarOneShotCharge({ argv: EXEC(), env: envProd(), deps });
  assert.equal(r.ok, true);
  assert.equal(r.execucao_real, true);
  assert.equal(calls.createCustomer, 1);
  assert.equal(calls.createCharge, 1);
  assert.equal(calls.createSubscription, 0);
  assert.equal(r.subscription_created, false);
  assert.equal(r.charge_id, 'pay_123');
  assert.equal(r.customer_id, 'cus_123');
});

test('PRODUCTION_ASAAS_WRITES não é controle: caminho feliz independe do valor', async () => {
  for (const v of ['0', '1', undefined]) {
    const { deps } = mkDeps();
    const env = envProd();
    if (v !== undefined) env.PRODUCTION_ASAAS_WRITES = v;
    const r = await executarOneShotCharge({ argv: EXEC(), env, deps });
    assert.equal(r.ok, true, `PRODUCTION_ASAAS_WRITES=${v} não deveria alterar a decisão`);
  }
});

// ---------------- erros do provider ----------------

test('commit incerto → aborta com instrução de reconciliação, sem 2ª cobrança', async () => {
  const { deps, calls, logs } = mkDeps({
    chargeImpl: () => { throw new AsaasCommitUncertainError({ resource: 'charge', externalReference: 'ref' }); },
  });
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_COMMIT_INCERTO',
  );
  assert.equal(calls.createCustomer, 1);
  assert.equal(calls.createCharge, 1); // não tentou de novo
  assert.equal(calls.createSubscription, 0);
  const ultimo = logs[logs.length - 1];
  assert.equal(ultimo.commit_incerto, true);
  assert.ok(ultimo.instrucao_reconciliacao);
});

test('erro genérico (5xx) → ONE_SHOT_FALHA', async () => {
  const { deps } = mkDeps({ chargeImpl: () => { const e = new Error('500 boom'); throw e; } });
  await assert.rejects(
    () => executarOneShotCharge({ argv: EXEC(), env: envProd(), deps }),
    (e) => e.code === 'ONE_SHOT_FALHA',
  );
});

test('logs NÃO expõem segredo (apiKey/Bearer/URL sanitizados)', async () => {
  const { deps, logs } = mkDeps({
    chargeImpl: () => { throw new Error('falha aact_supersecreto123 Bearer abc.def https://api.asaas.com/v3/payments'); },
  });
  await assert.rejects(() => executarOneShotCharge({ argv: EXEC(), env: envProd(), deps }));
  const blob = JSON.stringify(logs);
  assert.equal(blob.includes('aact_supersecreto123'), false);
  assert.equal(blob.includes('Bearer abc.def'), false);
  assert.equal(blob.includes('api.asaas.com'), false);
});

// ---------------- coletarValidacoes (unidade) ----------------

test('coletarValidacoes: env production válido + empresa ok ⇒ sem erros', () => {
  const { avaliarBillingProductionGate } = require('../services/billing/billingProductionGate');
  const env = envProd();
  const args = parseArgs(EXEC());
  const gate = avaliarBillingProductionGate({ empresaId: EMPRESA, operation: 'charge', env });
  const { erros } = coletarValidacoes({ env, args, empresa: empresaFoxtrot(), gate });
  assert.deepEqual(erros, []);
});

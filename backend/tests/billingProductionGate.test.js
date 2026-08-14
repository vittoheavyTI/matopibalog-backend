const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolvePolicy } = require('../services/billing/billingPolicyConfig');
const { selecionarProvider } = require('../services/billing/billingOrchestratorService');
const {
  avaliarBillingProductionGate,
  resumoBillingProductionGate,
  estadoGlobalBillingProducao,
} = require('../services/billing/billingProductionGate');
const { AsaasProductionProvider, ehProduction } = require('../services/billing/asaasProductionProvider');
const { resumirBillingHealth } = require('../services/billingHealthService');

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';

function env(over = {}) {
  return {
    BILLING_OUTBOX_ENABLED: 'false',
    BILLING_PROVIDER_MODE: 'fake',
    BILLING_PRODUCTION_ENABLED: 'false',
    BILLING_PRODUCTION_ALLOWLIST: '',
    ...over,
  };
}

test('production gate: default e fail-closed e nao escreve provider', () => {
  const g = avaliarBillingProductionGate({ empresaId: EMPRESA, env: env() });
  assert.equal(g.allowed, false);
  assert.equal(g.state, 'PRODUCTION_DISABLED');
  assert.ok(g.failures.includes('provider_mode_not_production'));
  assert.ok(g.failures.includes('outbox_disabled'));
  assert.ok(g.failures.includes('production_disabled'));
});

test('production gate: secret presente sem flag/allowlist/runner continua bloqueado', () => {
  const g = avaliarBillingProductionGate({
    empresaId: EMPRESA,
    env: env({ BILLING_PROVIDER_MODE: 'asaas_production', ASAAS_API_KEY: 'secret-test' }),
  });
  assert.equal(g.allowed, false);
  assert.equal(g.state, 'PRODUCTION_BLOCKED');
  assert.ok(g.failures.includes('outbox_disabled'));
  assert.ok(g.failures.includes('production_disabled'));
  assert.ok(g.failures.includes('allowlist_empty'));
});

test('production gate: empresa fora da allowlist nao escreve mesmo com flags completas', () => {
  const g = avaliarBillingProductionGate({
    empresaId: OUTRA,
    env: env({
      BILLING_OUTBOX_ENABLED: 'true',
      BILLING_PROVIDER_MODE: 'asaas_production',
      BILLING_PRODUCTION_ENABLED: 'true',
      BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
      ASAAS_API_KEY: 'secret-test',
    }),
  });
  assert.equal(g.allowed, false);
  assert.ok(g.failures.includes('empresa_not_allowlisted'));
});

test('production gate: allowlisted + todas as travas permite somente o provider production', () => {
  const g = avaliarBillingProductionGate({
    empresaId: EMPRESA,
    env: env({
      BILLING_OUTBOX_ENABLED: 'true',
      BILLING_PROVIDER_MODE: 'asaas_production',
      BILLING_PRODUCTION_ENABLED: 'true',
      BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
      ASAAS_API_KEY: 'secret-test',
    }),
  });
  assert.equal(g.allowed, true);
  assert.equal(g.state, 'PRODUCTION_ACTIVE');
});

test('production gate: production armado sem runner ativo nao processa outbox', () => {
  const state = estadoGlobalBillingProducao(env({
    BILLING_OUTBOX_ENABLED: 'false',
    BILLING_PROVIDER_MODE: 'asaas_production',
    BILLING_PRODUCTION_ENABLED: 'true',
    BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
    ASAAS_API_KEY: 'secret-test',
  }));
  assert.equal(state, 'PRODUCTION_ARMED');
});

test('production gate: config booleana invalida fica bloqueada e visivel no health', () => {
  const localEnv = env({
    BILLING_OUTBOX_ENABLED: 'sim',
    BILLING_PROVIDER_MODE: 'asaas_production',
    BILLING_PRODUCTION_ENABLED: 'true',
    BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
    ASAAS_API_KEY: 'secret-test',
  });
  const g = avaliarBillingProductionGate({ empresaId: EMPRESA, env: localEnv });
  const resumo = resumoBillingProductionGate(localEnv);
  assert.equal(g.allowed, false);
  assert.equal(g.state, 'PRODUCTION_BLOCKED');
  assert.ok(g.failures.some((failure) => failure.startsWith('config_invalid:')));
  assert.equal(resumo.state, 'PRODUCTION_BLOCKED');
  assert.equal(resumo.config_errors.length, 1);
});

test('orquestrador: provider asaas_production sem gate completo falha antes de HTTP', () => {
  const policy = resolvePolicy({ provider_mode: 'asaas_production' }, {});
  assert.throws(
    () => selecionarProvider(policy, { empresaId: EMPRESA, env: env({ BILLING_PROVIDER_MODE: 'asaas_production' }) }),
    /Asaas production bloqueado/,
  );
});

test('orquestrador: provider production so constroi com gate completo e HTTP fake', async () => {
  const calls = [];
  const http = {
    get: async (url) => { calls.push(['GET', url]); return { data: { data: [] } }; },
    post: async (url, body) => { calls.push(['POST', url, body]); return { data: { id: 'cus_prod_fake' } }; },
  };
  const policy = resolvePolicy({ provider_mode: 'asaas_production' }, {});
  const provider = selecionarProvider(policy, {
    empresaId: EMPRESA,
    http,
    env: env({
      BILLING_OUTBOX_ENABLED: 'true',
      BILLING_PROVIDER_MODE: 'asaas_production',
      BILLING_PRODUCTION_ENABLED: 'true',
      BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
      ASAAS_API_KEY: 'secret-test',
    }),
  });
  assert.equal(provider.environment, 'production');
  const customer = await provider.createCustomer({ empresa: { id: EMPRESA, nome: 'Piloto', cnpj: '11222333000181' } });
  assert.equal(customer.id, 'cus_prod_fake');
  assert.equal(calls[0][0], 'GET');
  assert.match(calls[0][1], /^https:\/\/api\.asaas\.com\/v3\/customers/);
});

test('AsaasProductionProvider valida host e environment production', () => {
  assert.equal(ehProduction({ environment: 'production', baseURL: 'https://api.asaas.com/v3' }), true);
  assert.equal(ehProduction({ environment: 'sandbox', baseURL: 'https://api.asaas.com/v3' }), false);
  assert.equal(ehProduction({ environment: 'production', baseURL: 'https://sandbox.asaas.com/api/v3' }), false);
  assert.throws(
    () => new AsaasProductionProvider({ config: { environment: 'production', baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'x' }, http: {} }),
    /recusado/,
  );
});

test('AsaasProductionProvider cobre contrato de atualizacao e cancelamento sem rede real', async () => {
  const calls = [];
  const provider = new AsaasProductionProvider({
    config: { environment: 'production', baseURL: 'https://api.asaas.com/v3', apiKey: 'secret-test' },
    http: {
      put: async (url, body) => {
        calls.push(['PUT', url, body]);
        return { data: { value: body.value, status: 'ACTIVE' } };
      },
      delete: async (url) => {
        calls.push(['DELETE', url]);
        return { data: { deleted: true } };
      },
    },
  });

  const subscription = await provider.updateSubscription({ subscriptionId: 'sub_prod_fake', value: 499.9 });
  const component = await provider.cancelComponent({ componentId: 'pay_prod_fake' });
  const cancelled = await provider.cancelSubscription({ subscriptionId: 'sub_prod_fake' });

  assert.deepEqual(subscription, { id: 'sub_prod_fake', value: 499.9, status: 'ACTIVE' });
  assert.deepEqual(component, { id: 'pay_prod_fake', status: 'CANCELLED', deleted: true });
  assert.deepEqual(cancelled, { id: 'sub_prod_fake', status: 'CANCELLED', deleted: true });
  assert.equal(calls[0][0], 'PUT');
  assert.match(calls[0][1], /^https:\/\/api\.asaas\.com\/v3\/subscriptions\/sub_prod_fake$/);
  assert.equal(calls[1][0], 'DELETE');
  assert.match(calls[1][1], /^https:\/\/api\.asaas\.com\/v3\/payments\/pay_prod_fake$/);
});

test('billing health expõe estado production sem secret', () => {
  const gate = resumoBillingProductionGate(env({
    BILLING_PROVIDER_MODE: 'asaas_production',
    BILLING_PRODUCTION_ENABLED: 'true',
    BILLING_PRODUCTION_ALLOWLIST: EMPRESA,
  }));
  const health = resumirBillingHealth({ productionGate: gate });
  assert.equal(health.production_gate.state, 'PRODUCTION_BLOCKED');
  assert.equal(health.production_gate.production_secret_present, false);
  assert.equal(health.production_gate.production_secret_authority, 'ASAAS_API_KEY_ENV_ONLY');
});

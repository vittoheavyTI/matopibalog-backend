const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selecionarProvider } = require('../services/billing/billingOrchestratorService');
const { resolvePolicy } = require('../services/billing/billingPolicyConfig');
const { AsaasSandboxProvider, ehSandbox } = require('../services/billing/asaasSandboxProvider');
const { FakeAsaasProvider } = require('../services/billing/fakeAsaasProvider');

// ── Guard de PRODUÇÃO (§4/§32) ───────────────────────────────────────────────
test('produção é FAIL-CLOSED: provider_mode=production recusado', () => {
  assert.throws(() => selecionarProvider({ provider_mode: 'production' }, {}), /produção é PROIBIDO/i);
});

test('produção via config também recusada, mesmo com policy sandbox', () => {
  assert.throws(
    () => selecionarProvider(resolvePolicy({ provider_mode: 'sandbox' }), { asaasConfig: { environment: 'production', baseURL: 'https://api.asaas.com/v3', apiKey: 'x' } }),
    /produção é PROIBIDO/i,
  );
});

test('policy padrão resolve para fake (nunca sandbox/produção por acidente)', () => {
  const p = selecionarProvider(resolvePolicy({}, {}), {});
  assert.ok(p instanceof FakeAsaasProvider);
});

// ── Prova de sandbox (§1/§5) ─────────────────────────────────────────────────
test('ehSandbox: exige environment=sandbox E host sandbox E não-produção', () => {
  assert.equal(ehSandbox({ environment: 'sandbox', baseURL: 'https://sandbox.asaas.com/api/v3' }), true);
  assert.equal(ehSandbox({ environment: 'production', baseURL: 'https://sandbox.asaas.com/api/v3' }), false);
  assert.equal(ehSandbox({ environment: 'sandbox', baseURL: 'https://api.asaas.com/v3' }), false);
  assert.equal(ehSandbox({ environment: 'sandbox', baseURL: '' }), false);
});

test('sandbox sem prova de ambiente → recusado', () => {
  assert.throws(
    () => selecionarProvider(resolvePolicy({ provider_mode: 'sandbox' }), { asaasConfig: { environment: '', baseURL: '' } }),
    /prova de ambiente sandbox ausente/i,
  );
});

test('sandbox provado mas sem credencial → recusado', () => {
  assert.throws(
    () => selecionarProvider(resolvePolicy({ provider_mode: 'sandbox' }), { asaasConfig: { environment: 'sandbox', baseURL: 'https://sandbox.asaas.com/api/v3' } }),
    /credencial sandbox ausente/i,
  );
});

test('sandbox provado + credencial → constrói AsaasSandboxProvider', () => {
  const p = selecionarProvider(resolvePolicy({ provider_mode: 'sandbox' }), {
    asaasConfig: { environment: 'sandbox', baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'sandbox-key' },
    http: { post: async () => ({ data: {} }), get: async () => ({ data: {} }), delete: async () => ({ data: {} }) },
  });
  assert.ok(p instanceof AsaasSandboxProvider);
  assert.equal(p.environment, 'sandbox');
});

// ── Contract do adapter sandbox com http FAKE (sem rede) ─────────────────────
function httpFake() {
  const calls = [];
  return {
    calls,
    post: async (url, body, opts) => { calls.push({ m: 'POST', url, body, headers: opts?.headers });
      if (url.endsWith('/customers')) return { data: { id: 'cus_real_1' } };
      if (url.endsWith('/subscriptions')) return { data: { id: 'sub_real_1', nextDueDate: body.nextDueDate, status: 'ACTIVE' } };
      if (url.endsWith('/payments')) return { data: { id: 'pay_real_1', status: 'PENDING', value: body.value, dueDate: body.dueDate } };
      return { data: {} };
    },
    get: async (url, opts) => { calls.push({ m: 'GET', url, headers: opts?.headers });
      if (url.includes('/customers?externalReference=')) return { data: { data: [] } }; // sem duplicata
      return { data: null };
    },
    delete: async (url, opts) => { calls.push({ m: 'DELETE', url, headers: opts?.headers }); return { data: { deleted: true, id: 'sub_real_1' } }; },
  };
}

test('adapter sandbox: createCustomer usa access_token e externalReference (contract)', async () => {
  const http = httpFake();
  const p = new AsaasSandboxProvider({ config: { environment: 'sandbox', baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'k' }, http });
  const r = await p.createCustomer({ empresa: { id: 'e1', nome: 'Alfa' } });
  assert.equal(r.id, 'cus_real_1');
  const post = http.calls.find((c) => c.m === 'POST' && c.url.endsWith('/customers'));
  assert.equal(post.headers.access_token, 'k');
  assert.equal(post.body.externalReference, 'e1');
});

test('adapter sandbox: createSubscription envia customer/value/nextDueDate/cycle', async () => {
  const http = httpFake();
  const p = new AsaasSandboxProvider({ config: { environment: 'sandbox', baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'k' }, http });
  const r = await p.createSubscription({ customerId: 'cus_real_1', value: 299.9, nextDueDate: '2026-08-20', cycle: 'MONTHLY', externalReference: 'e1' });
  assert.equal(r.id, 'sub_real_1');
  const post = http.calls.find((c) => c.url.endsWith('/subscriptions'));
  assert.equal(post.body.customer, 'cus_real_1');
  assert.equal(post.body.value, 299.9);
  assert.equal(post.body.nextDueDate, '2026-08-20');
  assert.equal(post.body.cycle, 'MONTHLY');
});

test('adapter sandbox NÃO constrói com base de produção (fail-closed no construtor)', () => {
  assert.throws(
    () => new AsaasSandboxProvider({ config: { environment: 'sandbox', baseURL: 'https://api.asaas.com/v3', apiKey: 'k' }, http: httpFake() }),
    /não é sandbox inequívoco/i,
  );
});

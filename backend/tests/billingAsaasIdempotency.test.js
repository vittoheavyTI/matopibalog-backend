const { test } = require('node:test');
const assert = require('node:assert/strict');

const { AsaasProductionProvider } = require('../services/billing/asaasProductionProvider');
const {
  canonicalSubscriptionReference,
  canonicalImplantationChargeReference,
  userAgentFor,
} = require('../services/billing/asaasProviderSafety');

class LostAfterCommitHttp {
  constructor({ loseOnceFor = new Set() } = {}) {
    this.customers = new Map();
    this.subscriptions = new Map();
    this.payments = new Map();
    this.loseOnceFor = loseOnceFor;
    this.lost = new Set();
    this.posts = { customers: 0, subscriptions: 0, payments: 0 };
    this.lastHeaders = null;
    this.lastPutBody = null;
  }

  async get(url, opts = {}) {
    this.lastHeaders = opts.headers;
    const parsed = new URL(url);
    const ref = parsed.searchParams.get('externalReference');
    if (parsed.pathname === '/v3/customers') return { data: { data: this._byRef(this.customers, ref) } };
    if (parsed.pathname === '/v3/subscriptions') return { data: { data: this._byRef(this.subscriptions, ref) } };
    if (parsed.pathname === '/v3/payments') return { data: { data: this._byRef(this.payments, ref) } };
    return { data: null };
  }

  async post(url, body, opts = {}) {
    this.lastHeaders = opts.headers;
    const parsed = new URL(url);
    if (parsed.pathname === '/v3/customers') return this._create('customers', this.customers, body, 'cus');
    if (parsed.pathname === '/v3/subscriptions') return this._create('subscriptions', this.subscriptions, body, 'sub');
    if (parsed.pathname === '/v3/payments') return this._create('payments', this.payments, body, 'pay');
    throw new Error(`POST inesperado: ${url}`);
  }

  async put(url, body, opts = {}) {
    this.lastHeaders = opts.headers;
    this.lastPutBody = body;
    return { data: { id: url.split('/').pop(), value: body.value, status: 'ACTIVE', updatePendingPayments: body.updatePendingPayments } };
  }

  async delete(url, opts = {}) {
    this.lastHeaders = opts.headers;
    return { data: { id: url.split('/').pop(), deleted: true } };
  }

  _byRef(map, ref) {
    if (!ref) return [];
    return Array.from(map.values()).filter((item) => item.externalReference === ref);
  }

  _create(kind, map, body, prefix) {
    this.posts[kind] += 1;
    const id = `${prefix}_${String(map.size + 1).padStart(6, '0')}`;
    const obj = { id, ...body, status: kind === 'subscriptions' ? 'ACTIVE' : 'PENDING' };
    map.set(id, obj);
    if (this.loseOnceFor.has(kind) && !this.lost.has(kind)) {
      this.lost.add(kind);
      const err = new Error('timeout apos commit');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return { data: obj };
  }
}

function provider(http) {
  return new AsaasProductionProvider({
    config: { environment: 'production', baseURL: 'https://api.asaas.com/v3', apiKey: 'secret-test' },
    http,
  });
}

test('response lost customer: POST commit + timeout reconcilia por externalReference e cria 1 vez', async () => {
  const http = new LostAfterCommitHttp({ loseOnceFor: new Set(['customers']) });
  const p = provider(http);
  const r = await p.createCustomer({ empresa: { id: 'emp-rl-cus', nome: 'Cliente' } });
  assert.equal(r.id, 'cus_000001');
  assert.equal(r.reconciled, true);
  assert.equal(http.posts.customers, 1);
  assert.equal(http.customers.size, 1);
});

test('response lost subscription: POST commit + timeout reconcilia e nao duplica', async () => {
  const http = new LostAfterCommitHttp({ loseOnceFor: new Set(['subscriptions']) });
  const p = provider(http);
  const ref = canonicalSubscriptionReference('emp-rl-sub');
  const r = await p.createSubscription({ customerId: 'cus_1', value: 299.9, nextDueDate: '2026-09-01', externalReference: ref });
  assert.equal(r.id, 'sub_000001');
  assert.equal(r.reconciled, true);
  assert.equal(http.posts.subscriptions, 1);
  assert.equal(http.subscriptions.size, 1);

  const retryAfterRestart = await provider(http).createSubscription({ customerId: 'cus_1', value: 299.9, nextDueDate: '2026-09-01', externalReference: ref });
  assert.equal(retryAfterRestart.id, 'sub_000001');
  assert.equal(http.posts.subscriptions, 1);
});

test('response lost charge: implantation POST commit + timeout reconcilia e nao duplica', async () => {
  const http = new LostAfterCommitHttp({ loseOnceFor: new Set(['payments']) });
  const p = provider(http);
  const ref = canonicalImplantationChargeReference('emp-rl-charge');
  const r = await p.createCharge({ customerId: 'cus_1', value: 500, dueDate: '2026-09-01', description: 'Implantacao', externalReference: ref });
  assert.equal(r.id, 'pay_000001');
  assert.equal(r.reconciled, true);
  assert.equal(http.posts.payments, 1);
  assert.equal(http.payments.size, 1);

  const workerRestart = await provider(http).createCharge({ customerId: 'cus_1', value: 500, dueDate: '2026-09-01', description: 'Implantacao', externalReference: ref });
  const reconcile = await provider(http).createCharge({ customerId: 'cus_1', value: 500, dueDate: '2026-09-01', description: 'Implantacao', externalReference: ref });
  assert.equal(workerRestart.id, 'pay_000001');
  assert.equal(reconcile.id, 'pay_000001');
  assert.equal(http.posts.payments, 1);
});

test('dois eventos outbox equivalentes usam a mesma charge por externalReference', async () => {
  const http = new LostAfterCommitHttp();
  const p = provider(http);
  const ref = canonicalImplantationChargeReference('emp-outbox-duplo');
  const a = await p.createCharge({ customerId: 'cus_1', value: 500, dueDate: '2026-09-01', externalReference: ref });
  const b = await p.createCharge({ customerId: 'cus_1', value: 500, dueDate: '2026-09-01', externalReference: ref });
  assert.equal(a.id, b.id);
  assert.equal(http.posts.payments, 1);
});

test('User-Agent explicito e updateSubscription preserva pending payments', async () => {
  const http = new LostAfterCommitHttp();
  const p = provider(http);
  await p.updateSubscription({ subscriptionId: 'sub_1', value: 499.9 });
  assert.equal(http.lastHeaders['User-Agent'], userAgentFor('production'));
  assert.equal(http.lastHeaders.access_token, 'secret-test');
  assert.equal(http.lastPutBody.updatePendingPayments, false);
});

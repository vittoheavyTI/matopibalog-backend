const { test } = require('node:test');
const assert = require('node:assert/strict');

const { reconciliar, BASE_PRODUCTION } = require('../services/billing/asaasReconcileClient');

const EMP = 'bc54e9a6-b54b-4ed2-9b7a-3833edebded6';
const CHARGE_REF = 'matopiba:billing:v1:charge:implantation:' + EMP;
const ENV = { ASAAS_API_KEY: 'aact_key_secreta' };

function httpMock(routes) {
  const urls = [];
  return {
    urls,
    get: async (url, opts) => {
      urls.push({ url, headers: opts.headers });
      for (const [frag, resp] of routes) if (url.includes(frag)) return resp;
      return { data: { data: [] } };
    },
  };
}

test('sem ASAAS_API_KEY → secret_present:false (fallback, nenhum GET)', async () => {
  const http = httpMock([]);
  const r = await reconciliar({ empresaId: EMP, chargeRef: CHARGE_REF, env: {}, http });
  assert.equal(r.secret_present, false);
  assert.equal(http.urls.length, 0);
});

test('só GET; key SÓ no header (nunca na URL); customer+charge encontrados', async () => {
  const http = httpMock([
    ['/customers?externalReference=', { data: { data: [{ id: 'cus_1' }] } }],
    ['/payments?externalReference=', { data: { data: [{ id: 'pay_1', status: 'PENDING', value: 1, billingType: 'PIX' }] } }],
  ]);
  const r = await reconciliar({ empresaId: EMP, chargeRef: CHARGE_REF, env: ENV, http });
  assert.equal(r.secret_present, true);
  assert.equal(r.customer.id, 'cus_1');
  assert.equal(r.charge.id, 'pay_1');
  assert.equal(r.charge.billingType, 'PIX');
  // A key nunca aparece na URL; vai no header access_token:
  for (const c of http.urls) {
    assert.equal(c.url.includes('aact_key_secreta'), false);
    assert.equal(c.headers.access_token, 'aact_key_secreta');
    assert.ok(c.url.startsWith(BASE_PRODUCTION));
  }
});

test('customer sem charge → charge null', async () => {
  const http = httpMock([
    ['/customers?externalReference=', { data: { data: [{ id: 'cus_1' }] } }],
    ['/payments?externalReference=', { data: { data: [] } }],
  ]);
  const r = await reconciliar({ empresaId: EMP, chargeRef: CHARGE_REF, env: ENV, http });
  assert.equal(r.customer.id, 'cus_1');
  assert.equal(r.charge, null);
});

test('nada encontrado → customer e charge null', async () => {
  const http = httpMock([]);
  const r = await reconciliar({ empresaId: EMP, chargeRef: CHARGE_REF, env: ENV, http });
  assert.equal(r.customer, null);
  assert.equal(r.charge, null);
});

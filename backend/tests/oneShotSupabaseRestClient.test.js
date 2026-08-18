const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buscarEmpresaPorId,
  contarOutboxPendentes,
  resolverEnvRest,
  montarHeaders,
} = require('../services/billing/oneShotSupabaseRestClient');

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_KEY: 'service_key_super_secreta' };

function httpMock(handler) {
  return { get: async (url, opts) => handler(url, opts) };
}

test('resolverEnvRest: sem env → lança REST_ENV_AUSENTE (fail-closed)', () => {
  assert.throws(() => resolverEnvRest({}), (e) => e.code === 'REST_ENV_AUSENTE');
});

test('montarHeaders: key vai em apikey + Authorization Bearer', () => {
  const h = montarHeaders('abc');
  assert.equal(h.apikey, 'abc');
  assert.equal(h.Authorization, 'Bearer abc');
});

test('buscarEmpresaPorId: GET com key SÓ no header (nunca na URL) e retorna 1º registro', async () => {
  let urlVisto = null; let headersVistos = null;
  const http = httpMock((url, opts) => { urlVisto = url; headersVistos = opts.headers; return { data: [{ id: 'x', nome: 'Foxtrot' }] }; });
  const r = await buscarEmpresaPorId('bc54e9a6-b54b-4ed2-9b7a-3833edebded6', { env: ENV, http });
  assert.equal(r.nome, 'Foxtrot');
  assert.ok(urlVisto.includes('/rest/v1/empresas?id=eq.bc54e9a6'));
  // A service key NÃO pode aparecer na URL:
  assert.equal(urlVisto.includes('service_key_super_secreta'), false);
  assert.equal(headersVistos.Authorization, 'Bearer service_key_super_secreta');
});

test('buscarEmpresaPorId: sem registro → null', async () => {
  const http = httpMock(() => ({ data: [] }));
  const r = await buscarEmpresaPorId('nao-existe', { env: ENV, http });
  assert.equal(r, null);
});

test('contarOutboxPendentes: lê total do header content-range', async () => {
  const http = httpMock(() => ({ data: [], headers: { 'content-range': '0-0/0' } }));
  const n = await contarOutboxPendentes({ env: ENV, http });
  assert.equal(n, 0);
});

test('contarOutboxPendentes: content-range com total > 0', async () => {
  const http = httpMock(() => ({ data: [{ id: 1 }], headers: { 'content-range': '0-0/5' } }));
  const n = await contarOutboxPendentes({ env: ENV, http });
  assert.equal(n, 5);
});

test('buscarEmpresaPorId: sem env → lança antes de qualquer HTTP', async () => {
  let chamou = false;
  const http = httpMock(() => { chamou = true; return { data: [] }; });
  await assert.rejects(() => buscarEmpresaPorId('x', { env: {}, http }), (e) => e.code === 'REST_ENV_AUSENTE');
  assert.equal(chamou, false);
});

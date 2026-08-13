const { test } = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../services/billing/billingOutboxRepository');

// Fake supabase mínimo, configurável por teste.
function fakeInsert(resultado) {
  return {
    from: () => ({
      insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(resultado) }) }),
    }),
  };
}
function fakeUpdate(resultado) {
  const chain = {
    update: () => chain,
    eq: () => chain,
    select: () => chain,
    maybeSingle: () => Promise.resolve(resultado),
  };
  return { from: () => chain };
}

test('enfileirar: sucesso → enfileirado', async () => {
  const r = await repo.enfileirar(fakeInsert({ data: { id: 'ob1' }, error: null }), { empresaId: 'e1', eventType: 'contrato_assinado', dedupeKey: 'e1:contrato_assinado' });
  assert.equal(r.enfileirado, true);
  assert.equal(r.code, 'inserted');
});

test('enfileirar: unique_violation (23505) → duplicate idempotente', async () => {
  const r = await repo.enfileirar(fakeInsert({ data: null, error: { code: '23505' } }), { empresaId: 'e1', eventType: 'contrato_assinado', dedupeKey: 'e1:contrato_assinado' });
  assert.equal(r.enfileirado, false);
  assert.equal(r.code, 'duplicate');
});

test('marcarFalhou: dentro do limite → failed com next_retry; excedeu → dead', async () => {
  const failed = await repo.marcarFalhou(fakeUpdate({ data: { id: 'ob1', status: 'failed' }, error: null }), { id: 'ob1', attempts: 2, max_attempts: 8 }, 'timeout');
  assert.equal(failed.code, 'failed');
  const dead = await repo.marcarFalhou(fakeUpdate({ data: { id: 'ob1', status: 'dead' }, error: null }), { id: 'ob1', attempts: 8, max_attempts: 8 }, 'erro persistente');
  assert.equal(dead.code, 'dead');
});

test('sanitizarErro: remove tokens, ids Asaas, urls, bearer', () => {
  const s = repo.sanitizarErro('falha Bearer abc123 pay_XYZ https://x.y/z token=deadbeefdeadbeefdeadbeef');
  assert.ok(!/Bearer abc123/.test(s));
  assert.ok(!/pay_XYZ/.test(s));
  assert.ok(!/https:\/\//.test(s));
  assert.match(s, /\[secret\]|\[asaas_id\]|\[url\]|\[token\]/);
});

test('marcarProcessado: usa status=processing como guarda (CAS)', async () => {
  const r = await repo.marcarProcessado(fakeUpdate({ data: { id: 'ob1', status: 'processed' }, error: null }), 'ob1');
  assert.equal(r.code, 'processed');
});

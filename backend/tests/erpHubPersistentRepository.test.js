'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPersistentErpRepository, isMissingPersistence } = require('../services/erpHub/persistentRepository');
const { intentFingerprintForEnvelope } = require('../services/erpHub/idempotency');

const EMPRESA_ID = '11111111-1111-4111-8111-111111111111';

function envelope(overrides = {}) {
  return {
    schema_version: 1,
    event_id: 'evt-1',
    request_id: null,
    correlation_id: null,
    empresa_id: EMPRESA_ID,
    entity_type: 'frete',
    entity_id: 'frete-1',
    event_type: 'frete.updated',
    occurred_at: '2026-01-01T00:00:00.000Z',
    source: 'unit-test',
    payload: { status: 'ok' },
    metadata: {},
    ...overrides,
  };
}

test('persistent ERP repository derives idempotency data and calls service-role RPC', async () => {
  const calls = [];
  const supabase = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: [{ code: 'inserted', item_id: 'item-1', status: 'pending' }], error: null };
    },
  };

  const env = envelope();
  const repo = createPersistentErpRepository(supabase);
  const result = await repo.enqueue({ empresaId: EMPRESA_ID, provider: 'fake', envelope: env });

  assert.equal(result.code, 'inserted');
  assert.match(result.intentFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.intentFingerprint, intentFingerprintForEnvelope(env));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'erp_enqueue_outbox');
  assert.equal(calls[0].params.p_empresa_id, EMPRESA_ID);
  assert.equal(calls[0].params.p_dedupe_key, result.dedupeKey);
  assert.equal(calls[0].params.p_intent_fingerprint, result.intentFingerprint);
});

test('persistent ERP repository fails closed on invalid envelopes before RPC', async () => {
  let rpcCalled = false;
  const repo = createPersistentErpRepository({
    async rpc() {
      rpcCalled = true;
      return { data: [], error: null };
    },
  });

  const result = await repo.enqueue({
    empresaId: EMPRESA_ID,
    provider: 'fake',
    envelope: envelope({ payload: { access_token: 'secret' } }),
  });

  assert.equal(result.code, 'invalid_envelope');
  assert.equal(result.chaveSensivel, 'payload.access_token');
  assert.equal(rpcCalled, false);
});

test('persistent ERP repository fails closed on tenant mismatch before RPC', async () => {
  let rpcCalled = false;
  const repo = createPersistentErpRepository({
    async rpc() {
      rpcCalled = true;
      return { data: [], error: null };
    },
  });

  const result = await repo.enqueue({
    empresaId: '22222222-2222-4222-8222-222222222222',
    provider: 'fake',
    envelope: envelope(),
  });

  assert.equal(result.code, 'tenant_mismatch');
  assert.equal(rpcCalled, false);
});

test('persistent ERP repository never forwards arbitrary success payloads', async () => {
  const calls = [];
  const repo = createPersistentErpRepository({
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: [{ code: 'succeeded', item_id: 'item-1', status: 'succeeded' }], error: null };
    },
  });

  await repo.markProcessed('item-1', '11111111-1111-4111-8111-111111111111', {
    externalReference: 'https://x.test/path?access_token=secret',
    externalResult: { nested: { client_secret: 'secret' }, authorization: 'Bearer secret-value' },
  });

  assert.equal(calls[0].name, 'erp_mark_outbox_succeeded');
  assert.equal(calls[0].params.p_external_reference, null);
  assert.equal(calls[0].params.p_external_result, null);
});

test('persistent ERP status reports schema_not_applied without throwing', async () => {
  const repo = createPersistentErpRepository({
    from() {
      return {
        select() {
          return {
            limit() {
              return {
                async eq() {
                  return { data: null, error: new Error('relation "erp_outbox" does not exist') };
                },
                then(resolve) {
                  resolve({ data: null, error: new Error('relation "erp_outbox" does not exist') });
                },
              };
            },
          };
        },
      };
    },
  });

  const result = await repo.persistenceStatus(EMPRESA_ID);
  assert.deepEqual(result, { available: false, reason: 'schema_not_applied' });
  assert.equal(isMissingPersistence(new Error('schema cache missing erp_external_identity_mappings')), true);
});

'use strict';

// Testes da fundação do ERP Integration Hub V1 (E3.7A). Provider-agnostic,
// schema-free, production-inert. Cobrem os invariantes do §15 (backend):
//   envelope versioning/sanitização; provider disabled fail-safe; fake adapter;
//   capability desconhecida/não suportada; idempotência de envio (outbox);
//   retry/backoff→dead; reconcile statuses (UNKNOWN nunca vira SUCCEEDED);
//   tenant isolation (outbox + external id); e ausência de I/O externo/supabase.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hub = require('../services/erpHub');
const { MODES } = require('../services/erpHub/config');
const { ErpProviderError } = require('../services/erpHub/errors');
const { CAPABILITY } = require('../services/erpHub/capabilities');
const {
  buildEnvelope, validateEnvelope, sanitizeObject, SCHEMA_VERSION,
} = require('../services/erpHub/canonicalEnvelope');
const gateway = require('../services/erpHub/erpProviderGateway');
const { fakeErpProvider } = require('../services/erpHub/providers/fakeErpProvider');
const { RECONCILE_STATUS, canPromoteToSucceeded, normalizeReconcile, safeToRetry } = require('../services/erpHub/reconcile');
const { deriveIdempotencyKey, idempotencyKeyForEnvelope } = require('../services/erpHub/idempotency');
const { createInMemoryOutbox, OUTBOX_STATUS, canTransition } = require('../services/erpHub/outboxContract');
const { createInMemoryIdentityMap } = require('../services/erpHub/externalIdentityContract');

const envInput = () => ({
  empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert',
  payload: { nome: 'X' },
});

// ────────────────────────────── ENVELOPE ──────────────────────────────
test('envelope: versionado e com todos os campos canônicos', () => {
  const env = buildEnvelope(envInput(), { now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(env.schema_version, SCHEMA_VERSION);
  for (const c of ['event_id', 'empresa_id', 'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source', 'payload', 'metadata']) {
    assert.ok(c in env, `campo ausente: ${c}`);
  }
  assert.equal(env.occurred_at, '2026-09-01T00:00:00.000Z');
  assert.equal(validateEnvelope(env).ok, true);
});

test('envelope: sanitiza segredos do payload e metadata (recursivo)', () => {
  const env = buildEnvelope({
    ...envInput(),
    payload: { nome: 'X', apiKey: 'sk_live_123', nested: { password: 'p', ok: 1, authorization: 'Bearer z' } },
    metadata: { token: 'abc', refresh_token: 'r', keep: 'v' },
  });
  const flat = JSON.stringify(env);
  for (const proibido of ['sk_live_123', 'password', 'authorization', 'refresh_token', 'apiKey', '"token"']) {
    assert.equal(flat.includes(proibido), false, `vazou: ${proibido}`);
  }
  assert.equal(env.payload.nome, 'X');
  assert.equal(env.payload.nested.ok, 1);
  assert.equal(env.metadata.keep, 'v');
});

test('envelope: recusa entradas inválidas com INVALID_ENVELOPE', () => {
  assert.throws(() => buildEnvelope({ ...envInput(), empresaId: '' }), (e) => e instanceof ErpProviderError && e.code === 'INVALID_ENVELOPE');
  assert.throws(() => buildEnvelope({ ...envInput(), entityType: '' }), (e) => e.code === 'INVALID_ENVELOPE');
  assert.throws(() => buildEnvelope({ ...envInput(), eventType: '' }), (e) => e.code === 'INVALID_ENVELOPE');
});

test('sanitizeObject não muta a entrada', () => {
  const orig = { a: 1, secret: 'x' };
  const out = sanitizeObject(orig);
  assert.equal('secret' in orig, true);   // entrada intacta
  assert.equal('secret' in out, false);   // saída limpa
});

// ───────────────────────────── PROVIDER ───────────────────────────────
test('provider disabled (default de produção) falha explicitamente, nunca finge sucesso', async () => {
  const env = buildEnvelope(envInput());
  assert.equal(gateway.capabilities({ mode: MODES.DISABLED }).length, 0);
  await assert.rejects(() => gateway.send(env, { mode: MODES.DISABLED }),
    (e) => e instanceof ErpProviderError && e.code === 'UNSUPPORTED_CAPABILITY');
  // Mesmo chamando o provider direto, o disabled lança DISABLED (nunca resolve).
  await assert.rejects(() => gateway.disabledErpProvider.send(env),
    (e) => e instanceof ErpProviderError && e.code === 'DISABLED');
});

test('fake adapter é determinístico e declara capabilities', async () => {
  fakeErpProvider.reset();
  const env = buildEnvelope(envInput());
  assert.deepEqual(gateway.capabilities({ mode: MODES.FAKE }).sort(), [CAPABILITY.LOOKUP, CAPABILITY.RECONCILE, CAPABILITY.SEND].sort());
  const r1 = await gateway.send(env, { mode: MODES.FAKE });
  const r2 = await gateway.send(env, { mode: MODES.FAKE });
  assert.equal(r1.accepted, true);
  assert.equal(r1.external_entity_id, r2.external_entity_id); // determinístico
});

test('capability desconhecida NUNCA é suportada', () => {
  assert.equal(gateway.supports('coisa_inexistente', { mode: MODES.FAKE }), false);
  assert.equal(gateway.supports(CAPABILITY.SEND, { mode: MODES.FAKE }), true);
  assert.equal(gateway.supports(CAPABILITY.SEND, { mode: MODES.DISABLED }), false);
});

test('fake propaga erros normalizados (não finge sucesso sob falha)', async () => {
  fakeErpProvider.reset();
  fakeErpProvider.setFailure('RATE_LIMIT');
  const env = buildEnvelope(envInput());
  await assert.rejects(() => gateway.send(env, { mode: MODES.FAKE }), (e) => e.code === 'RATE_LIMIT');
  fakeErpProvider.reset();
});

// ─────────────────────────── IDEMPOTÊNCIA ─────────────────────────────
test('idempotency key é estável e tenant-safe', () => {
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert', schemaVersion: 1 };
  const k1 = deriveIdempotencyKey(base);
  const k2 = deriveIdempotencyKey({ ...base });
  assert.equal(k1, k2); // mesma identidade → mesma chave
  const outroTenant = deriveIdempotencyKey({ ...base, empresaId: 'emp-2' });
  assert.notEqual(k1, outroTenant); // tenants nunca colidem
  const env = buildEnvelope(envInput());
  assert.equal(idempotencyKeyForEnvelope('fake', env), deriveIdempotencyKey({ ...base }));
});

// ───────────────────────────── OUTBOX ─────────────────────────────────
test('outbox: enfileirar é idempotente por dedupe_key', async () => {
  const ob = createInMemoryOutbox();
  const dedupeKey = 'erp:fake:abc';
  const a = await ob.enqueue({ empresaId: 'emp-1', eventType: 'upsert', dedupeKey, payload: {} });
  const b = await ob.enqueue({ empresaId: 'emp-1', eventType: 'upsert', dedupeKey, payload: {} });
  assert.equal(a.enfileirado, true);
  assert.equal(b.enfileirado, false);
  assert.equal(b.code, 'duplicate');
  assert.equal((await ob.countByStatus('emp-1')).pending, 1);
});

test('outbox: claim → processed feliz', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ empresaId: 'emp-1', eventType: 'upsert', dedupeKey: 'k1' });
  const { item, code } = await ob.claimNext();
  assert.equal(code, 'claimed');
  assert.equal(item.status, OUTBOX_STATUS.PROCESSING);
  assert.equal(item.attempts, 1);
  const r = await ob.markProcessed(item.id);
  assert.equal(r.code, 'processed');
  assert.equal((await ob.countByStatus()).processed, 1);
});

test('outbox: retry com backoff e depois morre (dead) sem loop infinito', async () => {
  const ob = createInMemoryOutbox({ maxAttempts: 2 });
  await ob.enqueue({ empresaId: 'emp-1', eventType: 'upsert', dedupeKey: 'k1' });
  // tentativa 1
  let c = await ob.claimNext();
  let f = await ob.markFailed(c.item.id, 'erro Bearer abcdef0123456789abcd token');
  assert.equal(f.code, 'failed');
  assert.equal(f.item.last_error.includes('Bearer'), false); // sanitizado
  assert.equal(f.item.last_error.includes('token'), true);   // palavra "token" ok; hash é que some
  assert.ok(f.item.next_retry_at);
  // tentativa 2 (retry vencido)
  const futuro = new Date(Date.now() + 3 * 60 * 60 * 1000);
  c = await ob.claimNext({ now: futuro });
  assert.equal(c.code, 'claimed');
  f = await ob.markFailed(c.item.id, 'falhou de novo', { now: futuro });
  assert.equal(f.code, 'dead');
  assert.equal(f.item.status, OUTBOX_STATUS.DEAD);
  assert.equal(f.item.next_retry_at, null);
});

test('outbox: máquina de estados recusa transições inválidas', () => {
  assert.equal(canTransition('pending', 'processing'), true);
  assert.equal(canTransition('processing', 'processed'), true);
  assert.equal(canTransition('processed', 'processing'), false); // terminal
  assert.equal(canTransition('dead', 'processing'), false);      // terminal
});

test('outbox: tenant isolation nas contagens', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ empresaId: 'emp-1', eventType: 'x', dedupeKey: 'a' });
  await ob.enqueue({ empresaId: 'emp-2', eventType: 'x', dedupeKey: 'b' });
  assert.equal((await ob.countByStatus('emp-1')).pending, 1);
  assert.equal((await ob.countByStatus('emp-2')).pending, 1);
  assert.equal(ob._all('emp-1').length, 1);
});

// ───────────────────────── EXTERNAL IDENTITY ──────────────────────────
test('external identity: bind idempotente e recusa colisões', () => {
  const m = createInMemoryIdentityMap();
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' };
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-1' }).code, 'bound');
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-1' }).code, 'idempotent');
  // mesmo internal, outro external → conflito (identidade imutável)
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-2' }).code, 'conflict_internal_already_bound');
  // outro internal, mesmo external → conflito (dois internos, um externo)
  assert.equal(m.bind({ ...base, internalEntityId: 'p-2', externalEntityId: 'ext-1' }).code, 'conflict_external_already_bound');
});

test('external identity: tenant/provider-safe (sem vazamento entre tenants)', () => {
  const m = createInMemoryIdentityMap();
  m.bind({ provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1', externalEntityId: 'ext-1' });
  // outro tenant com o MESMO internal id não resolve para o external do tenant A
  assert.equal(m.resolveExternal({ provider: 'fake', empresaId: 'emp-2', entityType: 'parceiro', internalEntityId: 'p-1' }), null);
  assert.equal(m.resolveExternal({ provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' }), 'ext-1');
  // outro provider não colide com o mapping do provider fake
  assert.equal(m.bind({ provider: 'outro', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1', externalEntityId: 'ext-1' }).code, 'bound');
});

test('external identity: rebind exige motivo e é auditável', () => {
  const m = createInMemoryIdentityMap();
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' };
  m.bind({ ...base, externalEntityId: 'ext-1' });
  assert.equal(m.rebind({ ...base, externalEntityId: 'ext-9' }).code, 'reason_required');
  const r = m.rebind({ ...base, externalEntityId: 'ext-9', reason: 'correcao manual auditada' });
  assert.equal(r.code, 'rebound');
  assert.equal(r.mapping.external_entity_id, 'ext-9');
  assert.equal(r.mapping.rebind_reason, 'correcao manual auditada');
  assert.equal(m.resolveExternal(base), 'ext-9');
});

// ───────────────────────────── RECONCILE ──────────────────────────────
test('reconcile: UNKNOWN nunca vira SUCCEEDED', () => {
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.SUCCEEDED), true);
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.UNKNOWN), false);
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.PENDING), false);
  assert.equal(normalizeReconcile('coisa_estranha'), RECONCILE_STATUS.UNKNOWN);
  assert.equal(normalizeReconcile(undefined), RECONCILE_STATUS.UNKNOWN);
});

test('reconcile: só NOT_FOUND/FAILED autorizam reenvio', () => {
  assert.equal(safeToRetry(RECONCILE_STATUS.NOT_FOUND), true);
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED), true);
  assert.equal(safeToRetry(RECONCILE_STATUS.PENDING), false);
  assert.equal(safeToRetry(RECONCILE_STATUS.UNKNOWN), false);
});

test('reconcile via gateway normaliza status desconhecido do adapter para UNKNOWN', async () => {
  fakeErpProvider.reset();
  fakeErpProvider.setReconcile('LICORNE'); // status inválido do "adapter"
  const env = buildEnvelope(envInput());
  const r = await gateway.reconcile(env, { mode: MODES.FAKE });
  assert.equal(r.status, RECONCILE_STATUS.UNKNOWN);
  fakeErpProvider.reset();
});

// ─────────────────────── ARQUITETURA / INÉRCIA ────────────────────────
test('camada de provider/erpHub NÃO importa supabase (arquitetural)', () => {
  const dir = path.join(__dirname, '..', 'services', 'erpHub');
  const arquivos = [];
  (function walk(d) {
    for (const nome of fs.readdirSync(d)) {
      const p = path.join(d, nome);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) arquivos.push(p);
    }
  })(dir);
  assert.ok(arquivos.length >= 8);
  for (const f of arquivos) {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(/require\(['"][^'"]*config\/supabase['"]\)/.test(src), false, `${path.basename(f)} importa supabase`);
    assert.equal(/require\(['"]axios['"]\)|fetch\(/.test(src), false, `${path.basename(f)} faz I/O de rede`);
  }
});

test('index expõe a superfície pública esperada', () => {
  for (const k of ['config', 'errors', 'capabilities', 'canonicalEnvelope', 'idempotency', 'reconcile', 'gateway', 'outboxContract', 'externalIdentityContract', 'diagnostics']) {
    assert.ok(hub[k], `faltou export: ${k}`);
  }
});

'use strict';

// Testes da fundação do ERP Integration Hub V1 (E3.7A) + hardening de contrato
// pré-merge (HIGH-01..06, MEDIUM-02/03). Provider-agnostic, schema-free,
// production-inert.

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
const {
  RECONCILE_STATUS, canPromoteToSucceeded, normalizeReconcile, safeToRetry,
} = require('../services/erpHub/reconcile');
const {
  deriveIdempotencyKey, idempotencyKeyForEnvelope, IDEMPOTENCY_EVENT_AUTHORITY,
} = require('../services/erpHub/idempotency');
const {
  createInMemoryOutbox, OUTBOX_STATUS, canTransition, sanitizeError,
} = require('../services/erpHub/outboxContract');
const { createInMemoryIdentityMap } = require('../services/erpHub/externalIdentityContract');

const envInput = (over = {}) => ({
  empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert',
  payload: { nome: 'X' }, ...over,
});
const env = (over = {}) => buildEnvelope(envInput(over));

// ────────────────────────────── ENVELOPE ──────────────────────────────
test('envelope: versionado e com todos os campos canônicos', () => {
  const e = buildEnvelope(envInput(), { now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(e.schema_version, SCHEMA_VERSION);
  for (const c of ['event_id', 'empresa_id', 'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source', 'payload', 'metadata']) {
    assert.ok(c in e, `campo ausente: ${c}`);
  }
  assert.equal(e.occurred_at, '2026-09-01T00:00:00.000Z');
  assert.equal(validateEnvelope(e).ok, true);
});

test('envelope: sanitiza segredos do payload e metadata (recursivo)', () => {
  const e = buildEnvelope(envInput({
    payload: { nome: 'X', apiKey: 'sk_live_123', nested: { password: 'p', ok: 1, authorization: 'Bearer z' } },
    metadata: { token: 'abc', refresh_token: 'r', keep: 'v' },
  }));
  const flat = JSON.stringify(e);
  for (const proibido of ['sk_live_123', 'password', 'authorization', 'refresh_token', 'apiKey', '"token"']) {
    assert.equal(flat.includes(proibido), false, `vazou: ${proibido}`);
  }
  assert.equal(e.payload.nome, 'X');
  assert.equal(e.payload.nested.ok, 1);
  assert.equal(e.metadata.keep, 'v');
});

test('envelope: recusa entradas inválidas com INVALID_ENVELOPE', () => {
  assert.throws(() => buildEnvelope(envInput({ empresaId: '' })), (e) => e instanceof ErpProviderError && e.code === 'INVALID_ENVELOPE');
  assert.throws(() => buildEnvelope(envInput({ entityType: '' })), (e) => e.code === 'INVALID_ENVELOPE');
  assert.throws(() => buildEnvelope(envInput({ eventType: '' })), (e) => e.code === 'INVALID_ENVELOPE');
});

test('sanitizeObject não muta a entrada', () => {
  const orig = { a: 1, secret: 'x' };
  const out = sanitizeObject(orig);
  assert.equal('secret' in orig, true);
  assert.equal('secret' in out, false);
});

// MEDIUM-02 — fail-closed
test('MEDIUM-02: envelope inbound com chave sensível é INVÁLIDO (ok=false)', () => {
  const base = env();
  const comSegredo = { ...base, payload: { ...base.payload, credentials: { password: 'p' } } };
  const r = validateEnvelope(comSegredo);
  assert.equal(r.ok, false, 'deveria recusar, não sinalizar ao lado');
  assert.equal(r.motivo, 'chave_sensivel_detectada');
  assert.match(r.chaveSensivel, /credentials|password/);
});

test('MEDIUM-02: detecta chave sensível aninhada em array e variações de caixa', () => {
  const base = env();
  const emArray = { ...base, payload: { itens: [{ ok: 1 }, { AUTHORIZATION: 'Bearer z' }] } };
  assert.equal(validateEnvelope(emArray).ok, false);
  const caixaMista = { ...base, payload: { Dados: { ApiKey: 'x' } } };
  assert.equal(validateEnvelope(caixaMista).ok, false);
  // metadata também é inspecionado
  const emMeta = { ...base, metadata: { Refresh_Token: 'r' } };
  assert.equal(validateEnvelope(emMeta).ok, false);
});

test('MEDIUM-02: valor de texto contendo a palavra "token" NÃO invalida (só chaves)', () => {
  const base = env();
  const ok = { ...base, payload: { observacao: 'o token do cliente expirou' } };
  assert.equal(validateEnvelope(ok).ok, true);
});

test('envelope: schema_version incompatível é recusado', () => {
  const e = { ...env(), schema_version: 99 };
  assert.equal(validateEnvelope(e).motivo, 'schema_version_incompativel');
});

// ───────────────────── HIGH-01 IDEMPOTÊNCIA ──────────────────────
test('HIGH-01: autoridade declarada é CANONICAL_INTENT_FINGERPRINT', () => {
  assert.equal(IDEMPOTENCY_EVENT_AUTHORITY, 'CANONICAL_INTENT_FINGERPRINT');
});

test('HIGH-01: retry do MESMO evento lógico produz a MESMA chave', () => {
  // Mesmo intent, envelopes distintos (event_id/occurred_at/request_id diferem):
  // é exatamente o cenário de um retry.
  const a = buildEnvelope(envInput({ requestId: 'req-A' }), { now: new Date('2026-09-01T00:00:00Z') });
  const b = buildEnvelope(envInput({ requestId: 'req-B' }), { now: new Date('2026-09-01T05:00:00Z') });
  assert.notEqual(a.event_id, b.event_id);
  assert.equal(idempotencyKeyForEnvelope('fake', a), idempotencyKeyForEnvelope('fake', b));
});

test('HIGH-01: revisões legítimas diferentes da MESMA entidade produzem chaves DIFERENTES', () => {
  const revA = env({ eventType: 'updated', payload: { nome: 'X', valor: 100 } });
  const revB = env({ eventType: 'updated', payload: { nome: 'X', valor: 250 } });
  assert.notEqual(
    idempotencyKeyForEnvelope('fake', revA),
    idempotencyKeyForEnvelope('fake', revB),
    'duas revisões distintas não podem colapsar na mesma chave',
  );
});

test('HIGH-01: ordem das chaves do payload não altera a identidade do evento', () => {
  const a = env({ payload: { nome: 'X', valor: 1 } });
  const b = env({ payload: { valor: 1, nome: 'X' } });
  assert.equal(idempotencyKeyForEnvelope('fake', a), idempotencyKeyForEnvelope('fake', b));
});

test('HIGH-01: tenant, provider, entidade e event_type isolam a chave', () => {
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert', schemaVersion: 1, payload: { a: 1 } };
  const k = deriveIdempotencyKey(base);
  assert.equal(k, deriveIdempotencyKey({ ...base }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, empresaId: 'emp-2' }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, provider: 'outro' }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, entityId: 'p-2' }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, eventType: 'deleted' }));
});

test('HIGH-01: mudança de schema_version reemite (comportamento explícito)', () => {
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert', payload: { a: 1 } };
  assert.notEqual(
    deriveIdempotencyKey({ ...base, schemaVersion: 1 }),
    deriveIdempotencyKey({ ...base, schemaVersion: 2 }),
  );
});

// ───────────────────────────── PROVIDER ───────────────────────────────
// HIGH-06 — disabled != unsupported
test('HIGH-06: provider disabled devolve DISABLED em send/lookup/reconcile', async () => {
  const e = env();
  for (const op of ['send', 'lookup', 'reconcile']) {
    await assert.rejects(
      () => gateway[op](e, { mode: MODES.DISABLED }),
      (err) => err instanceof ErpProviderError && err.code === 'DISABLED',
      `${op} deveria devolver DISABLED, não UNSUPPORTED_CAPABILITY`,
    );
  }
});

test('HIGH-06: capability não declarada por provider DISPONÍVEL devolve UNSUPPORTED_CAPABILITY', async () => {
  fakeErpProvider.reset();
  const capsOriginais = fakeErpProvider.capabilities;
  fakeErpProvider.capabilities = () => [CAPABILITY.LOOKUP]; // fake sem 'send'
  try {
    await assert.rejects(
      () => gateway.send(env(), { mode: MODES.FAKE }),
      (err) => err instanceof ErpProviderError && err.code === 'UNSUPPORTED_CAPABILITY',
    );
    // e a que ele declara continua funcionando
    const r = await gateway.lookup(env(), { mode: MODES.FAKE });
    assert.equal(r.found, true);
  } finally {
    fakeErpProvider.capabilities = capsOriginais;
  }
});

test('fake adapter é determinístico e declara capabilities', async () => {
  fakeErpProvider.reset();
  const e = env();
  assert.deepEqual(gateway.capabilities({ mode: MODES.FAKE }).sort(), [CAPABILITY.LOOKUP, CAPABILITY.RECONCILE, CAPABILITY.SEND].sort());
  const r1 = await gateway.send(e, { mode: MODES.FAKE });
  const r2 = await gateway.send(e, { mode: MODES.FAKE });
  assert.equal(r1.accepted, true);
  assert.equal(r1.external_entity_id, r2.external_entity_id);
});

test('capability desconhecida NUNCA é suportada', () => {
  assert.equal(gateway.supports('coisa_inexistente', { mode: MODES.FAKE }), false);
  assert.equal(gateway.supports(CAPABILITY.SEND, { mode: MODES.FAKE }), true);
  assert.equal(gateway.supports(CAPABILITY.SEND, { mode: MODES.DISABLED }), false);
});

test('fake propaga erros normalizados (não finge sucesso sob falha)', async () => {
  fakeErpProvider.reset();
  fakeErpProvider.setFailure('RATE_LIMIT');
  await assert.rejects(() => gateway.send(env(), { mode: MODES.FAKE }), (e) => e.code === 'RATE_LIMIT');
  fakeErpProvider.reset();
});

// ───────────────────────────── OUTBOX ─────────────────────────────────
// MEDIUM-03 — só envelope canônico
test('MEDIUM-03: outbox recusa payload arbitrário e envelope inválido', async () => {
  const ob = createInMemoryOutbox();
  const r1 = await ob.enqueue({ envelope: { qualquer: 'coisa' }, dedupeKey: 'k' });
  assert.equal(r1.enfileirado, false);
  assert.equal(r1.code, 'invalid_envelope');

  const base = env();
  const comSegredo = { ...base, payload: { senha: 'x' } };
  const r2 = await ob.enqueue({ envelope: comSegredo, dedupeKey: 'k2' });
  assert.equal(r2.enfileirado, false, 'envelope com segredo não pode ser enfileirado');
  assert.equal(r2.motivo, 'chave_sensivel_detectada');

  const r3 = await ob.enqueue({ envelope: { ...base, schema_version: 99 }, dedupeKey: 'k3' });
  assert.equal(r3.motivo, 'schema_version_incompativel');
});

test('MEDIUM-03: event_type e empresa_id vêm do envelope (autoridade única)', async () => {
  const ob = createInMemoryOutbox();
  const e = env({ eventType: 'updated' });
  const { item } = await ob.enqueue({ envelope: e, dedupeKey: 'k1' });
  assert.equal(item.event_type, e.event_type);
  assert.equal(item.empresa_id, e.empresa_id);
});

test('outbox: enfileirar é idempotente por dedupe_key', async () => {
  const ob = createInMemoryOutbox();
  const e = env();
  const a = await ob.enqueue({ envelope: e, dedupeKey: 'erp:fake:abc' });
  const b = await ob.enqueue({ envelope: e, dedupeKey: 'erp:fake:abc' });
  assert.equal(a.enfileirado, true);
  assert.equal(b.enfileirado, false);
  assert.equal(b.code, 'duplicate');
  assert.equal((await ob.countByStatus('emp-1')).pending, 1);
});

// HIGH-02 — tenant safety na própria camada
test('HIGH-02: mesma dedupe_key em tenants diferentes gera itens INDEPENDENTES', async () => {
  const ob = createInMemoryOutbox();
  const a = await ob.enqueue({ envelope: env({ empresaId: 'emp-A' }), dedupeKey: 'same' });
  const b = await ob.enqueue({ envelope: env({ empresaId: 'emp-B' }), dedupeKey: 'same' });
  assert.equal(a.enfileirado, true);
  assert.equal(b.enfileirado, true, 'tenant B não pode ser descartado como duplicata de A');
  assert.notEqual(a.item.id, b.item.id);
  assert.equal((await ob.countByStatus('emp-A')).pending, 1);
  assert.equal((await ob.countByStatus('emp-B')).pending, 1);
});

test('HIGH-02: duplicate só devolve item do PRÓPRIO tenant', async () => {
  const ob = createInMemoryOutbox();
  const a = await ob.enqueue({ envelope: env({ empresaId: 'emp-A' }), dedupeKey: 'same' });
  await ob.enqueue({ envelope: env({ empresaId: 'emp-B' }), dedupeKey: 'same' });
  const dupA = await ob.enqueue({ envelope: env({ empresaId: 'emp-A' }), dedupeKey: 'same' });
  assert.equal(dupA.code, 'duplicate');
  assert.equal(dupA.item.empresa_id, 'emp-A');
  assert.equal(dupA.item.id, a.item.id);
});

// HIGH-04 — lease / reclaim / stale claim
test('HIGH-04: claim devolve token e define lease', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const c = await ob.claimNext();
  assert.equal(c.code, 'claimed');
  assert.ok(c.claimToken);
  assert.equal(c.item.status, OUTBOX_STATUS.PROCESSING);
  assert.equal(c.item.attempts, 1);
  assert.ok(c.item.lease_expires_at);
  const r = await ob.markProcessed(c.item.id, c.claimToken);
  assert.equal(r.code, 'processed');
});

test('HIGH-04: antes do lease expirar, outro worker NÃO pega o item', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const a = await ob.claimNext();
  assert.equal(a.code, 'claimed');
  const b = await ob.claimNext({ now: new Date(Date.now() + 30000) }); // dentro do lease
  assert.equal(b.code, 'empty', 'item ainda tem dono');
});

test('HIGH-04: após o lease expirar, o item é RECLAMADO deterministicamente', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const a = await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  const b = await ob.claimNext({ now: depois });
  assert.equal(b.code, 'reclaimed');
  assert.notEqual(b.claimToken, a.claimToken);
  assert.equal(b.item.attempts, 2);
});

test('HIGH-04: claim OBSOLETO não finaliza o trabalho de quem reclamou', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const a = await ob.claimNext();                                   // worker A
  const depois = new Date(Date.now() + 120000);
  const b = await ob.claimNext({ now: depois });                    // worker B reclama
  // A "volta do limbo" e tenta concluir — precisa ser recusado.
  const stale = await ob.markProcessed(a.item.id, a.claimToken, { now: depois });
  assert.equal(stale.code, 'stale_claim');
  const staleFail = await ob.markFailed(a.item.id, a.claimToken, 'erro', { now: depois });
  assert.equal(staleFail.code, 'stale_claim');
  // B conclui normalmente.
  const ok = await ob.markProcessed(b.item.id, b.claimToken, { now: depois });
  assert.equal(ok.code, 'processed');
});

test('HIGH-04: sem token não se finaliza item', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const c = await ob.claimNext();
  assert.equal((await ob.markProcessed(c.item.id, null)).code, 'stale_claim');
  assert.equal((await ob.markProcessed(c.item.id, 'token-inventado')).code, 'stale_claim');
});

test('HIGH-04: estados terminais (processed/dead) nunca são reclamados', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 1 });
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  const c = await ob.claimNext();
  await ob.markProcessed(c.item.id, c.claimToken);
  const futuro = new Date(Date.now() + 10 * 60 * 1000);
  assert.equal((await ob.claimNext({ now: futuro })).code, 'empty');
});

test('outbox: retry com backoff e depois morre (dead) sem loop infinito', async () => {
  const ob = createInMemoryOutbox({ maxAttempts: 2 });
  await ob.enqueue({ envelope: env(), dedupeKey: 'k1' });
  let c = await ob.claimNext();
  let f = await ob.markFailed(c.item.id, c.claimToken, 'falha de transporte');
  assert.equal(f.code, 'failed');
  assert.ok(f.item.next_retry_at);
  const futuro = new Date(Date.now() + 3 * 60 * 60 * 1000);
  c = await ob.claimNext({ now: futuro });
  assert.equal(c.code, 'claimed');
  f = await ob.markFailed(c.item.id, c.claimToken, 'falhou de novo', { now: futuro });
  assert.equal(f.code, 'dead');
  assert.equal(f.item.next_retry_at, null);
});

test('outbox: máquina de estados recusa transições inválidas', () => {
  assert.equal(canTransition('pending', 'processing'), true);
  assert.equal(canTransition('processing', 'processed'), true);
  assert.equal(canTransition('processing', 'processing'), true); // reclaim
  assert.equal(canTransition('processed', 'processing'), false);
  assert.equal(canTransition('dead', 'processing'), false);
});

test('outbox: tenant isolation nas contagens', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ envelope: env({ empresaId: 'emp-1' }), dedupeKey: 'a' });
  await ob.enqueue({ envelope: env({ empresaId: 'emp-2' }), dedupeKey: 'b' });
  assert.equal((await ob.countByStatus('emp-1')).pending, 1);
  assert.equal((await ob.countByStatus('emp-2')).pending, 1);
  assert.equal(ob._all('emp-1').length, 1);
});

// ───────────────────── SANITIZAÇÃO DE ERRO ────────────────────────────
test('sanitizeError: não vaza Bearer, api key, segredo em query nem hash longo', () => {
  const s = sanitizeError('falhou Authorization: Bearer abc.def.ghi ao chamar https://erp.example.com/v1?api_key=supersecreto123 com sk_live_ABCDEFGH12345678 hash=0123456789abcdef0123456789abcdef');
  assert.equal(/abc\.def\.ghi/.test(s), false, 'vazou bearer');
  assert.equal(/supersecreto123/.test(s), false, 'vazou segredo de query');
  assert.equal(/sk_live_ABCDEFGH12345678/.test(s), false, 'vazou api key');
  assert.equal(/0123456789abcdef0123456789abcdef/.test(s), false, 'vazou hash longo');
});

test('sanitizeError: mensagem truncada continua segura (sanitiza antes de cortar)', () => {
  const ruido = 'x'.repeat(600);
  const s = sanitizeError(`${ruido} Bearer segredo_no_fim_da_mensagem`);
  assert.ok(s.length <= 500);
  assert.equal(/segredo_no_fim_da_mensagem/.test(s), false);
});

// ───────────────────── HIGH-03 EXTERNAL IDENTITY ──────────────────────
test('external identity: bind idempotente e recusa colisões', () => {
  const m = createInMemoryIdentityMap();
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' };
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-1' }).code, 'bound');
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-1' }).code, 'idempotent');
  assert.equal(m.bind({ ...base, externalEntityId: 'ext-2' }).code, 'conflict_internal_already_bound');
  assert.equal(m.bind({ ...base, internalEntityId: 'p-2', externalEntityId: 'ext-1' }).code, 'conflict_external_already_bound');
});

test('HIGH-03: rebind NÃO sequestra external de outro internal e não corrompe índices', () => {
  const m = createInMemoryIdentityMap();
  const comum = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro' };
  m.bind({ ...comum, internalEntityId: 'A', externalEntityId: 'ext1' });
  m.bind({ ...comum, internalEntityId: 'B', externalEntityId: 'ext2' });

  const r = m.rebind({ ...comum, internalEntityId: 'A', externalEntityId: 'ext2', reason: 'tentativa indevida' });
  assert.equal(r.code, 'conflict_external_already_bound');
  assert.equal(r.internal, 'B');

  // Nenhum estado parcial: os dois mapeamentos seguem íntegros nos DOIS sentidos.
  assert.equal(m.resolveExternal({ ...comum, internalEntityId: 'A' }), 'ext1');
  assert.equal(m.resolveExternal({ ...comum, internalEntityId: 'B' }), 'ext2');
  assert.equal(m.resolveInternal({ ...comum, externalEntityId: 'ext1' }), 'A');
  assert.equal(m.resolveInternal({ ...comum, externalEntityId: 'ext2' }), 'B');
});

test('HIGH-03: rebind exige motivo, valida external e é idempotente para o mesmo destino', () => {
  const m = createInMemoryIdentityMap();
  const base = { provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' };
  m.bind({ ...base, externalEntityId: 'ext-1' });
  assert.equal(m.rebind({ ...base, externalEntityId: 'ext-9' }).code, 'reason_required');
  // external vazio é recusado com o mesmo rigor do bind
  assert.throws(() => m.rebind({ ...base, externalEntityId: '', reason: 'x' }), /campo obrigatorio ausente/);
  // mesmo external = no-op
  assert.equal(m.rebind({ ...base, externalEntityId: 'ext-1', reason: 'sem mudanca' }).code, 'idempotent');
  // rebind legítimo
  const ok = m.rebind({ ...base, externalEntityId: 'ext-9', reason: 'correcao manual auditada' });
  assert.equal(ok.code, 'rebound');
  assert.equal(ok.mapping.rebind_reason, 'correcao manual auditada');
  assert.equal(m.resolveExternal(base), 'ext-9');
  // o external antigo foi liberado
  assert.equal(m.resolveInternal({ ...base, externalEntityId: 'ext-1' }), null);
});

test('HIGH-03: rebind de mapping inexistente é not_found', () => {
  const m = createInMemoryIdentityMap();
  const r = m.rebind({ provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'nao-existe', externalEntityId: 'ext', reason: 'x' });
  assert.equal(r.code, 'not_found');
});

test('external identity: tenant/provider-safe (sem vazamento cruzado)', () => {
  const m = createInMemoryIdentityMap();
  m.bind({ provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1', externalEntityId: 'ext-1' });
  assert.equal(m.resolveExternal({ provider: 'fake', empresaId: 'emp-2', entityType: 'parceiro', internalEntityId: 'p-1' }), null);
  assert.equal(m.resolveExternal({ provider: 'fake', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1' }), 'ext-1');
  // mesmo external id em outro tenant/provider não colide
  assert.equal(m.bind({ provider: 'outro', empresaId: 'emp-1', entityType: 'parceiro', internalEntityId: 'p-1', externalEntityId: 'ext-1' }).code, 'bound');
  assert.equal(m.bind({ provider: 'fake', empresaId: 'emp-2', entityType: 'parceiro', internalEntityId: 'p-1', externalEntityId: 'ext-1' }).code, 'bound');
});

// ───────────────────────────── RECONCILE ──────────────────────────────
test('reconcile: UNKNOWN nunca vira SUCCEEDED', () => {
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.SUCCEEDED), true);
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.UNKNOWN), false);
  assert.equal(canPromoteToSucceeded(RECONCILE_STATUS.PENDING), false);
  assert.equal(normalizeReconcile('coisa_estranha'), RECONCILE_STATUS.UNKNOWN);
  assert.equal(normalizeReconcile(undefined), RECONCILE_STATUS.UNKNOWN);
});

// HIGH-05
test('HIGH-05: FAILED não é genericamente seguro para retry', () => {
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED), false, 'sem evidência, não reenviar');
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED, {}), false);
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED, { retry_safe: false }), false);
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED, { retry_safe: 'sim' }), false, 'só o booleano true conta');
  assert.equal(safeToRetry(RECONCILE_STATUS.FAILED, { retry_safe: true }), true, 'com evidência explícita, pode');
});

test('HIGH-05: NOT_FOUND é seguro; PENDING/UNKNOWN/SUCCEEDED não', () => {
  assert.equal(safeToRetry(RECONCILE_STATUS.NOT_FOUND), true);
  assert.equal(safeToRetry(RECONCILE_STATUS.PENDING), false);
  assert.equal(safeToRetry(RECONCILE_STATUS.UNKNOWN), false);
  assert.equal(safeToRetry(RECONCILE_STATUS.SUCCEEDED), false);
  // evidência não promove estados que não são FAILED
  assert.equal(safeToRetry(RECONCILE_STATUS.UNKNOWN, { retry_safe: true }), false);
});

test('reconcile via gateway normaliza status desconhecido do adapter para UNKNOWN', async () => {
  fakeErpProvider.reset();
  fakeErpProvider.setReconcile('LICORNE');
  const r = await gateway.reconcile(env(), { mode: MODES.FAKE });
  assert.equal(r.status, RECONCILE_STATUS.UNKNOWN);
  fakeErpProvider.reset();
});

// ─────────────────────── ARQUITETURA / INÉRCIA ────────────────────────
test('camada erpHub NÃO importa supabase nem faz I/O de rede (arquitetural)', () => {
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

// Comportamento, não só regex: o provider default não alcança rede nem inventa sucesso.
test('inércia funcional: modo default de produção não produz efeito algum', async () => {
  const modoAnterior = process.env.ERP_PROVIDER_MODE;
  delete process.env.ERP_PROVIDER_MODE;
  try {
    const { resolveMode, isEnabled, providerAvailable } = require('../services/erpHub/config');
    assert.equal(resolveMode(), MODES.DISABLED);
    assert.equal(isEnabled(), false);
    assert.equal(providerAvailable(), false);
    assert.deepEqual(gateway.capabilities(), []);
    await assert.rejects(() => gateway.send(env()), (e) => e.code === 'DISABLED');
  } finally {
    if (modoAnterior !== undefined) process.env.ERP_PROVIDER_MODE = modoAnterior;
  }
});

test('config: valor desconhecido de ERP_PROVIDER_MODE resolve para disabled (fail-safe)', () => {
  const anterior = process.env.ERP_PROVIDER_MODE;
  process.env.ERP_PROVIDER_MODE = 'sankhya';
  try {
    const { resolveMode } = require('../services/erpHub/config');
    assert.equal(resolveMode(), MODES.DISABLED, 'nome de ERP real não pode ligar provider');
  } finally {
    if (anterior === undefined) delete process.env.ERP_PROVIDER_MODE;
    else process.env.ERP_PROVIDER_MODE = anterior;
  }
});

test('index expõe a superfície pública esperada', () => {
  for (const k of ['config', 'errors', 'capabilities', 'canonicalEnvelope', 'idempotency', 'reconcile', 'gateway', 'outboxContract', 'externalIdentityContract', 'diagnostics']) {
    assert.ok(hub[k], `faltou export: ${k}`);
  }
});

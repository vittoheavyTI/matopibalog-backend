'use strict';

// Testes da fundação do ERP Integration Hub V1 (E3.7A) + hardening de contrato
// pré-merge (R2: HIGH-01..06/MEDIUM-02/03; R3: HIGH-01..05/MEDIUM-01/02).
// Provider-agnostic, schema-free, production-inert.
//
// Regra de qualidade desta suíte: prova por COMPORTAMENTO. Nada aqui verifica
// autoridade funcional lendo texto, e o cenário de crash conta chamadas reais ao
// provider em vez de confiar no resultado que se quer provar.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hub = require('../services/erpHub');
const { MODES, LIMITS } = require('../services/erpHub/config');
const { ErpProviderError } = require('../services/erpHub/errors');
const { CAPABILITY } = require('../services/erpHub/capabilities');
const {
  buildEnvelope, validateEnvelope, sanitizeObject, SCHEMA_VERSION,
  CANONICAL_TOP_LEVEL_FIELDS, canonicalizeJsonSafe, CanonicalJsonError,
} = require('../services/erpHub/canonicalEnvelope');
const gateway = require('../services/erpHub/erpProviderGateway');
const { fakeErpProvider } = require('../services/erpHub/providers/fakeErpProvider');
const {
  RECONCILE_STATUS, canPromoteToSucceeded, normalizeReconcile, safeToRetry,
} = require('../services/erpHub/reconcile');
const {
  deriveIdempotencyKey, idempotencyKeyForEnvelope, intentFingerprintForEnvelope,
  ERP_EVENT_IDENTITY, ERP_INTENT_FINGERPRINT,
} = require('../services/erpHub/idempotency');
const {
  createInMemoryOutbox, OUTBOX_STATUS, CLAIM_ACTION, canTransition, sanitizeError,
  OUTBOX_PROVIDER_AUTHORITY, OUTBOX_DEDUPE_AUTHORITY, ERP_OUTBOX_AMBIGUOUS_RECOVERY,
} = require('../services/erpHub/outboxContract');
const { createInMemoryIdentityMap } = require('../services/erpHub/externalIdentityContract');

const envInput = (over = {}) => ({
  empresaId: 'emp-1', entityType: 'parceiro', entityId: 'p-1', eventType: 'upsert',
  payload: { nome: 'X' }, ...over,
});
const env = (over = {}, opts = {}) => buildEnvelope(envInput(over), opts);

// Encadeia `n` níveis de objeto: o valor mais interno fica na profundidade `n`.
function aninhar(n, folha = 'fim') {
  let v = folha;
  for (let i = 0; i < n; i += 1) v = { nivel: v };
  return v;
}

// ────────────────────────────── ENVELOPE ──────────────────────────────
test('envelope: versionado e com todos os campos canônicos', () => {
  const e = buildEnvelope(envInput(), { now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(e.schema_version, SCHEMA_VERSION);
  for (const c of ['event_id', 'empresa_id', 'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source', 'payload', 'metadata']) {
    assert.ok(c in e, `campo ausente: ${c}`);
  }
  assert.equal(e.occurred_at, '2026-09-01T00:00:00.000Z');
  assert.equal(validateEnvelope(e).ok, true);
  // O envelope produzido não tem campo nenhum fora da forma canônica.
  for (const k of Object.keys(e)) assert.ok(CANONICAL_TOP_LEVEL_FIELDS.includes(k), `campo extra: ${k}`);
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

// MEDIUM-02 (R2) — fail-closed para chave sensível
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

// ───────── R3-MEDIUM-01: forma FECHADA e bounds SIMÉTRICOS no inbound ─────────
test('R3-MEDIUM-01: campo top-level desconhecido invalida o envelope', () => {
  const r = validateEnvelope({ ...env(), extra_do_futuro: 1 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /^campo_top_level_desconhecido:extra_do_futuro$/);
});

test('R3-MEDIUM-01: segredo no TOPO do envelope é recusado (não só em payload/metadata)', () => {
  // Este era o furo: a varredura de segredo só olhava payload/metadata, então
  // `{ ...envelope, authorization: 'Bearer ...' }` passava intacto.
  const comAuth = validateEnvelope({ ...env(), authorization: 'Bearer zzz' });
  assert.equal(comAuth.ok, false);
  assert.equal(comAuth.chaveSensivel, 'authorization');
  const comSecret = validateEnvelope({ ...env(), client_secret: 'zzz' });
  assert.equal(comSecret.ok, false);
  assert.equal(comSecret.chaveSensivel, 'client_secret');
});

test('R3-MEDIUM-01: metadata precisa ser objeto JSON (string/array recusados)', () => {
  assert.equal(validateEnvelope({ ...env(), metadata: 'texto' }).motivo, 'metadata_invalido');
  assert.equal(validateEnvelope({ ...env(), metadata: [1, 2] }).motivo, 'metadata_invalido');
  assert.equal(validateEnvelope({ ...env(), payload: [1, 2] }).motivo, 'payload_invalido');
  assert.equal(validateEnvelope({ ...env(), payload: 'texto' }).motivo, 'payload_invalido');
});

test('R3-MEDIUM-01: metadata acima do limite de chaves é recusado no inbound', () => {
  const metadata = {};
  for (let i = 0; i <= LIMITS.MAX_METADATA_KEYS; i += 1) metadata[`k${i}`] = i;
  assert.equal(validateEnvelope({ ...env(), metadata }).motivo, 'metadata_excede_limite_de_chaves');
});

test('R3-MEDIUM-01: bounds de tamanho valem no inbound, não só no builder', () => {
  const base = env();
  const casos = [
    ['entity_type', 'x'.repeat(LIMITS.MAX_ENTITY_TYPE + 1)],
    ['entity_id', 'x'.repeat(LIMITS.MAX_ENTITY_ID + 1)],
    ['event_type', 'x'.repeat(LIMITS.MAX_EVENT_TYPE + 1)],
    ['source', 'x'.repeat(LIMITS.MAX_SOURCE + 1)],
    ['event_id', 'x'.repeat(LIMITS.MAX_EVENT_ID + 1)],
    ['empresa_id', 'x'.repeat(LIMITS.MAX_EMPRESA_ID + 1)],
  ];
  for (const [campo, valor] of casos) {
    const r = validateEnvelope({ ...base, [campo]: valor });
    assert.equal(r.ok, false, `${campo} excessivo deveria invalidar`);
    assert.equal(r.motivo, `campo_excede_limite:${campo}`);
  }
  const corr = validateEnvelope({ ...base, correlation_id: 'x'.repeat(LIMITS.MAX_CORRELATION_ID + 1) });
  assert.equal(corr.motivo, 'campo_opcional_invalido:correlation_id');
  const req = validateEnvelope({ ...base, request_id: 'x'.repeat(LIMITS.MAX_REQUEST_ID + 1) });
  assert.equal(req.motivo, 'campo_opcional_invalido:request_id');
  const reqTipo = validateEnvelope({ ...base, request_id: 42 });
  assert.equal(reqTipo.motivo, 'campo_opcional_invalido:request_id');
});

test('R3-MEDIUM-01: occurred_at precisa ser data real, não só string não vazia', () => {
  assert.equal(validateEnvelope({ ...env(), occurred_at: 'ontem' }).motivo, 'occurred_at_invalido');
  assert.equal(validateEnvelope({ ...env(), occurred_at: '2026-13-45T99:99:99Z' }).motivo, 'occurred_at_invalido');
  assert.equal(validateEnvelope({ ...env(), occurred_at: '2026-09-01T00:00:00.000Z' }).ok, true);
});

test('R3-MEDIUM-01: teto de tamanho serializado também vale no inbound', () => {
  const grande = { ...env(), payload: { blob: 'x'.repeat(LIMITS.MAX_PAYLOAD_BYTES + 10) } };
  assert.equal(validateEnvelope(grande).motivo, 'envelope_excede_teto_de_tamanho');
  // e o builder recusa a MESMA coisa (simetria)
  assert.throws(
    () => buildEnvelope(envInput({ payload: { blob: 'x'.repeat(LIMITS.MAX_PAYLOAD_BYTES + 10) } })),
    (e) => e.code === 'INVALID_ENVELOPE',
  );
});

test('R3-MEDIUM-01: build e validate concordam (simetria provada por varredura)', () => {
  // Para cada entrada abaixo: ou o builder recusa, ou o que ele produz é válido.
  // Nunca "o builder aceita e o validator recusa".
  const entradas = [
    envInput(),
    envInput({ metadata: { a: 1 } }),
    envInput({ correlationId: 'c-1', requestId: 'r-1' }),
    envInput({ entityType: 'x'.repeat(LIMITS.MAX_ENTITY_TYPE + 1) }),
    envInput({ entityId: 'x'.repeat(LIMITS.MAX_ENTITY_ID + 1) }),
    envInput({ source: 'x'.repeat(LIMITS.MAX_SOURCE + 1) }),
    envInput({ correlationId: 'x'.repeat(LIMITS.MAX_CORRELATION_ID + 1) }),
    envInput({ payload: aninhar(LIMITS.MAX_PAYLOAD_DEPTH + 4) }),
    envInput({ payload: { d: new Date() } }),
  ];
  for (const entrada of entradas) {
    let construido = null;
    try {
      construido = buildEnvelope(entrada);
    } catch (e) {
      assert.ok(e instanceof ErpProviderError && e.code === 'INVALID_ENVELOPE');
      continue;
    }
    const v = validateEnvelope(construido);
    assert.equal(v.ok, true, `builder aceitou algo que o validator recusa: ${v.motivo}`);
  }
});

// ───────── R3-MEDIUM-02: profundidade e JSON-safety recusam, não truncam ─────────
test('R3-MEDIUM-02: estourar a profundidade INVALIDA (não vira null em silêncio)', () => {
  const fundo = aninhar(LIMITS.MAX_PAYLOAD_DEPTH + 3);
  assert.throws(
    () => buildEnvelope(envInput({ payload: fundo })),
    (e) => e instanceof ErpProviderError && e.code === 'INVALID_ENVELOPE' && /profundidade_excedida/.test(e.detail),
  );
  const r = validateEnvelope({ ...env(), payload: fundo });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'profundidade_excedida');
  // dentro do limite continua passando normalmente
  assert.equal(validateEnvelope({ ...env(), payload: aninhar(3) }).ok, true);
});

test('R3-MEDIUM-02: dois payloads que só diferem ALÉM do limite não colapsam num fingerprint', () => {
  // Se a profundidade fosse truncada em `null`, estes dois dariam o mesmo hash —
  // e uma revisão de negócio sumiria. Agora nenhum dos dois chega a ter hash.
  const a = { ...env(), payload: aninhar(LIMITS.MAX_PAYLOAD_DEPTH + 3, 'A') };
  const b = { ...env(), payload: aninhar(LIMITS.MAX_PAYLOAD_DEPTH + 3, 'B') };
  assert.equal(validateEnvelope(a).ok, false);
  assert.equal(validateEnvelope(b).ok, false);
  assert.throws(() => intentFingerprintForEnvelope(a), (e) => e instanceof CanonicalJsonError);
  assert.throws(() => intentFingerprintForEnvelope(b), (e) => e instanceof CanonicalJsonError);
});

test('R3-MEDIUM-02: conteúdo não-JSON-safe é recusado EXPLICITAMENTE', () => {
  const casos = [
    ['bigint', { v: 10n }],
    ['function', { v: () => 1 }],
    ['symbol', { v: Symbol('s') }],
    ['NaN', { v: NaN }],
    ['Infinity', { v: Infinity }],
    ['Date', { v: new Date() }],
    ['Map', { v: new Map() }],
    ['undefined em array', { v: [1, undefined, 3] }],
  ];
  for (const [nome, payload] of casos) {
    assert.throws(
      () => buildEnvelope(envInput({ payload })),
      (e) => e instanceof ErpProviderError && e.code === 'INVALID_ENVELOPE',
      `${nome} deveria ser recusado no builder`,
    );
    const r = validateEnvelope({ ...env(), payload });
    assert.equal(r.ok, false, `${nome} deveria ser recusado no validator`);
    assert.equal(r.motivo, 'valor_nao_json_safe');
  }
});

test('R3-MEDIUM-02: canonicalização ordena chaves e preserva ordem de array', () => {
  assert.deepEqual(
    Object.keys(canonicalizeJsonSafe({ b: 1, a: 2, c: 3 })),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(canonicalizeJsonSafe({ l: [3, 1, 2] }).l, [3, 1, 2]);
});

// ───────────────── R3-HIGH-01: IDENTIDADE DO EVENTO ─────────────────
test('R3-HIGH-01: as duas autoridades são distintas e nomeadas', () => {
  assert.equal(ERP_EVENT_IDENTITY, 'LOGICAL_EVENT_ID');
  assert.equal(ERP_INTENT_FINGERPRINT, 'CONFLICT_GUARD');
});

test('R3-HIGH-01: event_id fornecido é PRESERVADO (retry reusa a mesma ocorrência)', () => {
  const e = buildEnvelope(envInput(), { eventId: 'ev-fixo-1' });
  assert.equal(e.event_id, 'ev-fixo-1');
  // e o builder gera um novo quando a ocorrência está sendo CRIADA
  const novo = buildEnvelope(envInput());
  assert.notEqual(novo.event_id, buildEnvelope(envInput()).event_id);
});

test('R3-HIGH-01: retry do MESMO evento lógico produz a MESMA chave', () => {
  // Mesmo event_id, tentativas distintas (request_id/occurred_at diferem).
  const a = buildEnvelope(envInput({ requestId: 'req-A' }), { eventId: 'ev-1', now: new Date('2026-09-01T00:00:00Z') });
  const b = buildEnvelope(envInput({ requestId: 'req-B' }), { eventId: 'ev-1', now: new Date('2026-09-01T05:00:00Z') });
  assert.notEqual(a.request_id, b.request_id);
  assert.notEqual(a.occurred_at, b.occurred_at);
  assert.equal(idempotencyKeyForEnvelope('fake', a), idempotencyKeyForEnvelope('fake', b));
  assert.equal(intentFingerprintForEnvelope(a), intentFingerprintForEnvelope(b));
});

test('R3-HIGH-01: A→B→A são TRÊS ocorrências distintas (payload repetido ≠ evento repetido)', () => {
  const e1 = buildEnvelope(envInput({ eventType: 'status', payload: { status: 'A' } }), { eventId: 'ID1' });
  const e2 = buildEnvelope(envInput({ eventType: 'status', payload: { status: 'B' } }), { eventId: 'ID2' });
  const e3 = buildEnvelope(envInput({ eventType: 'status', payload: { status: 'A' } }), { eventId: 'ID3' });

  const k1 = idempotencyKeyForEnvelope('fake', e1);
  const k2 = idempotencyKeyForEnvelope('fake', e2);
  const k3 = idempotencyKeyForEnvelope('fake', e3);
  assert.notEqual(k1, k2);
  assert.notEqual(k1, k3, 'E3 não pode ser descartado como replay de E1');
  assert.notEqual(k2, k3);

  // E1 e E3 têm a MESMA intenção — o fingerprint não é identidade, é guarda.
  assert.equal(intentFingerprintForEnvelope(e1), intentFingerprintForEnvelope(e3));
});

test('R3-HIGH-01: a chave NÃO depende do payload (mesma ocorrência, conteúdo diferente)', () => {
  const a = buildEnvelope(envInput({ payload: { v: 1 } }), { eventId: 'ID1' });
  const b = buildEnvelope(envInput({ payload: { v: 999 } }), { eventId: 'ID1' });
  assert.equal(idempotencyKeyForEnvelope('fake', a), idempotencyKeyForEnvelope('fake', b), 'mesma ocorrência = mesma chave');
  assert.notEqual(intentFingerprintForEnvelope(a), intentFingerprintForEnvelope(b), 'intenções diferentes = conflito detectável');
});

test('R3-HIGH-01: ordem das chaves do payload não altera o fingerprint', () => {
  const a = buildEnvelope(envInput({ payload: { nome: 'X', valor: 1 } }), { eventId: 'ID1' });
  const b = buildEnvelope(envInput({ payload: { valor: 1, nome: 'X' } }), { eventId: 'ID1' });
  assert.equal(intentFingerprintForEnvelope(a), intentFingerprintForEnvelope(b));
});

test('R3-HIGH-01: tenant e provider isolam a chave', () => {
  const base = { provider: 'fake', empresaId: 'emp-1', eventId: 'ID1', schemaVersion: 1 };
  const k = deriveIdempotencyKey(base);
  assert.equal(k, deriveIdempotencyKey({ ...base }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, empresaId: 'emp-2' }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, provider: 'outro' }));
  assert.notEqual(k, deriveIdempotencyKey({ ...base, eventId: 'ID2' }));
});

test('R3-HIGH-01: mudança de schema_version reemite (comportamento explícito)', () => {
  const base = { provider: 'fake', empresaId: 'emp-1', eventId: 'ID1' };
  assert.notEqual(
    deriveIdempotencyKey({ ...base, schemaVersion: 1 }),
    deriveIdempotencyKey({ ...base, schemaVersion: 2 }),
  );
});

test('R3-HIGH-01: metadata e transporte NÃO entram na intenção', () => {
  const a = buildEnvelope(envInput({ metadata: { origem: 'a' }, requestId: 'r1', correlationId: 'c1' }), { eventId: 'ID1' });
  const b = buildEnvelope(envInput({ metadata: { origem: 'b' }, requestId: 'r2', correlationId: 'c2' }), { eventId: 'ID1' });
  assert.equal(intentFingerprintForEnvelope(a), intentFingerprintForEnvelope(b));
});

test('R3-HIGH-01: entity/event_type/source COMPÕEM a intenção', () => {
  const base = buildEnvelope(envInput(), { eventId: 'ID1' });
  const f = intentFingerprintForEnvelope(base);
  for (const over of [{ entityType: 'frete' }, { entityId: 'p-9' }, { eventType: 'deleted' }, { source: 'outro' }]) {
    const outro = buildEnvelope(envInput(over), { eventId: 'ID1' });
    assert.notEqual(intentFingerprintForEnvelope(outro), f, `${Object.keys(over)[0]} deveria mudar a intenção`);
  }
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
test('outbox: autoridades declaradas', () => {
  assert.equal(OUTBOX_PROVIDER_AUTHORITY, 'EXPLICIT');
  assert.equal(OUTBOX_DEDUPE_AUTHORITY, 'EMPRESA_ID+PROVIDER+EVENT_ID');
  assert.equal(ERP_OUTBOX_AMBIGUOUS_RECOVERY, 'RECONCILE_BEFORE_RESEND');
});

test('MEDIUM-03: outbox recusa payload arbitrário e envelope inválido', async () => {
  const ob = createInMemoryOutbox();
  const r1 = await ob.enqueue({ provider: 'fake', envelope: { qualquer: 'coisa' } });
  assert.equal(r1.enfileirado, false);
  assert.equal(r1.code, 'invalid_envelope');

  const base = env();
  const comSegredo = { ...base, payload: { senha: 'x' } };
  const r2 = await ob.enqueue({ provider: 'fake', envelope: comSegredo });
  assert.equal(r2.enfileirado, false, 'envelope com segredo não pode ser enfileirado');
  assert.equal(r2.motivo, 'chave_sensivel_detectada');

  const r3 = await ob.enqueue({ provider: 'fake', envelope: { ...base, schema_version: 99 } });
  assert.equal(r3.motivo, 'schema_version_incompativel');
});

// R3-HIGH-02 — provider é campo do outbox e o dedupe é DERIVADO pela camada
test('R3-HIGH-02: provider é obrigatório e explícito no enqueue', async () => {
  const ob = createInMemoryOutbox();
  await assert.rejects(() => ob.enqueue({ envelope: env() }), /provider obrigatorio/);
  await assert.rejects(() => ob.enqueue({ provider: '  ', envelope: env() }), /provider obrigatorio/);
  const r = await ob.enqueue({ provider: 'fake', envelope: env() });
  assert.equal(r.item.provider, 'fake');
});

test('R3-HIGH-02: dedupe_key e fingerprint são DERIVADOS pela camada, não recebidos', async () => {
  const ob = createInMemoryOutbox();
  const e = env({}, { eventId: 'ID1' });
  const r = await ob.enqueue({ provider: 'fake', envelope: e });
  assert.equal(r.item.dedupe_key, idempotencyKeyForEnvelope('fake', e));
  assert.equal(r.item.intent_fingerprint, intentFingerprintForEnvelope(e));
  assert.equal(r.item.event_id, 'ID1');
  // empresa_id e event_type continuam vindo do envelope (autoridade única)
  assert.equal(r.item.empresa_id, e.empresa_id);
  assert.equal(r.item.event_type, e.event_type);
});

test('R3-HIGH-02: mesma ocorrência + mesma intenção = duplicate idempotente', async () => {
  const ob = createInMemoryOutbox();
  const a = await ob.enqueue({ provider: 'fake', envelope: env({}, { eventId: 'ID1' }) });
  // reconstruído do zero, outra tentativa, mesma ocorrência e mesma intenção
  const b = await ob.enqueue({ provider: 'fake', envelope: env({ requestId: 'r2' }, { eventId: 'ID1' }) });
  assert.equal(a.enfileirado, true);
  assert.equal(b.enfileirado, false);
  assert.equal(b.code, 'duplicate');
  assert.equal(b.item.id, a.item.id);
  assert.equal((await ob.countByStatus('emp-1')).pending, 1);
});

test('R3-HIGH-02: mesmo event_id com intenção DIFERENTE é IDEMPOTENCY_CONFLICT', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env({ payload: { v: 1 } }, { eventId: 'ID1' }) });
  const c = await ob.enqueue({ provider: 'fake', envelope: env({ payload: { v: 2 } }, { eventId: 'ID1' }) });
  assert.equal(c.enfileirado, false);
  assert.equal(c.code, 'idempotency_conflict', 'jamais tratar como duplicata benigna');
  assert.notEqual(c.intentFingerprint, c.intentFingerprintExistente);
  // e nada foi sobrescrito na fila
  assert.deepEqual(ob._all()[0].envelope.payload, { v: 1 });
});

test('R3-HIGH-02: mesmo event_id em TENANTS diferentes gera itens independentes', async () => {
  const ob = createInMemoryOutbox();
  const a = await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-A' }, { eventId: 'X' }) });
  const b = await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-B' }, { eventId: 'X' }) });
  assert.equal(a.enfileirado, true);
  assert.equal(b.enfileirado, true, 'tenant B não pode ser descartado como duplicata de A');
  assert.notEqual(a.item.id, b.item.id);
  assert.equal((await ob.countByStatus('emp-A')).pending, 1);
  assert.equal((await ob.countByStatus('emp-B')).pending, 1);
});

test('R3-HIGH-02: mesmo event_id em PROVIDERS diferentes gera itens independentes', async () => {
  const ob = createInMemoryOutbox();
  const e = env({}, { eventId: 'X' });
  const p1 = await ob.enqueue({ provider: 'p1', envelope: e });
  const p2 = await ob.enqueue({ provider: 'p2', envelope: e });
  assert.equal(p1.enfileirado, true);
  assert.equal(p2.enfileirado, true, 'providers distintos nunca colidem');
  assert.notEqual(p1.item.id, p2.item.id);
  assert.notEqual(p1.item.dedupe_key, p2.item.dedupe_key);
});

test('R3-HIGH-02: duplicate/conflict só devolvem item do PRÓPRIO tenant e provider', async () => {
  const ob = createInMemoryOutbox();
  const a = await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-A' }, { eventId: 'X' }) });
  await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-B' }, { eventId: 'X' }) });
  await ob.enqueue({ provider: 'outro', envelope: env({ empresaId: 'emp-A' }, { eventId: 'X' }) });
  const dupA = await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-A' }, { eventId: 'X' }) });
  assert.equal(dupA.code, 'duplicate');
  assert.equal(dupA.item.empresa_id, 'emp-A');
  assert.equal(dupA.item.provider, 'fake');
  assert.equal(dupA.item.id, a.item.id);
});

// R3-HIGH-03 — snapshot imutável
test('R3-HIGH-03: mutar o envelope do CALLER depois do enqueue não altera a fila', async () => {
  const ob = createInMemoryOutbox();
  const original = env({ payload: { valor: 100 } }, { eventId: 'ID1' });
  const r = await ob.enqueue({ provider: 'fake', envelope: original });
  const fingerprintAntes = r.item.intent_fingerprint;

  original.payload.valor = 999;
  original.payload.injetado = 'x';
  original.empresa_id = 'emp-hackeada';

  const interno = ob._all()[0];
  assert.equal(interno.envelope.payload.valor, 100);
  assert.equal('injetado' in interno.envelope.payload, false);
  assert.equal(interno.empresa_id, 'emp-1');
  assert.equal(interno.intent_fingerprint, fingerprintAntes);
});

test('R3-HIGH-03: mutar o item DEVOLVIDO não altera a fila', async () => {
  const ob = createInMemoryOutbox();
  const r = await ob.enqueue({ provider: 'fake', envelope: env({ payload: { valor: 100 } }) });
  r.item.envelope.payload.valor = 999;
  r.item.envelope.payload.secret = 'x';
  r.item.status = OUTBOX_STATUS.PROCESSED;
  const interno = ob._all()[0];
  assert.equal(interno.envelope.payload.valor, 100);
  assert.equal('secret' in interno.envelope.payload, false);
  assert.equal(interno.status, OUTBOX_STATUS.PENDING);
});

test('R3-HIGH-03: mutar o read model (_all/claim) não altera a fila', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env({ payload: { valor: 100 } }) });
  const lido = ob._all()[0];
  lido.envelope.payload.valor = 42;
  lido.dedupe_key = 'forjada';
  assert.equal(ob._all()[0].envelope.payload.valor, 100);

  const c = await ob.claimNext();
  c.item.envelope.payload.valor = 7;
  c.item.claim_id = 'forjado';
  assert.equal(ob._all()[0].envelope.payload.valor, 100);
  // o token forjado não vale — a posse real continua sendo a do claim
  assert.equal((await ob.markProcessed(c.item.id, 'forjado')).code, 'stale_claim');
  assert.equal((await ob.markProcessed(c.item.id, c.claimToken)).code, 'processed');
});

test('R3-HIGH-03: dedupe e fingerprint sobrevivem às tentativas de mutação', async () => {
  const ob = createInMemoryOutbox();
  const original = env({ payload: { valor: 100 } }, { eventId: 'ID1' });
  const r = await ob.enqueue({ provider: 'fake', envelope: original });
  original.payload.valor = 999;
  r.item.intent_fingerprint = 'forjado';
  const interno = ob._all()[0];
  assert.equal(interno.dedupe_key, idempotencyKeyForEnvelope('fake', env({ payload: { valor: 100 } }, { eventId: 'ID1' })));
  assert.equal(interno.intent_fingerprint, intentFingerprintForEnvelope(env({ payload: { valor: 100 } }, { eventId: 'ID1' })));
});

// HIGH-04 (R2) — lease / reclaim / stale claim
test('HIGH-04: claim devolve token, define lease e conta tentativa de SEND', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  assert.equal(c.code, 'claimed');
  assert.equal(c.action, CLAIM_ACTION.SEND);
  assert.ok(c.claimToken);
  assert.equal(c.item.status, OUTBOX_STATUS.PROCESSING);
  assert.equal(c.item.send_attempts, 1);
  assert.equal(c.item.reconcile_attempts, 0);
  assert.ok(c.item.lease_expires_at);
  assert.equal((await ob.markProcessed(c.item.id, c.claimToken)).code, 'processed');
});

test('HIGH-04: antes do lease expirar, outro worker NÃO pega o item', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  assert.equal((await ob.claimNext()).code, 'claimed');
  const dentro = new Date(Date.now() + 30000);
  assert.equal((await ob.claimNext({ now: dentro })).code, 'empty', 'item ainda tem dono');
  assert.equal((await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: dentro })).code, 'empty');
});

test('HIGH-04: claim OBSOLETO não finaliza o trabalho de quem reclamou', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const a = await ob.claimNext();                                   // worker A
  const depois = new Date(Date.now() + 120000);
  const b = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois }); // worker B reclama
  assert.equal(b.code, 'reclaimed');
  assert.notEqual(b.claimToken, a.claimToken);

  const stale = await ob.markProcessed(a.item.id, a.claimToken, { now: depois });
  assert.equal(stale.code, 'stale_claim');
  const staleFail = await ob.markFailed(a.item.id, a.claimToken, 'erro', { now: depois });
  assert.equal(staleFail.code, 'stale_claim');
  const staleRec = await ob.recordReconcile(a.item.id, a.claimToken, RECONCILE_STATUS.SUCCEEDED, { now: depois });
  assert.equal(staleRec.code, 'stale_claim');

  const ok = await ob.recordReconcile(b.item.id, b.claimToken, RECONCILE_STATUS.SUCCEEDED, { now: depois });
  assert.equal(ok.code, 'processed');
});

test('HIGH-04: sem token não se finaliza item', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  assert.equal((await ob.markProcessed(c.item.id, null)).code, 'stale_claim');
  assert.equal((await ob.markProcessed(c.item.id, 'token-inventado')).code, 'stale_claim');
});

test('HIGH-04: estados terminais (processed/dead) nunca são reclamados', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 1 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  await ob.markProcessed(c.item.id, c.claimToken);
  const futuro = new Date(Date.now() + 10 * 60 * 1000);
  assert.equal((await ob.claimNext({ now: futuro })).code, 'empty');
  assert.equal((await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: futuro })).code, 'empty');
});

// R3-HIGH-04 — a política de retry é aplicada PELA MÁQUINA
test('R3-HIGH-04: FAILED sem evidência NÃO volta para SEND, nem depois do backoff', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  const f = await ob.markFailed(c.item.id, c.claimToken, 'falha desconhecida');
  assert.equal(f.code, 'failed');
  assert.equal(f.item.retry_authorized, false);
  assert.equal(f.item.next_action, CLAIM_ACTION.RECONCILE);

  const bemDepois = new Date(Date.now() + 6 * 60 * 60 * 1000);
  assert.equal((await ob.claimNext({ now: bemDepois })).code, 'empty', 'SEND não pode ser reaberto sem prova');
  // o trabalho permitido é reconciliar
  const r = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: bemDepois });
  assert.equal(r.code, 'claimed');
  assert.equal(r.item.reconcile_attempts, 1);
  assert.equal(r.item.send_attempts, 1, 'reconcile não consome tentativa de envio');
});

test('R3-HIGH-04: FAILED com retry_safe=true reabre SEND após o backoff', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  const f = await ob.markFailed(c.item.id, c.claimToken, 'recusado sem efeito', { retrySafe: true });
  assert.equal(f.item.retry_authorized, true);
  assert.equal(f.item.next_action, CLAIM_ACTION.SEND);
  // ainda dentro do backoff: nada é liberado
  assert.equal((await ob.claimNext()).code, 'empty');
  const depois = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const c2 = await ob.claimNext({ now: depois });
  assert.equal(c2.code, 'claimed');
  assert.equal(c2.item.send_attempts, 2);
});

test('R3-HIGH-04: reconcile PENDING e UNKNOWN nunca liberam SEND', async () => {
  for (const status of [RECONCILE_STATUS.PENDING, RECONCILE_STATUS.UNKNOWN]) {
    const ob = createInMemoryOutbox();
    await ob.enqueue({ provider: 'fake', envelope: env() });
    const c = await ob.claimNext();
    await ob.markFailed(c.item.id, c.claimToken, 'ambíguo');
    const depois = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
    const res = await ob.recordReconcile(rc.item.id, rc.claimToken, status, { now: depois });
    assert.equal(res.code, 'reconcile_again', `${status} deveria pedir novo reconcile`);
    assert.equal(res.item.next_action, CLAIM_ACTION.RECONCILE);
    const bemDepois = new Date(depois.getTime() + 6 * 60 * 60 * 1000);
    assert.equal((await ob.claimNext({ now: bemDepois })).code, 'empty', `${status} liberou SEND`);
  }
});

test('R3-HIGH-04: reconcile FAILED sem evidência BLOQUEIA; com retry_safe libera SEND', async () => {
  const cenario = async (evidence) => {
    const ob = createInMemoryOutbox();
    await ob.enqueue({ provider: 'fake', envelope: env() });
    const c = await ob.claimNext();
    await ob.markFailed(c.item.id, c.claimToken, 'erro');
    const depois = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
    const res = await ob.recordReconcile(rc.item.id, rc.claimToken, RECONCILE_STATUS.FAILED, { now: depois, evidence });
    const bemDepois = new Date(depois.getTime() + 6 * 60 * 60 * 1000);
    const send = await ob.claimNext({ now: bemDepois });
    return { res, send };
  };
  const semProva = await cenario(null);
  assert.equal(semProva.res.code, 'blocked');
  assert.equal(semProva.res.item.next_action, null);
  assert.equal(semProva.send.code, 'empty', 'FAILED sem prova não pode reenviar');

  const comProva = await cenario({ retry_safe: true });
  assert.equal(comProva.res.code, 'resend_authorized');
  assert.equal(comProva.send.code, 'claimed');
});

// R3-HIGH-05 — reconcile antes de reenviar
test('R3-HIGH-05: lease de SEND expirado libera RECONCILE, nunca SEND', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  assert.equal((await ob.claimNext({ now: depois })).code, 'empty', 'reenviar às cegas é proibido');
  const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  assert.equal(rc.code, 'reclaimed');
  assert.equal(rc.action, CLAIM_ACTION.RECONCILE);
});

test('R3-HIGH-05: crash após o ERP aceitar → reconcile SUCCEEDED → ZERO segundo envio', async () => {
  // Prova por contagem: o provider fake conta quantos `send` realmente recebeu.
  let sends = 0;
  const providerFake = {
    async send(envelope) { sends += 1; return { accepted: true, event_id: envelope.event_id }; },
    async reconcile() { return { status: RECONCILE_STATUS.SUCCEEDED }; },
  };

  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });

  // Worker A reivindica, envia (o ERP APLICA o efeito) e morre antes de confirmar.
  const a = await ob.claimNext();
  await providerFake.send(a.item.envelope);
  assert.equal(sends, 1);
  // (sem markProcessed — simula o crash)

  const depois = new Date(Date.now() + 120000);
  // Worker B: SEND continua fechado; o único trabalho é reconciliar.
  assert.equal((await ob.claimNext({ now: depois })).code, 'empty');
  const b = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  assert.equal(b.action, CLAIM_ACTION.RECONCILE);

  const { status } = await providerFake.reconcile(b.item.envelope);
  const res = await ob.recordReconcile(b.item.id, b.claimToken, status, { now: depois });
  assert.equal(res.code, 'processed');
  assert.equal(res.item.status, OUTBOX_STATUS.PROCESSED);

  // Nada mais é reivindicável e o ERP recebeu exatamente UM envio.
  const muitoDepois = new Date(depois.getTime() + 24 * 60 * 60 * 1000);
  assert.equal((await ob.claimNext({ now: muitoDepois })).code, 'empty');
  assert.equal(sends, 1, 'o efeito externo não pode ser duplicado');
});

test('R3-HIGH-05: reconcile NOT_FOUND é o que autoriza um novo SEND', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  const res = await ob.recordReconcile(rc.item.id, rc.claimToken, RECONCILE_STATUS.NOT_FOUND, { now: depois });
  assert.equal(res.code, 'resend_authorized');
  assert.equal(res.item.next_action, CLAIM_ACTION.SEND);
  assert.equal(res.item.retry_reason, 'reconcile_not_found');

  const bemDepois = new Date(depois.getTime() + 6 * 60 * 60 * 1000);
  const c2 = await ob.claimNext({ now: bemDepois });
  assert.equal(c2.code, 'claimed');
  assert.equal(c2.action, CLAIM_ACTION.SEND);
  assert.equal(c2.item.send_attempts, 2);
  assert.equal(c2.item.reconcile_attempts, 1);
});

test('R3-HIGH-05: markProcessed não é caminho válido para um claim de RECONCILE', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  const r = await ob.markProcessed(rc.item.id, rc.claimToken, { now: depois });
  assert.equal(r.code, 'invalid_claim_action');
  assert.equal(ob._all()[0].status, OUTBOX_STATUS.PROCESSING);
});

test('outbox: ação de claim inválida é recusada', async () => {
  const ob = createInMemoryOutbox();
  await assert.rejects(() => ob.claimNext({ action: 'DELETE' }), /acao invalida/);
});

test('outbox: retry autorizado morre (dead) após max_attempts, sem loop infinito', async () => {
  const ob = createInMemoryOutbox({ maxAttempts: 2 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  let c = await ob.claimNext();
  let f = await ob.markFailed(c.item.id, c.claimToken, 'falha de transporte', { retrySafe: true });
  assert.equal(f.code, 'failed');
  assert.ok(f.item.next_retry_at);
  const futuro = new Date(Date.now() + 3 * 60 * 60 * 1000);
  c = await ob.claimNext({ now: futuro });
  assert.equal(c.code, 'claimed');
  f = await ob.markFailed(c.item.id, c.claimToken, 'falhou de novo', { now: futuro, retrySafe: true });
  assert.equal(f.code, 'dead');
  assert.equal(f.item.next_retry_at, null);
  assert.equal(f.item.next_action, null);
  const muitoDepois = new Date(futuro.getTime() + 24 * 60 * 60 * 1000);
  assert.equal((await ob.claimNext({ now: muitoDepois })).code, 'empty');
  assert.equal((await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: muitoDepois })).code, 'empty');
});

test('outbox: reconcile ambíguo também tem teto (não gira para sempre)', async () => {
  const ob = createInMemoryOutbox({ maxReconcileAttempts: 1, leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  const res = await ob.recordReconcile(rc.item.id, rc.claimToken, RECONCILE_STATUS.UNKNOWN, { now: depois });
  assert.equal(res.code, 'dead');
  assert.equal(res.item.status, OUTBOX_STATUS.DEAD);
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
  await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-1' }) });
  await ob.enqueue({ provider: 'fake', envelope: env({ empresaId: 'emp-2' }) });
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

test('outbox: last_error persistido é sempre sanitizado', async () => {
  const ob = createInMemoryOutbox();
  await ob.enqueue({ provider: 'fake', envelope: env() });
  const c = await ob.claimNext();
  const f = await ob.markFailed(c.item.id, c.claimToken, 'falhou com Authorization: Bearer segredo_real_aqui');
  assert.equal(/segredo_real_aqui/.test(f.item.last_error), false);
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
  assert.throws(() => m.rebind({ ...base, externalEntityId: '', reason: 'x' }), /campo obrigatorio ausente/);
  assert.equal(m.rebind({ ...base, externalEntityId: 'ext-1', reason: 'sem mudanca' }).code, 'idempotent');
  const ok = m.rebind({ ...base, externalEntityId: 'ext-9', reason: 'correcao manual auditada' });
  assert.equal(ok.code, 'rebound');
  assert.equal(ok.mapping.rebind_reason, 'correcao manual auditada');
  assert.equal(m.resolveExternal(base), 'ext-9');
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
  assert.equal(safeToRetry(RECONCILE_STATUS.UNKNOWN, { retry_safe: true }), false);
});

test('R3-HIGH-04: status desconhecido do adapter colapsa em UNKNOWN também no outbox', async () => {
  const ob = createInMemoryOutbox({ leaseMs: 60000 });
  await ob.enqueue({ provider: 'fake', envelope: env() });
  await ob.claimNext();
  const depois = new Date(Date.now() + 120000);
  const rc = await ob.claimNext({ action: CLAIM_ACTION.RECONCILE, now: depois });
  const res = await ob.recordReconcile(rc.item.id, rc.claimToken, 'LICORNE', { now: depois });
  assert.equal(res.reconcileStatus, RECONCILE_STATUS.UNKNOWN);
  assert.equal(res.item.next_action, CLAIM_ACTION.RECONCILE, 'nunca SEND por status desconhecido');
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

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  TRACKING_PREFIX,
  gerarTrackingToken,
  pareceTrackingToken,
  hashTrackingToken,
} = require('../services/auth/trackingCredentialCrypto');
const authCrypto = require('../services/auth/authCrypto');

const PEPPER = 'pepper-de-teste-abc123';

test('gerarTrackingToken tem prefixo versionável e alta entropia', () => {
  const t = gerarTrackingToken();
  assert.ok(t.startsWith(`${TRACKING_PREFIX}.`));
  const raw = t.slice(TRACKING_PREFIX.length + 1);
  // 32 bytes em base64url ≈ 43 chars.
  assert.ok(raw.length >= 43);
  // dois tokens nunca colidem
  assert.notEqual(gerarTrackingToken(), gerarTrackingToken());
});

test('pareceTrackingToken reconhece só o formato de tracking', () => {
  assert.equal(pareceTrackingToken(gerarTrackingToken()), true);
  assert.equal(pareceTrackingToken('eyJhbGciOi.jwt.token'), false); // JWT
  assert.equal(pareceTrackingToken('r1.abc'), false);               // refresh SEC-1
  assert.equal(pareceTrackingToken(''), false);
  assert.equal(pareceTrackingToken(null), false);
  assert.equal(pareceTrackingToken('mtk1.'), false); // sem corpo
});

test('hashTrackingToken é determinístico p/ mesmo pepper e muda com pepper diferente', () => {
  const t = gerarTrackingToken();
  const h1 = hashTrackingToken(t, PEPPER);
  const h2 = hashTrackingToken(t, PEPPER);
  assert.equal(h1, h2);
  assert.notEqual(hashTrackingToken(t, 'outro-pepper'), h1);
  // hex de sha256 = 64 chars
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('DOMAIN SEPARATION: hash de tracking != hash de refresh p/ o MESMO token e pepper', () => {
  // Prova que a separação de domínio ('tracking:') evita colisão de domínio com o
  // hashing do refresh SEC-1 (mesmo token e pepper produzem hashes diferentes).
  const t = 'r1.mesmo-token-abc';
  const hTracking = hashTrackingToken(t, PEPPER);
  const hRefresh = authCrypto.hashRefreshToken(t, PEPPER);
  assert.notEqual(hTracking, hRefresh);
});

test('hashTrackingToken exige token e pepper (não vaza segredo)', () => {
  assert.throws(() => hashTrackingToken('', PEPPER), /token ausente/);
  assert.throws(() => hashTrackingToken(gerarTrackingToken(), ''), /pepper ausente/);
});

test('o token nunca contém o hash (não derivável trivialmente sem pepper)', () => {
  const t = gerarTrackingToken();
  const h = hashTrackingToken(t, PEPPER);
  assert.ok(!t.includes(h));
  // sem o pepper, um atacante não reproduz o hash
  const semPepper = crypto.createHash('sha256').update(t).digest('hex');
  assert.notEqual(semPepper, h);
});

// Testes do módulo criptográfico de auth (SEC-1) — backend/services/auth/authCrypto.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { loadAuthConfig } = require('../config/authConfig');
const {
  gerarRefreshToken, hashRefreshToken, gerarJti,
  assinarAccessToken, verificarAccessTokenAssinatura, REFRESH_PREFIX,
} = require('../services/auth/authCrypto');

const cfg = loadAuthConfig({ JWT_SECRET: 'jwt-teste-secreto', AUTH_TOKEN_ISSUER: 'matopibalog', AUTH_TOKEN_AUDIENCE: 'matopibalog-clients' });
const PEPPER = 'pepper-teste-secreto';

// ── refresh token opaco ──────────────────────────────────────────────────────
test('dois refresh tokens nunca são iguais e têm formato versionável opaco', () => {
  const a = gerarRefreshToken(), b = gerarRefreshToken();
  assert.notEqual(a, b);
  assert.ok(a.startsWith(`${REFRESH_PREFIX}.`));
  // opaco: sem uid/sid/dados legíveis (é aleatório). base64url após o prefixo.
  assert.match(a.split('.')[1], /^[A-Za-z0-9_-]+$/);
});

// ── hash HMAC ────────────────────────────────────────────────────────────────
test('hash determinístico com o MESMO pepper; peppers diferentes → hashes diferentes', () => {
  const t = gerarRefreshToken();
  assert.equal(hashRefreshToken(t, PEPPER), hashRefreshToken(t, PEPPER));
  assert.notEqual(hashRefreshToken(t, PEPPER), hashRefreshToken(t, 'outro-pepper'));
});

test('tokens diferentes → hashes diferentes', () => {
  assert.notEqual(hashRefreshToken(gerarRefreshToken(), PEPPER), hashRefreshToken(gerarRefreshToken(), PEPPER));
});

test('o token aberto NUNCA é igual/contém o hash', () => {
  const t = gerarRefreshToken();
  const h = hashRefreshToken(t, PEPPER);
  assert.notEqual(t, h);
  assert.ok(!t.includes(h));
  assert.ok(!h.includes(t));
});

test('hash sem pepper → erro SEM expor valor', () => {
  const t = gerarRefreshToken();
  assert.throws(() => hashRefreshToken(t, null), (e) => e.message === 'pepper ausente' && !e.message.includes(PEPPER));
  assert.throws(() => hashRefreshToken(null, PEPPER), (e) => !e.message.includes(PEPPER) && !e.message.includes('jwt-teste'));
});

test('jti é único', () => { assert.notEqual(gerarJti(), gerarJti()); });

// ── access JWT ───────────────────────────────────────────────────────────────
test('assinar + verificar: claims obrigatórias presentes; sem PII', () => {
  const tok = assinarAccessToken({ uid: 'u-1', sid: 's-1', role: 'admin', isSuperAdmin: false }, cfg);
  const p = verificarAccessTokenAssinatura(tok, cfg);
  assert.equal(p.token_use, 'access');
  assert.equal(p.sid, 's-1');
  assert.equal(p.sub, 'u-1');
  assert.equal(p.uid, 'u-1');
  assert.equal(p.iss, 'matopibalog');
  assert.equal(p.aud, 'matopibalog-clients');
  assert.ok(typeof p.jti === 'string' && p.jti.length > 10);
  assert.ok(typeof p.exp === 'number' && p.exp > p.iat);
  // sem refresh/hash/senha/documento/convite
  const json = JSON.stringify(p);
  for (const proibido of ['refresh', 'senha', 'password', 'cpf', 'cnpj', 'convite']) {
    assert.ok(!json.toLowerCase().includes(proibido), `access token não pode conter ${proibido}`);
  }
});

test('assinar sem uid/sid → erro', () => {
  assert.throws(() => assinarAccessToken({ sid: 's' }, cfg));
  assert.throws(() => assinarAccessToken({ uid: 'u' }, cfg));
});

test('verify rejeita: secret errado', () => {
  const tokOutroSecret = jwt.sign({ uid: 'u', sid: 's', token_use: 'access' }, 'secret-errado', { algorithm: 'HS256', issuer: 'matopibalog', audience: 'matopibalog-clients', expiresIn: 600 });
  assert.throws(() => verificarAccessTokenAssinatura(tokOutroSecret, cfg));
});

test('verify rejeita: issuer/audience incorretos', () => {
  const cfgIssErrado = loadAuthConfig({ JWT_SECRET: 'jwt-teste-secreto', AUTH_TOKEN_ISSUER: 'outro-iss', AUTH_TOKEN_AUDIENCE: 'matopibalog-clients' });
  const cfgAudErrado = loadAuthConfig({ JWT_SECRET: 'jwt-teste-secreto', AUTH_TOKEN_ISSUER: 'matopibalog', AUTH_TOKEN_AUDIENCE: 'outra-aud' });
  const tok = assinarAccessToken({ uid: 'u', sid: 's' }, cfg);
  assert.throws(() => verificarAccessTokenAssinatura(tok, cfgIssErrado));
  assert.throws(() => verificarAccessTokenAssinatura(tok, cfgAudErrado));
});

test('verify rejeita: algorithm=none', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'u', sid: 's', token_use: 'access', iss: 'matopibalog', aud: 'matopibalog-clients' })).toString('base64url');
  const tokenNone = `${header}.${payload}.`;
  assert.throws(() => verificarAccessTokenAssinatura(tokenNone, cfg));
});

test('verify rejeita: token expirado', () => {
  const tok = jwt.sign({ uid: 'u', sid: 's', token_use: 'access' }, 'jwt-teste-secreto', { algorithm: 'HS256', issuer: 'matopibalog', audience: 'matopibalog-clients', expiresIn: -10 });
  assert.throws(() => verificarAccessTokenAssinatura(tok, cfg));
});

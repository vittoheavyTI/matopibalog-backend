// Testes do middleware de auth SEC-1 (classificação irreversível, downgrade proibido).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { loadAuthConfig } = require('../config/authConfig');
const crypto = require('../services/auth/authCrypto');
const E = require('../services/auth/authErrors');
const { criarVerifyTokenSec1, classificarPorClaims } = require('../middlewares/authSession');

const SECRET = 'jwt-teste';
const cfgLegacy = loadAuthConfig({ JWT_SECRET: SECRET });
const cfgCompat = loadAuthConfig({ AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', AUTH_REFRESH_TOKEN_PEPPER: 'p', JWT_SECRET: SECRET });
const cfgStrict = loadAuthConfig({ AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', AUTH_REQUIRE_SESSION: 'true', AUTH_ALLOW_LEGACY_TOKENS: 'false', AUTH_REFRESH_TOKEN_PEPPER: 'p', JWT_SECRET: SECRET });

const tokenLegacy = () => jwt.sign({ uid: 'u-leg', email: 'x@x', role: 'admin', is_super_admin: false }, SECRET, { algorithm: 'HS256', expiresIn: '7d' });
const tokenSession = (cfg) => crypto.assinarAccessToken({ uid: 'u-sess', sid: 'sess-1', role: 'admin' }, cfg);
const tokenSidSemUse = () => jwt.sign({ uid: 'u', sid: 's' }, SECRET, { algorithm: 'HS256' });        // parcial
const tokenUseSemSid = () => jwt.sign({ uid: 'u', token_use: 'access' }, SECRET, { algorithm: 'HS256' }); // parcial

async function run(mw, token, { cookie = false } = {}) {
  const req = { headers: {}, cookies: {} };
  if (token && !cookie) req.headers.authorization = `Bearer ${token}`;
  if (token && cookie) req.cookies.token = token;
  let statusCode = 200, body = null, nextCalled = false;
  const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; return this; } };
  await mw(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled, req };
}

const svcOk = { validarSessaoParaAcesso: async ({ sid, uid }) => ({ uid, sid, role: 'motorista', is_super_admin: false, empresa_id: 'e-db', client_type: 'web' }) };
const svcThrow = (err) => ({ validarSessaoParaAcesso: async () => { throw err; }, _called: false });

test('classificarPorClaims', () => {
  assert.equal(classificarPorClaims({ uid: 'u' }).kind, 'legacy');
  assert.equal(classificarPorClaims({ uid: 'u', sid: 's', token_use: 'access' }).kind, 'session');
  assert.equal(classificarPorClaims({ uid: 'u', sid: 's' }).kind, 'invalid');
  assert.equal(classificarPorClaims({ uid: 'u', token_use: 'access' }).kind, 'invalid');
  assert.equal(classificarPorClaims({ uid: 'u', sid: 's', token_use: 'refresh' }).kind, 'invalid');
});

test('sem token → 401', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgLegacy, sessionService: svcOk });
  const r = await run(mw, null);
  assert.equal(r.statusCode, 401); assert.equal(r.nextCalled, false);
});

test('legado em modo compatível → next, req.user legado', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcOk });
  const r = await run(mw, tokenLegacy());
  assert.equal(r.nextCalled, true); assert.equal(r.req.authKind, 'legacy'); assert.equal(r.req.user.uid, 'u-leg');
});

test('legado em modo ESTRITO (allowLegacy=false) → 401 (rejeitado)', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgStrict, sessionService: svcOk });
  const r = await run(mw, tokenLegacy());
  assert.equal(r.statusCode, 401); assert.equal(r.nextCalled, false);
});

test('legado com assinatura inválida → 403', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcOk });
  const forjado = jwt.sign({ uid: 'u', role: 'admin' }, 'outro-secret', { algorithm: 'HS256' });
  const r = await run(mw, forjado);
  assert.equal(r.statusCode, 403); assert.equal(r.nextCalled, false);
});

test('sessão válida → next, req.user do BANCO (role do serviço, não do token)', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcOk });
  const r = await run(mw, tokenSession(cfgCompat));
  assert.equal(r.nextCalled, true); assert.equal(r.req.authKind, 'session');
  assert.equal(r.req.user.role, 'motorista'); // veio do serviço (banco), token dizia 'admin'
  assert.equal(r.req.user.empresa_id, 'e-db');
});

test('sessão ausente → 401 SessionNotFound (NUNCA cai para legado)', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcThrow(new E.SessionNotFound()) });
  const r = await run(mw, tokenSession(cfgCompat));
  assert.equal(r.statusCode, 401); assert.equal(r.body.error, 'SessionNotFound'); assert.equal(r.nextCalled, false);
});

test('lookup de sessão indisponível → 503 fail-closed', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcThrow(new E.SessionDependencyUnavailable()) });
  const r = await run(mw, tokenSession(cfgCompat));
  assert.equal(r.statusCode, 503); assert.equal(r.nextCalled, false);
});

test('DOWNGRADE PROIBIDO: token com sid mas assinatura inválida → 401 (não valida como legado)', async () => {
  let chamou = false;
  const svc = { validarSessaoParaAcesso: async () => { chamou = true; return {}; } };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svc });
  // token de sessão bem-formado por claims, mas assinado com secret errado
  const forjado = jwt.sign({ uid: 'u', sid: 's', token_use: 'access' }, 'secret-errado', { algorithm: 'HS256', issuer: 'matopibalog', audience: 'matopibalog-clients' });
  const r = await run(mw, forjado);
  assert.equal(r.statusCode, 401); assert.equal(r.nextCalled, false);
  assert.equal(chamou, false, 'não deve validar sessão (assinatura falhou) nem cair para legado');
});

test('sessões OFF (legado) + token de sessão → 401 sem consultar sessão (sem downgrade)', async () => {
  let chamou = false;
  const svc = { validarSessaoParaAcesso: async () => { chamou = true; return {}; } };
  const mw = criarVerifyTokenSec1({ cfg: cfgLegacy, sessionService: svc });
  const r = await run(mw, tokenSession(cfgCompat));
  assert.equal(r.statusCode, 401); assert.equal(chamou, false, 'legado puro não consulta tabelas de sessão');
});

test('claims parciais (sid sem token_use / token_use sem sid) → 401 invalid', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcOk });
  assert.equal((await run(mw, tokenSidSemUse())).statusCode, 401);
  assert.equal((await run(mw, tokenUseSemSid())).statusCode, 401);
});

test('token de sessão via COOKIE também funciona', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: svcOk });
  const r = await run(mw, tokenSession(cfgCompat), { cookie: true });
  assert.equal(r.nextCalled, true); assert.equal(r.req.authKind, 'session');
});

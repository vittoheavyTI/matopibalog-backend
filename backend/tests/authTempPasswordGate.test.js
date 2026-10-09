// backend/tests/authTempPasswordGate.test.js — Testes de regressão do gate de senha temporária (R1A)
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { criarVerifyTokenSec1, rotaIsentaSenhaTemporaria } = require('../middlewares/authSession');
const { verifyToken } = require('../middlewares/auth');

const SECRET = 'test-secret-at-least-32-chars-long-123456';
const cfgCompat = {
  authMode: 'compatible',
  sessionsEnabled: true,
  allowLegacy: true,
  legacyCutoff: null,
  getJwtSecret: () => SECRET,
  accessTtlSeconds: 600,
  refreshIdleTtlSeconds: 604800,
  refreshAbsoluteTtlSeconds: 2592000,
  sessionActivityThrottleSeconds: 60,
};

function assinarSessionToken({ uid, sid }) {
  return jwt.sign(
    { uid, sid, token_use: 'access', role: 'admin', is_super_admin: false },
    SECRET,
    { algorithm: 'HS256', expiresIn: '10m' }
  );
}

function assinarLegacyToken({ uid }) {
  return jwt.sign(
    { uid, role: 'admin', is_super_admin: false },
    SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

async function simularRequisicao(mw, { token, method = 'GET', url = '/fretes', originalUrl = null }) {
  const req = {
    method,
    url,
    originalUrl: originalUrl || url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
  };
  let statusCode = 200;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
      return this;
    },
  };
  await mw(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, body, nextCalled, req };
}

test('R1A-9: Sessão válida com senha_temporaria=true em endpoint protegido comum → 403 PasswordChangeRequired', async () => {
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-temp-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: true,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService });
  const token = assinarSessionToken({ uid: 'u-temp-1', sid: 's-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes', originalUrl: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body?.error, 'PasswordChangeRequired');
  assert.equal(r.body?.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('R1A-10: Mesmo usuário com senha_temporaria=true acessando GET /auth/me → permitido (isento)', async () => {
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-temp-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: true,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService });
  const token = assinarSessionToken({ uid: 'u-temp-1', sid: 's-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/auth/me', originalUrl: '/auth/me' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.req.user.senha_temporaria, true);
});

test('R1A-11: Mesmo usuário com senha_temporaria=true acessando POST /auth/trocar-senha → permitido (isento)', async () => {
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-temp-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: true,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService });
  const token = assinarSessionToken({ uid: 'u-temp-1', sid: 's-1' });

  const r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/trocar-senha', originalUrl: '/auth/trocar-senha' });
  assert.equal(r.nextCalled, true);
});

test('R1A-12: Usuário após troca de senha (senha_temporaria=false) em endpoint protegido → autorizado', async () => {
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-temp-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService });
  const token = assinarSessionToken({ uid: 'u-temp-1', sid: 's-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes', originalUrl: '/fretes' });
  assert.equal(r.nextCalled, true);
});

test('R1A-13: Token legado válido cujo usuário no banco tem senha_temporaria=true → negado no endpoint comum', async () => {
  const mockSupabase = {
    from: (table) => {
      assert.equal(table, 'usuarios');
      return {
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => ({ data: { senha_temporaria: true }, error: null }),
          }),
        }),
      };
    },
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const token = assinarLegacyToken({ uid: 'u-leg-temp' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body?.error, 'PasswordChangeRequired');
});

test('R1A-13b: Token legado válido com senha_temporaria=false no banco → autorizado no endpoint comum', async () => {
  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { senha_temporaria: false }, error: null }),
        }),
      }),
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const token = assinarLegacyToken({ uid: 'u-leg-ok' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, true);
});

test('R1A-Exemptions: Demais rotas isentas (logout, logout-all, sessions, termos)', async () => {
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-temp-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: true,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService });
  const token = assinarSessionToken({ uid: 'u-temp-1', sid: 's-1' });

  // POST /auth/logout
  let r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/logout' });
  assert.equal(r.nextCalled, true);

  // POST /auth/logout-all
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/logout-all' });
  assert.equal(r.nextCalled, true);

  // GET /auth/sessions
  r = await simularRequisicao(mw, { token, method: 'GET', url: '/auth/sessions' });
  assert.equal(r.nextCalled, true);

  // DELETE /auth/sessions/:id
  r = await simularRequisicao(mw, { token, method: 'DELETE', url: '/auth/sessions/sess-123' });
  assert.equal(r.nextCalled, true);

  // GET /termos/pendentes
  r = await simularRequisicao(mw, { token, method: 'GET', url: '/termos/pendentes' });
  assert.equal(r.nextCalled, true);

  // POST /termos/:id/aceitar
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/termos/termo-1/aceitar' });
  assert.equal(r.nextCalled, true);
});

test('R1A-14: Token externo de portal continua isolado e rejeitado por verifyToken', async () => {
  const tokenExterno = jwt.sign(
    { uid: 'u-ext', token_kind: 'shipper_portal' },
    SECRET,
    { algorithm: 'HS256' }
  );
  process.env.JWT_SECRET = SECRET;
  const r = await simularRequisicao(verifyToken, { token: tokenExterno, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.ok(r.body?.message?.includes('portal do embarcador'));
});

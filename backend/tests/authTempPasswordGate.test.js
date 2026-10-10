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

test('C1.2-3: Token legado com cliente Supabase indisponível → fail-closed (503 SessionDependencyUnavailable)', async () => {
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: null });
  const token = assinarLegacyToken({ uid: 'u-leg-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
});

test('C1.2-4: Token legado quando consulta ao banco lança exceção → fail-closed (503 SessionDependencyUnavailable)', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { throw new Error('Database connection reset'); },
        }),
      }),
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const token = assinarLegacyToken({ uid: 'u-leg-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
});

test('C1.2-5: Token legado quando consulta retorna erro → fail-closed (503 SessionDependencyUnavailable)', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'Query timeout' } }),
        }),
      }),
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const token = assinarLegacyToken({ uid: 'u-leg-1' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
});

test('C1.2-6: Token legado quando usuário não é encontrado na base → 401 SessionInvalid', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const token = assinarLegacyToken({ uid: 'u-leg-nonexistent' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 401);
  assert.equal(r.body?.error, 'SessionInvalid');
});

test('C1.2-7: Token legado com uid ausente ou incoerente → deny (401 SessionInvalid)', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { senha_temporaria: false }, error: null }),
        }),
      }),
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: {}, supabase: mockSupabase });
  const tokenSemUid = jwt.sign(
    { role: 'admin', is_super_admin: false },
    SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );

  const r = await simularRequisicao(mw, { token: tokenSemUid, method: 'GET', url: '/motoristas', originalUrl: '/motoristas' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 401);
  assert.equal(r.body?.error, 'SessionInvalid');
});

test('R1A-Exemptions: Todas as 8 rotas isentas exatas autorizadas para senha_temporaria=true', async () => {
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

  // 1. GET /auth/me
  let r = await simularRequisicao(mw, { token, method: 'GET', url: '/auth/me', originalUrl: '/auth/me' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'GET', originalUrl: '/auth/me' }), true);

  // 2. POST /auth/trocar-senha
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/trocar-senha', originalUrl: '/auth/trocar-senha' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'POST', originalUrl: '/auth/trocar-senha' }), true);

  // 3. POST /auth/logout
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/logout', originalUrl: '/auth/logout' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'POST', originalUrl: '/auth/logout' }), true);

  // 4. POST /auth/logout-all
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/auth/logout-all', originalUrl: '/auth/logout-all' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'POST', originalUrl: '/auth/logout-all' }), true);

  // 5. GET /auth/sessions
  r = await simularRequisicao(mw, { token, method: 'GET', url: '/auth/sessions', originalUrl: '/auth/sessions' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'GET', originalUrl: '/auth/sessions' }), true);

  // 6. DELETE /auth/sessions/:id
  r = await simularRequisicao(mw, { token, method: 'DELETE', url: '/auth/sessions/sess-123', originalUrl: '/auth/sessions/sess-123' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'DELETE', originalUrl: '/auth/sessions/sess-123' }), true);

  // 7. GET /termos/pendentes
  r = await simularRequisicao(mw, { token, method: 'GET', url: '/termos/pendentes', originalUrl: '/termos/pendentes' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'GET', originalUrl: '/termos/pendentes' }), true);

  // 8. POST /termos/:id/aceitar
  r = await simularRequisicao(mw, { token, method: 'POST', url: '/termos/termo-1/aceitar', originalUrl: '/termos/termo-1/aceitar' });
  assert.equal(r.nextCalled, true);
  assert.equal(rotaIsentaSenhaTemporaria({ method: 'POST', originalUrl: '/termos/termo-1/aceitar' }), true);
});

test('C2-Negative-Allowlist: Aliases genéricos de raiz e wildcards em aceitar são NEGADOS (403 PasswordChangeRequired)', async () => {
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

  const rotasNegadas = [
    { method: 'GET', path: '/me' },
    { method: 'POST', path: '/trocar-senha' },
    { method: 'POST', path: '/logout' },
    { method: 'POST', path: '/logout-all' },
    { method: 'GET', path: '/sessions' },
    { method: 'DELETE', path: '/sessions/sess-123' },
    { method: 'GET', path: '/pendentes' },
    { method: 'POST', path: '/foo/aceitar' },
    { method: 'POST', path: '/fretes/aceitar' },
    { method: 'POST', path: '/dispatch/offer-1/aceitar' },
    { method: 'POST', path: '/anything/aceitar' },
  ];

  for (const { method, path } of rotasNegadas) {
    // 1. Verificação unitária direta do helper rotaIsentaSenhaTemporaria
    assert.equal(
      rotaIsentaSenhaTemporaria({ method, originalUrl: path }),
      false,
      `Rota ${method} ${path} não deve ser isenta`
    );

    // 2. Verificação completa pelo middleware com status 403 e código estruturado
    const r = await simularRequisicao(mw, { token, method, url: path, originalUrl: path });
    assert.equal(r.nextCalled, false, `next() não deve ser chamado para ${method} ${path}`);
    assert.equal(r.statusCode, 403, `Status deve ser 403 para ${method} ${path}`);
    assert.equal(r.body?.error, 'PasswordChangeRequired');
    assert.equal(r.body?.code, 'PASSWORD_CHANGE_REQUIRED');
  }
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

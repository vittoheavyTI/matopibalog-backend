// backend/tests/authTermsGate.test.js — Testes do gate de termos obrigatórios (R1B-A)
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  criarVerifyTokenSec1,
  rotaIsentaTermosObrigatorios,
  aplicarGateTermosObrigatorios,
} = require('../middlewares/authSession');
const termsAuthorityService = require('../services/termsAuthorityService');

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

function assinarSessionToken({ uid, sid, role = 'admin', isSuperAdmin = false }) {
  return jwt.sign(
    { uid, sid, token_use: 'access', role, is_super_admin: isSuperAdmin },
    SECRET,
    { algorithm: 'HS256', expiresIn: '10m' }
  );
}

function assinarLegacyToken({ uid, role = 'admin', isSuperAdmin = false }) {
  return jwt.sign(
    { uid, role, is_super_admin: isSuperAdmin },
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

function criarMockSupabase({
  termosAtivos = [],
  aceites = [],
  usuario = { tipo: 'admin', is_super_admin: false, senha_temporaria: false },
  throwOnTermos = false,
  errorOnTermos = null,
  throwOnAceites = false,
  errorOnAceites = null,
  throwOnUsuarios = false,
  errorOnUsuarios = null,
} = {}) {
  return {
    from: (table) => {
      if (table === 'termos') {
        return {
          select: (campos) => ({
            eq: (colAtivo, valAtivo) => ({
              contains: async (colObrig, valRoles) => {
                if (throwOnTermos) throw new Error('Erro de conexão ao consultar termos');
                if (errorOnTermos) return { data: null, error: errorOnTermos };
                // Filtra termos ativos pela role solicitada
                const roleDesejada = valRoles && valRoles[0];
                const filtrados = termosAtivos.filter((t) =>
                  !t.obrigatorio_para || t.obrigatorio_para.includes(roleDesejada)
                );
                return { data: filtrados.map((t) => ({ id: t.id })), error: null };
              },
            }),
          }),
        };
      }
      if (table === 'termos_aceites') {
        return {
          select: (campos) => ({
            eq: (colUid, valUid) => ({
              in: async (colTermoId, idsAtivos) => {
                if (throwOnAceites) throw new Error('Erro de rede ao consultar aceites');
                if (errorOnAceites) return { data: null, error: errorOnAceites };
                const filtrados = aceites.filter((a) =>
                  a.usuario_id === valUid && idsAtivos.includes(a.termo_id)
                );
                return { data: filtrados.map((a) => ({ termo_id: a.termo_id })), error: null };
              },
            }),
          }),
        };
      }
      if (table === 'usuarios') {
        return {
          select: (campos) => ({
            eq: (colId, valId) => ({
              maybeSingle: async () => {
                if (throwOnUsuarios) throw new Error('Erro ao consultar usuario');
                if (errorOnUsuarios) return { data: null, error: errorOnUsuarios };
                return { data: usuario, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`Tabela não mockada: ${table}`);
    },
  };
}

// ── 1. session user + pending terms ordinary business route => 403 TermsAcceptanceRequired
test('1. session user + pending terms em rota de negócio comum → 403 TermsAcceptanceRequired', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [], // nada aceito
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-session-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-session-1', sid: 's-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body?.error, 'TermsAcceptanceRequired');
  assert.equal(r.body?.code, 'TERMS_ACCEPTANCE_REQUIRED');
  assert.equal(r.body?.message, 'Aceite dos termos obrigatórios pendente.');
});

// ── 2. session user + no pending terms => normal authorization continues
test('2. session user + sem termos pendentes → autorização normal prossegue (next)', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [{ usuario_id: 'u-session-1', termo_id: 'termo-lgpd-v1' }], // já aceito
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-session-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-session-1', sid: 's-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.statusCode, 200);
});

// ── 3. super-admin => exempt
test('3. super-admin com termos ativos não aceitos → isento de termos obrigatórios', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [],
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-superadmin',
      sid: 's-super',
      role: 'admin',
      is_super_admin: true,
      empresa_id: null,
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-superadmin', sid: 's-super', role: 'admin', isSuperAdmin: true });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.statusCode, 200);
});

// ── 4. terms DB lookup throws => 503 fail closed
test('4. consulta de termos lança exceção → fail-closed (503 SessionDependencyUnavailable)', async () => {
  const mockDb = criarMockSupabase({
    throwOnTermos: true,
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-session-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-session-1', sid: 's-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
  assert.equal(r.body?.code, 'AUTH_DEPENDENCY_UNAVAILABLE');
});

// ── 5. terms DB lookup returns error => 503 fail closed
test('5. consulta de termos retorna erro de DB → fail-closed (503 SessionDependencyUnavailable)', async () => {
  const mockDb = criarMockSupabase({
    errorOnTermos: { message: 'relation "termos" does not exist' },
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-session-1',
      sid: 's-1',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-session-1', sid: 's-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
  assert.equal(r.body?.code, 'AUTH_DEPENDENCY_UNAVAILABLE');
});

// ── 6. legacy-compatible token + pending terms => 403
test('6. token legado compatível com termos pendentes no banco → 403 TermsAcceptanceRequired', async () => {
  const mockDb = criarMockSupabase({
    usuario: { tipo: 'admin', is_super_admin: false, senha_temporaria: false },
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [],
  });
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: null, supabase: mockDb });
  const token = assinarLegacyToken({ uid: 'u-legacy-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body?.error, 'TermsAcceptanceRequired');
  assert.equal(r.body?.code, 'TERMS_ACCEPTANCE_REQUIRED');
});

// ── 7. legacy-compatible lookup unavailable/error => fail closed
test('7. token legado compatível quando busca de autoridade de termos falha → fail-closed (503)', async () => {
  const mockDb = criarMockSupabase({
    usuario: { tipo: 'admin', is_super_admin: false, senha_temporaria: false },
    throwOnTermos: true,
  });
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService: null, supabase: mockDb });
  const token = assinarLegacyToken({ uid: 'u-legacy-1', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body?.error, 'SessionDependencyUnavailable');
});

// ── 8. temp password + pending terms => PasswordChangeRequired has precedence
test('8. senha_temporaria=true E termos pendentes → PasswordChangeRequired tem precedência estrita', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [],
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-both-1',
      sid: 's-both',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: true, // Ambas as condições ativas
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-both-1', sid: 's-both', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  // O gate de senha temporária avalia primeiro
  assert.equal(r.body?.error, 'PasswordChangeRequired');
  assert.equal(r.body?.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.notEqual(r.body?.code, 'TERMS_ACCEPTANCE_REQUIRED');
});

// ── 9. after temp password resolution but terms pending => TermsAcceptanceRequired
test('9. após troca de senha (senha_temporaria=false) mas termos ainda pendentes → 403 TermsAcceptanceRequired', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [],
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-both-1',
      sid: 's-both',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false, // Senha já trocada, mas termos pendentes
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-both-1', sid: 's-both', role: 'admin' });

  const r = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body?.error, 'TermsAcceptanceRequired');
  assert.equal(r.body?.code, 'TERMS_ACCEPTANCE_REQUIRED');
});

// ── 10. all 8 exact recovery routes are exempt
test('10. todas as 8 rotas de recuperação/aceite exatas são isentas do gate de termos', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [], // termos pendentes
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-pending-exempt',
      sid: 's-exempt',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-pending-exempt', sid: 's-exempt', role: 'admin' });

  const rotasIsentasExatas = [
    { method: 'GET', url: '/auth/me' },
    { method: 'POST', url: '/auth/trocar-senha' },
    { method: 'POST', url: '/auth/logout' },
    { method: 'POST', url: '/auth/logout-all' },
    { method: 'GET', url: '/auth/sessions' },
    { method: 'DELETE', url: '/auth/sessions/sess-abc-123' },
    { method: 'GET', url: '/termos/pendentes' },
    { method: 'POST', url: '/termos/termo-lgpd-v1/aceitar' },
  ];

  for (const rota of rotasIsentasExatas) {
    const r = await simularRequisicao(mw, { token, method: rota.method, url: rota.url });
    assert.equal(r.nextCalled, true, `Rota deve ser isenta: ${rota.method} ${rota.url}`);
    assert.equal(r.statusCode, 200, `Status deve ser 200: ${rota.method} ${rota.url}`);
  }
});

// ── 11. near-match aliases are NOT exempt
test('11. near-matches e aliases genéricos NÃO são isentos do gate de termos (403)', async () => {
  const mockDb = criarMockSupabase({
    termosAtivos: [{ id: 'termo-lgpd-v1', obrigatorio_para: ['admin'] }],
    aceites: [], // termos pendentes
  });
  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-near-match',
      sid: 's-near',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-near-match', sid: 's-near', role: 'admin' });

  const nearMatches = [
    { method: 'GET', url: '/me' },
    { method: 'POST', url: '/logout' },
    { method: 'GET', url: '/sessions' },
    { method: 'GET', url: '/pendentes' },
    { method: 'POST', url: '/foo/aceitar' },
    { method: 'POST', url: '/fretes/x/aceitar' },
    { method: 'POST', url: '/termos/termo-1/aceitar/extra' },
    { method: 'DELETE', url: '/auth/sessions' },
    { method: 'DELETE', url: '/auth/sessions/sess-1/extra' },
  ];

  for (const rota of nearMatches) {
    const r = await simularRequisicao(mw, { token, method: rota.method, url: rota.url });
    assert.equal(r.nextCalled, false, `Near-match não pode ser isento: ${rota.method} ${rota.url}`);
    assert.equal(r.statusCode, 403, `Status deve ser 403: ${rota.method} ${rota.url}`);
    assert.equal(r.body?.code, 'TERMS_ACCEPTANCE_REQUIRED', `Code deve ser TERMS_ACCEPTANCE_REQUIRED: ${rota.url}`);
  }
});

// ── 12. after term accepted / no remaining mandatory terms => normal path resumes
test('12. após aceite de todos os termos obrigatórios pendentes → fluxo normal retoma', async () => {
  let aceitesNoBanco = [];

  const mockDb = {
    from: (table) => {
      if (table === 'termos') {
        return {
          select: () => ({
            eq: () => ({
              contains: async () => ({
                data: [{ id: 'termo-obrigatorio-1' }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'termos_aceites') {
        return {
          select: () => ({
            eq: () => ({
              in: async (col, ids) => ({
                data: aceitesNoBanco.filter((a) => ids.includes(a.termo_id)),
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada ${table}`);
    },
  };

  const sessionService = {
    validarSessaoParaAcesso: async () => ({
      uid: 'u-flow-1',
      sid: 's-flow',
      role: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      client_type: 'web',
      senha_temporaria: false,
    }),
  };
  const mw = criarVerifyTokenSec1({ cfg: cfgCompat, sessionService, supabase: mockDb });
  const token = assinarSessionToken({ uid: 'u-flow-1', sid: 's-flow', role: 'admin' });

  // 1) Antes do aceite: rota de negócio bloqueada
  const rAntes = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(rAntes.nextCalled, false);
  assert.equal(rAntes.statusCode, 403);
  assert.equal(rAntes.body?.code, 'TERMS_ACCEPTANCE_REQUIRED');

  // 2) Aceite da rota é permitido mesmo com termos pendentes
  const rAceite = await simularRequisicao(mw, { token, method: 'POST', url: '/termos/termo-obrigatorio-1/aceitar' });
  assert.equal(rAceite.nextCalled, true);
  assert.equal(rAceite.statusCode, 200);

  // Simula gravação do aceite no banco
  aceitesNoBanco.push({ usuario_id: 'u-flow-1', termo_id: 'termo-obrigatorio-1' });

  // 3) Após aceite: rota de negócio autorizada
  const rDepois = await simularRequisicao(mw, { token, method: 'GET', url: '/fretes' });
  assert.equal(rDepois.nextCalled, true);
  assert.equal(rDepois.statusCode, 200);
});

// ── 13. Testes unitários diretos de rotaIsentaTermosObrigatorios
test('13. rotaIsentaTermosObrigatorios isolado', () => {
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/auth/me' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/auth/trocar-senha' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/auth/logout' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/auth/logout-all' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/auth/sessions' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'DELETE', url: '/auth/sessions/s-1' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/termos/pendentes' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/termos/t-1/aceitar' }), true);

  // Queries e trailing slashes
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/termos/pendentes?foo=bar' }), true);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/termos/pendentes/' }), true);

  // Negativas
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/fretes' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/me' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/logout' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/sessions' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'GET', url: '/pendentes' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/foo/aceitar' }), false);
  assert.equal(rotaIsentaTermosObrigatorios({ method: 'POST', url: '/termos/t-1/recusar' }), false);
});

// ── 14. Testes unitários diretos de termsAuthorityService
test('14. termsAuthorityService.verificarTermosObrigatoriosPendentes isolado', async () => {
  // Super-admin é sempre isento sem consultar DB
  const resSuper = await termsAuthorityService.verificarTermosObrigatoriosPendentes({
    usuarioId: 'any-id',
    role: 'qualquer',
    isSuperAdmin: true,
  });
  assert.deepEqual(resSuper, { temPendentes: false, count: 0 });

  // Validação de parâmetros obrigatórios
  await assert.rejects(
    () => termsAuthorityService.verificarTermosObrigatoriosPendentes({ usuarioId: '', role: 'admin' }),
    /usuarioId inválido ou ausente/
  );
  await assert.rejects(
    () => termsAuthorityService.verificarTermosObrigatoriosPendentes({ usuarioId: 'uid', role: '' }),
    /role inválido ou ausente/
  );

  // Cliente indisponível lança erro (fail-closed)
  await assert.rejects(
    () => termsAuthorityService.verificarTermosObrigatoriosPendentes({
      usuarioId: 'uid',
      role: 'admin',
      supabaseClient: null,
    }),
    /Cliente de autoridade indisponível/
  );

  // Sem termos ativos
  const mockVazio = {
    from: () => ({
      select: () => ({
        eq: () => ({
          contains: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  };
  const resVazio = await termsAuthorityService.verificarTermosObrigatoriosPendentes({
    usuarioId: 'uid',
    role: 'admin',
    supabaseClient: mockVazio,
  });
  assert.deepEqual(resVazio, { temPendentes: false, count: 0 });
});


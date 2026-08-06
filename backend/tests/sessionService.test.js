// Testes do serviço de sessões (SEC-1) com supabase FALSO (rpc + tabelas mockadas).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthConfig } = require('../config/authConfig');
const { verificarAccessTokenAssinatura } = require('../services/auth/authCrypto');
const E = require('../services/auth/authErrors');
const { criarSessionService } = require('../services/auth/sessionService');

const cfg = loadAuthConfig({
  AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true',
  AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste', JWT_SECRET: 'jwt-teste',
});

// Supabase falso: rpc por nome; tabelas com respostas consumidas em ordem.
function fakeSupabase({ rpc = {}, tables = {} } = {}) {
  const consumo = {};
  const mk = (table) => {
    const b = {
      select() { return b; }, eq() { return b; }, is() { return b; }, lt() { return b; }, order() { return b; }, update() { return b; },
      maybeSingle() { return next(); },
      then(res, rej) { return next().then(res, rej); },
    };
    function next() {
      consumo[table] = consumo[table] || 0;
      const arr = tables[table] || [];
      const r = arr[consumo[table]] ?? { data: null, error: null };
      consumo[table]++;
      return Promise.resolve(r);
    }
    return b;
  };
  return {
    rpc: async (name) => rpc[name] ?? { data: null, error: { message: 'rpc não mockada' } },
    from: (t) => mk(t),
  };
}

test('criarSessao → access JWT válido + RefreshDelivery redigido', async () => {
  const supabase = fakeSupabase({ rpc: { criar_sessao_auth: { data: [{ session_id: 'sess-1', refresh_family_id: 'fam-1', refresh_token_id: 'tok-1' }], error: null } } });
  const svc = criarSessionService({ supabase, cfg });
  const r = await svc.criarSessao({ usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web', role: 'admin', is_super_admin: false });
  const p = verificarAccessTokenAssinatura(r.accessToken, cfg);
  assert.equal(p.sid, 'sess-1'); assert.equal(p.uid, 'u-1'); assert.equal(p.token_use, 'access');
  // RefreshDelivery: reveal() dá o token; toJSON()/stringify redigem.
  assert.ok(r.refreshDelivery.reveal().startsWith('r1.'));
  assert.ok(JSON.stringify(r.refreshDelivery).includes('[REDACTED]'));
  assert.ok(!JSON.stringify(r).includes(r.refreshDelivery.reveal()), 'token aberto não pode serializar no resultado');
});

test('criarSessao: erro de RPC → SessionDependencyUnavailable (503)', async () => {
  const supabase = fakeSupabase({ rpc: { criar_sessao_auth: { data: null, error: { message: 'db down' } } } });
  const svc = criarSessionService({ supabase, cfg });
  await assert.rejects(() => svc.criarSessao({ usuario_id: 'u', client_type: 'web' }), (e) => e instanceof E.SessionDependencyUnavailable && e.httpStatus === 503);
});

test('rotacionarRefresh ok → access novo + delivery; erros mapeados', async () => {
  const okSupa = fakeSupabase({ rpc: { rotacionar_refresh_token: { data: [{ resultado: 'ok', session_id: 'sess-1', usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web', novo_token_id: 't2', nova_version: 2 }], error: null } } });
  const svc = criarSessionService({ supabase: okSupa, cfg });
  const r = await svc.rotacionarRefresh({ refreshToken: 'r1.abc' });
  assert.equal(verificarAccessTokenAssinatura(r.accessToken, cfg).sid, 'sess-1');

  for (const [resultado, Klass, http] of [['reuse_detected', E.RefreshReuseDetected, 401], ['refresh_already_rotated', E.RefreshAlreadyRotated, 409], ['expirado', E.RefreshExpired, 401], ['invalido', E.RefreshInvalid, 401], ['sessao_invalida', E.SessionInvalid, 401]]) {
    const supa = fakeSupabase({ rpc: { rotacionar_refresh_token: { data: [{ resultado, session_id: 's', usuario_id: 'u', empresa_id: null, client_type: 'web' }], error: null } } });
    const s2 = criarSessionService({ supabase: supa, cfg });
    await assert.rejects(() => s2.rotacionarRefresh({ refreshToken: 'r1.x' }), (e) => e instanceof Klass && e.httpStatus === http, `resultado=${resultado}`);
  }
});

test('validarSessaoParaAcesso: feliz → req.user do BANCO (não do token)', async () => {
  const sess = { data: { id: 'sess-1', usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web', revoked_at: null, idle_expires_at: new Date(Date.now() + 3600e3).toISOString(), absolute_expires_at: new Date(Date.now() + 3600e3).toISOString(), last_activity_at: new Date(Date.now() - 5000).toISOString() }, error: null };
  const user = { data: { id: 'u-1', tipo: 'admin', status: 'ativo', is_super_admin: false, empresa_id: 'e-1' }, error: null };
  const supabase = fakeSupabase({ tables: { auth_sessions: [sess, { data: [{ id: 'sess-1' }], error: null }], usuarios: [user] } });
  const svc = criarSessionService({ supabase, cfg });
  const rq = await svc.validarSessaoParaAcesso({ sid: 'sess-1', uid: 'u-1' });
  assert.equal(rq.uid, 'u-1'); assert.equal(rq.role, 'admin'); assert.equal(rq.empresa_id, 'e-1'); assert.equal(rq.is_super_admin, false);
});

test('validarSessaoParaAcesso: revogada / idle / not-found / bloqueado', async () => {
  const base = (over) => ({ data: { id: 's', usuario_id: 'u', empresa_id: null, client_type: 'web', revoked_at: null, idle_expires_at: new Date(Date.now() + 3600e3).toISOString(), absolute_expires_at: new Date(Date.now() + 3600e3).toISOString(), last_activity_at: new Date().toISOString(), ...over }, error: null });
  const userOk = { data: { id: 'u', tipo: 'admin', status: 'ativo', is_super_admin: false, empresa_id: null }, error: null };

  let svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({ revoked_at: new Date().toISOString() })] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionRevoked);

  svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({ idle_expires_at: new Date(Date.now() - 1000).toISOString() })] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionIdleExpired);

  svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [{ data: null, error: null }] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionNotFound);

  svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({})], usuarios: [{ data: { id: 'u', tipo: 'admin', status: 'bloqueado', is_super_admin: false, empresa_id: null }, error: null }] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionRevoked);
});

test('validarSessaoParaAcesso: falha de infra → 503 fail-closed (nunca "válido")', async () => {
  const supabase = fakeSupabase({ tables: { auth_sessions: [{ data: null, error: { message: 'timeout' } }] } });
  const svc = criarSessionService({ supabase, cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionDependencyUnavailable && e.httpStatus === 503);
});

test('atualizarAtividadeThrottled: dentro do throttle NÃO escreve', async () => {
  const supabase = fakeSupabase({ tables: { auth_sessions: [{ data: [{ id: 's' }], error: null }] } });
  const svc = criarSessionService({ supabase, cfg });
  const r = await svc.atualizarAtividadeThrottled({ id: 's', last_activity_at: new Date().toISOString() });
  assert.equal(r.atualizado, false, 'atividade recente não deve reescrever');
});

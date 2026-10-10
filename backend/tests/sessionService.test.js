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
  const expEfetiva = new Date(Date.now() + 3600e3).toISOString();
  const okSupa = fakeSupabase({ rpc: { rotacionar_refresh_token: { data: [{ resultado: 'ok', session_id: 'sess-1', usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web', novo_token_id: 't2', nova_version: 2, novo_expires_at: expEfetiva }], error: null } } });
  const svc = criarSessionService({ supabase: okSupa, cfg });
  const r = await svc.rotacionarRefresh({ refreshToken: 'r1.abc' });
  assert.equal(verificarAccessTokenAssinatura(r.accessToken, cfg).sid, 'sess-1');
  assert.equal(r.refreshDelivery.expiresAt, expEfetiva);

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

test('validarSessaoParaAcesso: revogada / idle / not-found / usuário não autenticável', async () => {
  const base = (over) => ({ data: { id: 's', usuario_id: 'u', empresa_id: null, client_type: 'web', revoked_at: null, idle_expires_at: new Date(Date.now() + 3600e3).toISOString(), absolute_expires_at: new Date(Date.now() + 3600e3).toISOString(), last_activity_at: new Date().toISOString(), ...over }, error: null });
  const userOk = { data: { id: 'u', tipo: 'admin', status: 'ativo', is_super_admin: false, empresa_id: null }, error: null };

  let svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({ revoked_at: new Date().toISOString() })] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionRevoked);

  svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({ idle_expires_at: new Date(Date.now() - 1000).toISOString() })] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionIdleExpired);

  svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [{ data: null, error: null }] } }), cfg });
  await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionNotFound);

  for (const status of ['bloqueado', 'inativo', 'desativado', 'cancelado', null]) {
    svc = criarSessionService({ supabase: fakeSupabase({ tables: { auth_sessions: [base({})], usuarios: [{ data: { id: 'u', tipo: 'admin', status, is_super_admin: false, empresa_id: null }, error: null }] } }), cfg });
    await assert.rejects(() => svc.validarSessaoParaAcesso({ sid: 's', uid: 'u' }), (e) => e instanceof E.SessionRevoked, `status=${status}`);
  }
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

test('atualizarAtividadeThrottled clampa idle no teto absoluto', async () => {
  let updatePayload = null;
  const supabase = {
    from() {
      const b = {
        update(payload) { updatePayload = payload; return b; },
        eq() { return b; }, is() { return b; }, lt() { return b; }, select() { return Promise.resolve({ data: [{ id: 's' }], error: null }); },
      };
      return b;
    },
  };
  const svc = criarSessionService({ supabase, cfg });
  const absolute = new Date(Date.now() + 120000).toISOString();
  await svc.atualizarAtividadeThrottled({ id: 's', last_activity_at: new Date(Date.now() - 120000).toISOString(), absolute_expires_at: absolute });
  assert.equal(updatePayload.idle_expires_at, absolute);
});

test('revogacoes usam RPC transacional com auditoria e preservam ownership', async () => {
  const chamadasRpc = [];
  const sessoes = [
    { data: { id: 's-1', usuario_id: 'u-1', revoked_at: null }, error: null },
    { data: { id: 's-1', usuario_id: 'u-1', revoked_at: null }, error: null },
  ];
  const supabase = {
    async rpc(name, args) {
      chamadasRpc.push({ name, args });
      if (name === 'revogar_sessao_auth') return { data: [{ revogada: true, usuario_id: 'u-1' }], error: null };
      if (name === 'revogar_sessoes_usuario') return { data: 2, error: null };
      return { data: null, error: { message: 'rpc nao mockada' } };
    },
    from() {
      const b = {
        select() { return b; }, eq() { return b; }, maybeSingle() { return Promise.resolve(sessoes.shift() || { data: null, error: null }); },
      };
      return b;
    },
  };
  const svc = criarSessionService({ supabase, cfg });

  assert.deepEqual(await svc.revogarSessao('s-1', 'logout'), { ok: true, revogou: true });
  assert.deepEqual(await svc.revogarTodasDoUsuario('u-1', 'senha_alterada'), { ok: true, revogadas: 2 });
  assert.deepEqual(await svc.revogarUmaDoUsuario('u-1', 's-1', 'revogacao_usuario'), { ok: true, revogou: true });

  assert.deepEqual(chamadasRpc.map((c) => c.name), [
    'revogar_sessao_auth',
    'revogar_sessoes_usuario',
    'revogar_sessao_auth',
  ]);
  assert.equal(chamadasRpc[1].args.p_motivo, 'senha_alterada');

  const chamadasAlheias = [];
  const alheia = {
    async rpc(name, args) { chamadasAlheias.push({ name, args }); return { data: null, error: null }; },
    from() {
      const b = {
        select() { return b; }, eq() { return b; },
        maybeSingle() { return Promise.resolve({ data: { id: 's-2', usuario_id: 'u-2', revoked_at: null }, error: null }); },
      };
      return b;
    },
  };
  const svcAlheio = criarSessionService({ supabase: alheia, cfg });
  await assert.rejects(() => svcAlheio.revogarUmaDoUsuario('u-1', 's-2'), (e) => e instanceof E.SessionForbidden && e.httpStatus === 403);
  assert.equal(chamadasAlheias.length, 0, 'sessao alheia nao pode chegar na RPC de revogacao');
});

// ── R1B-B: PER-CLIENT IDLE TESTS (WEB 30m vs NON-WEB GLOBAL) ─────────────────
test('R1B-B: criarSessao web => idle 1800s; android => cfg.refreshIdleTtlSeconds', async () => {
  let webArgs, androidArgs;
  const customCfg = loadAuthConfig({
    AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true',
    AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste', JWT_SECRET: 'jwt-teste',
    AUTH_REFRESH_IDLE_TTL_SECONDS: '604800',
  });
  const supabase = {
    rpc: async (name, args) => {
      if (args.p_client_type === 'web') webArgs = args;
      if (args.p_client_type === 'android') androidArgs = args;
      return { data: [{ session_id: 's', refresh_family_id: 'f', refresh_token_id: 't' }], error: null };
    },
  };
  const svc = criarSessionService({ supabase, cfg: customCfg });
  const t0 = Date.now();
  await svc.criarSessao({ usuario_id: 'u', client_type: 'web' });
  await svc.criarSessao({ usuario_id: 'u', client_type: 'android' });

  const webIdleMs = new Date(webArgs.p_idle_expires_at).getTime() - t0;
  assert.ok(Math.abs(webIdleMs - 1800 * 1000) < 5000, `web idle deve ser ~1800s (foi ${webIdleMs / 1000}s)`);

  const androidIdleMs = new Date(androidArgs.p_idle_expires_at).getTime() - t0;
  assert.ok(Math.abs(androidIdleMs - 604800 * 1000) < 5000, `android idle deve ser ~604800s (foi ${androidIdleMs / 1000}s)`);
});

test('R1B-B: validarSessaoParaAcesso: sessão web antiga com stored idle futuro e last_activity > 30m => rejeitada', async () => {
  const agora = Date.now();
  const sessWebAntiga = {
    data: {
      id: 'sess-web-1', usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web',
      revoked_at: null,
      idle_expires_at: new Date(agora + 6 * 86400 * 1000).toISOString(),
      absolute_expires_at: new Date(agora + 20 * 86400 * 1000).toISOString(),
      last_activity_at: new Date(agora - 31 * 60 * 1000).toISOString(),
    },
    error: null,
  };
  const user = { data: { id: 'u-1', tipo: 'admin', status: 'ativo', is_super_admin: false, empresa_id: 'e-1' }, error: null };
  const supabase = fakeSupabase({ tables: { auth_sessions: [sessWebAntiga], usuarios: [user] } });
  const svc = criarSessionService({ supabase, cfg });
  await assert.rejects(
    () => svc.validarSessaoParaAcesso({ sid: 'sess-web-1', uid: 'u-1' }),
    (e) => e instanceof E.SessionIdleExpired && e.httpStatus === 401
  );
});

test('R1B-B: validarSessaoParaAcesso: sessão web ativa < 30m => permitida', async () => {
  const agora = Date.now();
  const sessWebAtiva = {
    data: {
      id: 'sess-web-2', usuario_id: 'u-1', empresa_id: 'e-1', client_type: 'web',
      revoked_at: null,
      idle_expires_at: new Date(agora + 1800 * 1000).toISOString(),
      absolute_expires_at: new Date(agora + 20 * 86400 * 1000).toISOString(),
      last_activity_at: new Date(agora - 5 * 60 * 1000).toISOString(),
    },
    error: null,
  };
  const user = { data: { id: 'u-1', tipo: 'admin', status: 'ativo', is_super_admin: false, empresa_id: 'e-1' }, error: null };
  const supabase = fakeSupabase({
    tables: {
      auth_sessions: [sessWebAtiva, { data: [{ id: 'sess-web-2' }], error: null }],
      usuarios: [user],
    },
  });
  const svc = criarSessionService({ supabase, cfg });
  const rq = await svc.validarSessaoParaAcesso({ sid: 'sess-web-2', uid: 'u-1' });
  assert.equal(rq.uid, 'u-1');
  assert.equal(rq.sid, 'sess-web-2');
});

test('R1B-B: atualizarAtividadeThrottled: web desliza ~1800s; android desliza global', async () => {
  let updatePayloadWeb = null;
  let updatePayloadAndroid = null;
  const customCfg = loadAuthConfig({
    AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true',
    AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste', JWT_SECRET: 'jwt-teste',
    AUTH_REFRESH_IDLE_TTL_SECONDS: '604800',
    AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS: '60',
  });
  const mkSupabase = (capture) => ({
    from() {
      const b = {
        update(payload) { capture(payload); return b; },
        eq() { return b; }, is() { return b; }, lt() { return b; },
        select() { return Promise.resolve({ data: [{ id: 's' }], error: null }); },
      };
      return b;
    },
  });
  const t0 = Date.now();
  const svcWeb = criarSessionService({ supabase: mkSupabase((p) => { updatePayloadWeb = p; }), cfg: customCfg });
  const svcAndroid = criarSessionService({ supabase: mkSupabase((p) => { updatePayloadAndroid = p; }), cfg: customCfg });

  await svcWeb.atualizarAtividadeThrottled({
    id: 's-web', client_type: 'web',
    last_activity_at: new Date(t0 - 120000).toISOString(),
    absolute_expires_at: new Date(t0 + 30 * 86400 * 1000).toISOString(),
  });
  const webDeltaMs = new Date(updatePayloadWeb.idle_expires_at).getTime() - t0;
  assert.ok(Math.abs(webDeltaMs - 1800 * 1000) < 5000, `web slide deve ser ~1800s (foi ${webDeltaMs / 1000}s)`);

  await svcAndroid.atualizarAtividadeThrottled({
    id: 's-and', client_type: 'android',
    last_activity_at: new Date(t0 - 120000).toISOString(),
    absolute_expires_at: new Date(t0 + 30 * 86400 * 1000).toISOString(),
  });
  const andDeltaMs = new Date(updatePayloadAndroid.idle_expires_at).getTime() - t0;
  assert.ok(Math.abs(andDeltaMs - 604800 * 1000) < 5000, `android slide deve ser ~604800s (foi ${andDeltaMs / 1000}s)`);
});

test('R1B-B: listarSessoesDoUsuario projeta expira_em efetivo para web e preserva não-web', async () => {
  const agora = Date.now();
  const sessoes = [
    {
      id: 's-web-old', client_type: 'web', device_label: 'Chrome',
      created_at: new Date(agora - 86400000).toISOString(),
      last_activity_at: new Date(agora - 10 * 60 * 1000).toISOString(),
      idle_expires_at: new Date(agora + 6 * 86400000).toISOString(),
      absolute_expires_at: new Date(agora + 20 * 86400000).toISOString(),
      revoked_at: null,
    },
    {
      id: 's-and', client_type: 'android', device_label: 'Pixel',
      created_at: new Date(agora - 86400000).toISOString(),
      last_activity_at: new Date(agora - 2 * 3600000).toISOString(),
      idle_expires_at: new Date(agora + 6 * 86400000).toISOString(),
      absolute_expires_at: new Date(agora + 20 * 86400000).toISOString(),
      revoked_at: null,
    },
  ];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: sessoes, error: null }),
        }),
      }),
    }),
  };
  const svc = criarSessionService({ supabase, cfg });
  const lista = await svc.listarSessoesDoUsuario('u-1');

  assert.equal(lista.length, 2);
  const webItem = lista.find((x) => x.id === 's-web-old');
  const andItem = lista.find((x) => x.id === 's-and');

  const esperadoWebMs = new Date(agora - 10 * 60 * 1000 + 1800 * 1000).getTime();
  assert.equal(new Date(webItem.expira_em).getTime(), esperadoWebMs, 'web deve refletir last_activity + 1800');
  assert.equal(andItem.expira_em, sessoes[1].idle_expires_at, 'android deve preservar idle_expires_at');
});

test('R1B-B: rotacionarRefresh NÃO faz pré-leitura de auth_sessions/auth_refresh_tokens no Node', async () => {
  const tabelasConsultadas = [];
  const rpcsChamadas = [];
  const supabase = {
    from(table) {
      tabelasConsultadas.push(table);
      const b = {
        select() { return b; }, eq() { return b; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return b;
    },
    rpc(name, args) {
      rpcsChamadas.push({ name, args });
      return Promise.resolve({
        data: [{ resultado: 'ok', session_id: 's-1', usuario_id: 'u-1', empresa_id: null, client_type: 'web', novo_token_id: 't-2', nova_version: 2, novo_expires_at: new Date().toISOString() }],
        error: null,
      });
    },
  };
  const svc = criarSessionService({ supabase, cfg });
  await svc.rotacionarRefresh({ refreshToken: 'r1.teste-sem-pre-leitura' });

  assert.equal(tabelasConsultadas.length, 0, 'nenhuma consulta a tabelas antes da RPC');
  assert.equal(rpcsChamadas.length, 1, 'RPC invocada diretamente');
  assert.equal(rpcsChamadas[0].name, 'rotacionar_refresh_token');
});

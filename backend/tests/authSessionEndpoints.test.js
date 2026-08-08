// Testes HTTP REAIS dos endpoints de sessão (SEC-1): servidor efêmero + fetch.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { loadAuthConfig } = require('../config/authConfig');
const { RefreshDelivery } = require('../services/auth/sessionService');
const E = require('../services/auth/authErrors');
const { criarAuthSessionController } = require('../controllers/authSessionController');

const cfg = loadAuthConfig({ AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', AUTH_REFRESH_TOKEN_PEPPER: 'p', JWT_SECRET: 'j' });
const RT_ANTIGO = `r1.${'A'.repeat(43)}`;
const RT_NOVO = `r1.${'B'.repeat(43)}`;
const SID_1 = '11111111-1111-4111-8111-111111111111';

// sessionService FALSO, comportamento configurável por teste via variáveis do closure.
let rotacaoResultado = 'ok';      // 'ok' | erro
let revogarSessaoErro = null;
let revogarUmaResultado = { ok: true, revogou: true };
let revogados = [];
const sessionServiceFake = {
  async rotacionarRefresh() {
    if (rotacaoResultado === 'ok') return { accessToken: 'access-xyz', refreshDelivery: new RefreshDelivery(RT_NOVO, new Date(Date.now() + 86400000).toISOString()) };
    const err = E.erroDeResultadoRotacao(rotacaoResultado, 'teste') || new E.RefreshInvalid();
    throw err;
  },
  async revogarSessao(sid) { if (revogarSessaoErro) throw revogarSessaoErro; revogados.push(['uma', sid]); },
  async revogarTodasDoUsuario(uid) { revogados.push(['todas', uid]); },
  async revogarUmaDoUsuario(uid, sid) {
    if (revogarUmaResultado instanceof Error) throw revogarUmaResultado;
    revogados.push(['propria', uid, sid]);
    return revogarUmaResultado;
  },
  async listarSessoesDoUsuario(uid) { return [{ id: 's1', client_type: 'web', device_label: null, created_at: 'x', last_activity_at: 'y', expira_em: 'z', revogada: false }]; },
};

const ctrl = criarAuthSessionController({ sessionService: sessionServiceFake, cfg });

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // "autenticado" simulado para as rotas protegidas
  const fakeAuth = (req, _res, next) => { req.user = { uid: 'u-1', sid: 'sess-atual' }; next(); };
  app.post('/auth/refresh', ctrl.refreshWeb);
  app.post('/auth/mobile/refresh', ctrl.refreshMobile);
  app.post('/auth/logout', fakeAuth, ctrl.logout);
  app.post('/auth/logout-all', fakeAuth, ctrl.logoutAll);
  app.get('/auth/sessions', fakeAuth, ctrl.listSessions);
  app.delete('/auth/sessions/:id', fakeAuth, ctrl.revokeSession);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const post = (path, { body, headers, cookie } = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(headers || {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

test('mobile refresh ok → 200 com token + refresh_token no body', async () => {
  rotacaoResultado = 'ok';
  const r = await post('/auth/mobile/refresh', { body: { refresh_token: RT_ANTIGO } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.token, 'access-xyz');
  assert.equal(j.refresh_token, RT_NOVO); // app recebe refresh no body (secure storage)
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('mobile refresh: reuse → 401; already_rotated → 409; sem token → 400; origem web → 400', async () => {
  rotacaoResultado = 'reuse_detected';
  assert.equal((await post('/auth/mobile/refresh', { body: { refresh_token: RT_ANTIGO } })).status, 401);
  rotacaoResultado = 'refresh_already_rotated';
  assert.equal((await post('/auth/mobile/refresh', { body: { refresh_token: RT_ANTIGO } })).status, 409);
  rotacaoResultado = 'ok';
  assert.equal((await post('/auth/mobile/refresh', { body: {} })).status, 400);
  assert.equal((await post('/auth/mobile/refresh', { body: { refresh_token: RT_ANTIGO }, headers: { origin: 'https://matopibalog.com.br' } })).status, 400);
});

test('web refresh ok → 200 com token e SEM refresh no body; Set-Cookie presente', async () => {
  rotacaoResultado = 'ok';
  const r = await post('/auth/refresh', { cookie: `refresh_token=${RT_ANTIGO}`, headers: { origin: 'https://matopibalog.com.br' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.token, 'access-xyz');
  assert.equal(j.refresh_token, undefined, 'WEB NUNCA devolve refresh no JSON');
  const setCookie = r.headers.get('set-cookie') || '';
  assert.ok(/refresh_token=/.test(setCookie) && /HttpOnly/i.test(setCookie), 'refresh só via cookie HttpOnly');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('web refresh sem cookie → 401; sem origem/referer → 403', async () => {
  rotacaoResultado = 'ok';
  assert.equal((await post('/auth/refresh', { headers: { origin: 'https://matopibalog.com.br' } })).status, 401);
  assert.equal((await post('/auth/refresh', { cookie: `refresh_token=${RT_ANTIGO}` })).status, 403);
});

test('web refresh reuse → 401 e limpa cookie', async () => {
  rotacaoResultado = 'reuse_detected';
  const r = await post('/auth/refresh', { cookie: `refresh_token=${RT_ANTIGO}`, headers: { origin: 'https://matopibalog.com.br' } });
  assert.equal(r.status, 401);
  const setCookie = r.headers.get('set-cookie') || '';
  assert.ok(/refresh_token=/.test(setCookie), 'deve limpar o cookie de refresh');
});

test('logout → 200, revoga sessão atual e limpa cookie (idempotente)', async () => {
  revogados = [];
  revogarSessaoErro = null;
  const r = await post('/auth/logout', {});
  assert.equal(r.status, 200);
  assert.deepEqual(revogados[0], ['uma', 'sess-atual']);
  assert.ok(/refresh_token=/.test(r.headers.get('set-cookie') || ''));
});

test('logout com falha de infraestrutura → 503, ainda limpa cookie', async () => {
  revogados = [];
  revogarSessaoErro = new E.SessionDependencyUnavailable('db down');
  const r = await post('/auth/logout', {});
  assert.equal(r.status, 503);
  assert.ok(/refresh_token=/.test(r.headers.get('set-cookie') || ''));
  revogarSessaoErro = null;
});

test('logout-all → 200 e revoga todas do usuário', async () => {
  revogados = [];
  const r = await post('/auth/logout-all', {});
  assert.equal(r.status, 200);
  assert.deepEqual(revogados[0], ['todas', 'u-1']);
});

test('GET sessions → 200 lista sanitizada', async () => {
  const r = await fetch(base + '/auth/sessions');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sessoes.length, 1);
  // sanitizado: sem token/hash/ip
  assert.ok(!JSON.stringify(j).match(/token_hash|ip_hash|refresh/i));
});

test('DELETE sessions/:id → 200 revoga só a própria', async () => {
  revogados = [];
  revogarUmaResultado = { ok: true, revogou: true };
  const r = await fetch(base + `/auth/sessions/${SID_1}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(revogados[0], ['propria', 'u-1', SID_1]);
});

test('DELETE sessions/:id inválido → 400; sessão estrangeira → 403; inexistente → 404', async () => {
  assert.equal((await fetch(base + '/auth/sessions/s1', { method: 'DELETE' })).status, 400);
  revogarUmaResultado = new E.SessionForbidden('sessao alheia');
  assert.equal((await fetch(base + `/auth/sessions/${SID_1}`, { method: 'DELETE' })).status, 403);
  revogarUmaResultado = { ok: false, revogou: false, motivo: 'not_found' };
  assert.equal((await fetch(base + `/auth/sessions/${SID_1}`, { method: 'DELETE' })).status, 404);
  revogarUmaResultado = { ok: true, revogou: true };
});

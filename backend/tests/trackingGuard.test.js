// O guard importa verificarPlano/tenant (que carregam config/supabase, o qual faz
// process.exit(1) sem env). Aqui injetamos env DUMMY antes dos requires — o client
// supabase é lazy (não conecta no import) e nunca é usado (fakes injetados no guard).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { criarGuardTelemetria, exigirTracking } = require('../middlewares/trackingCredential');
const TE = require('../services/auth/trackingCredentialErrors');

// ── Duplos de teste ─────────────────────────────────────────────────────────────
// Sessão SEC-1 falsa: header x-fake-access = 'valid' | 'expired' | ausente.
function fakeVerifyToken(req, res, next) {
  const a = req.headers['x-fake-access'];
  if (a === 'valid') { req.user = { uid: 'mot-1', role: 'motorista', is_super_admin: false }; return next(); }
  return res.status(401).json({ error: 'Token inválido ou expirado.' });
}
function fakeVerificarEmpresa(req, _res, next) { req.empresa_id = 'emp-1'; next(); }
function passthrough(_req, _res, next) { next(); }
// verificarPlano que BLOQUEIA (para provar que o ramo tracking também respeita o gate).
function planoBloqueia(_req, res) { return res.status(403).json({ error: 'bloqueio_comercial' }); }

function fakeTrackingService() {
  return {
    async validar({ token }) {
      if (token === 'valid-cred') return { uid: 'mot-1', empresa_id: 'emp-1', role: 'motorista', is_super_admin: false, credential_id: 'cred-1' };
      if (token === 'expired-cred') throw new TE.TrackingCredentialExpired('exp');
      if (token === 'revoked-cred') throw new TE.TrackingCredentialRevoked('rev');
      throw new TE.TrackingCredentialInvalid('inv');
    },
    async renovar() { return { expiresAt: new Date(Date.now() + 3600000).toISOString() }; },
  };
}

function montarApp({ flagOn = true, verificarPlano = passthrough } = {}) {
  const getRuntime = () => ({
    cfg: { trackingScopedCredentialEnabled: flagOn },
    trackingService: flagOn ? fakeTrackingService() : null,
  });
  const guard = criarGuardTelemetria({
    getRuntime,
    verifyToken: fakeVerifyToken,
    verificarEmpresa: fakeVerificarEmpresa,
    verificarPlano,
  });

  const app = express();
  app.use(express.json());

  // Sub-router de telemetria (espelha routes/fretes.js).
  const tele = express.Router();
  tele.use(guard);
  tele.post('/', (req, res) => res.status(201).json({ ok: true, authKind: req.authKind, uid: req.user.uid, empresa_id: req.empresa_id }));
  tele.post('/estado', (req, res) => res.status(200).json({ ok: true, authKind: req.authKind }));
  tele.post('/renovar-credencial', exigirTracking, (_req, res) => res.status(200).json({ ok: true }));
  app.use('/fretes/localizacao/sessao', tele);

  // Rota GERAL protegida SÓ por verifyToken (prova de não-privilégio da credencial).
  app.post('/auth/me', fakeVerifyToken, (req, res) => res.status(200).json({ uid: req.user.uid }));

  return app;
}

// Helper HTTP sem libs externas.
const http = require('node:http');
function req(app, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ port, method, path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      r.on('error', (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

test('sessão válida (sem tracking) → 201 pelo ramo de sessão', async () => {
  const app = montarApp();
  const r = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-fake-access': 'valid' }, { latitude: 1, longitude: 2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.authKind, undefined); // ramo de sessão não seta authKind='tracking'
});

test('§23 (HTTP): access EXPIRADO sem credencial → 401 (comportamento atual quebraria)', async () => {
  const app = montarApp();
  const r = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-fake-access': 'expired' }, { latitude: 1, longitude: 2 });
  assert.equal(r.status, 401);
});

test('§23 (HTTP): credencial de tracking + access EXPIRADO → 201 (rastreamento sobrevive)', async () => {
  const app = montarApp();
  const r = await req(app, 'POST', '/fretes/localizacao/sessao',
    { 'x-tracking-credential': 'valid-cred', 'x-fake-access': 'expired' }, { latitude: 1, longitude: 2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.authKind, 'tracking');
  assert.equal(r.body.uid, 'mot-1');
  assert.equal(r.body.empresa_id, 'emp-1');
});

test('§23: credencial válida SEM qualquer Authorization → 201', async () => {
  const app = montarApp();
  const r = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'valid-cred' }, { latitude: 1, longitude: 2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.authKind, 'tracking');
});

test('credencial inválida → 401 credential_invalid; revogada → 401 credential_revoked; expirada → 401 credential_expired', async () => {
  const app = montarApp();
  const inv = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'xxx' }, {});
  assert.equal(inv.status, 401); assert.equal(inv.body.error, 'credential_invalid');
  const rev = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'revoked-cred' }, {});
  assert.equal(rev.status, 401); assert.equal(rev.body.error, 'credential_revoked');
  const exp = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'expired-cred' }, {});
  assert.equal(exp.status, 401); assert.equal(exp.body.error, 'credential_expired');
});

test('§27 PRIVILÉGIO: credencial de tracking NÃO autentica endpoint geral (/auth/me) → 401', async () => {
  const app = montarApp();
  const r = await req(app, 'POST', '/auth/me', { 'x-tracking-credential': 'valid-cred' }, {});
  assert.equal(r.status, 401); // verifyToken não conhece a credencial; sem access → negado
});

test('flag OFF: X-Tracking-Credential é ignorado → cai no ramo de sessão (compatível)', async () => {
  const app = montarApp({ flagOn: false });
  // com access válido → 201 pelo ramo de sessão mesmo enviando credencial
  const ok = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'valid-cred', 'x-fake-access': 'valid' }, {});
  assert.equal(ok.status, 201);
  assert.equal(ok.body.authKind, undefined);
  // com access expirado → 401 (idêntico a hoje)
  const no = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'valid-cred', 'x-fake-access': 'expired' }, {});
  assert.equal(no.status, 401);
});

test('§9 não-ampliação: ramo de tracking também passa por verificarPlano (gate bloqueia)', async () => {
  const app = montarApp({ verificarPlano: planoBloqueia });
  const r = await req(app, 'POST', '/fretes/localizacao/sessao', { 'x-tracking-credential': 'valid-cred' }, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'bloqueio_comercial');
});

test('renovar-credencial exige authKind tracking (sessão → 403 tracking_only)', async () => {
  const app = montarApp();
  const comCred = await req(app, 'POST', '/fretes/localizacao/sessao/renovar-credencial', { 'x-tracking-credential': 'valid-cred' }, {});
  assert.equal(comCred.status, 200);
  const comSessao = await req(app, 'POST', '/fretes/localizacao/sessao/renovar-credencial', { 'x-fake-access': 'valid' }, {});
  assert.equal(comSessao.status, 403);
  assert.equal(comSessao.body.error, 'tracking_only');
});

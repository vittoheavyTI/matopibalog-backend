// O guard importa verificarPlano/tenant (que carregam config/supabase, o qual faz
// process.exit(1) sem env). Injetamos env DUMMY antes dos requires (client lazy).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { criarGuardTelemetria, exigirTracking } = require('../middlewares/trackingCredential');
const { erroDeCode } = require('../services/auth/trackingCredentialErrors');

const DEV = 'dev-1';

function fakeVerifyToken(req, res, next) {
  if (req.headers['x-fake-access'] === 'valid') { req.user = { uid: 'mot-1', role: 'motorista', is_super_admin: false }; return next(); }
  return res.status(401).json({ error: 'Token inválido ou expirado.' });
}
const fakeVerificarEmpresa = (req, _res, next) => { req.empresa_id = 'emp-1'; next(); };
const passthrough = (_req, _res, next) => next();
const planoBloqueia = (_req, res) => res.status(403).json({ error: 'bloqueio_comercial' });

function fakeTrackingService() {
  return {
    async validar({ token, deviceId }) {
      if (token !== 'valid-cred') {
        if (token === 'expired-cred') throw erroDeCode('tracking_credential_expired');
        if (token === 'revoked-cred') throw erroDeCode('tracking_credential_revoked');
        throw erroDeCode('tracking_credential_invalid');
      }
      if (deviceId !== DEV) throw erroDeCode('tracking_device_mismatch');
      return { uid: 'mot-1', empresa_id: 'emp-1', frete_id: 'frete-1', role: 'motorista', is_super_admin: false, credential_id: 'cred-1' };
    },
    async renovar() { return { expiresAt: new Date().toISOString() }; },
  };
}

function montarApp({ flagOn = true, verificarPlano = passthrough } = {}) {
  const getRuntime = () => ({ cfg: { trackingScopedCredentialEnabled: flagOn }, trackingService: flagOn ? fakeTrackingService() : null });
  const guard = criarGuardTelemetria({ getRuntime, verifyToken: fakeVerifyToken, verificarEmpresa: fakeVerificarEmpresa, verificarPlano });
  const app = express(); app.use(express.json());
  const tele = express.Router();
  tele.use(guard);
  tele.post('/', (req, res) => res.status(201).json({ ok: true, authKind: req.authKind, uid: req.user.uid, empresa_id: req.empresa_id, frete_id: req.trackingFreteId }));
  tele.post('/renovar-credencial', exigirTracking, (_req, res) => res.status(200).json({ ok: true }));
  app.use('/fretes/localizacao/sessao', tele);
  app.post('/auth/me', fakeVerifyToken, (req, res) => res.status(200).json({ uid: req.user.uid }));
  return app;
}

function req(app, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port; const data = body ? JSON.stringify(body) : null;
      const r = http.request({ port, method, path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        let buf = ''; res.on('data', (c) => (buf += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      r.on('error', (e) => { server.close(); reject(e); }); if (data) r.write(data); r.end();
    });
  });
}
const H_CRED = 'x-tracking-credential'; const H_DEV = 'x-tracking-device';

test('sessão válida (sem tracking) → 201 pelo ramo de sessão', async () => {
  const r = await req(montarApp(), 'POST', '/fretes/localizacao/sessao', { 'x-fake-access': 'valid' }, { latitude: 1, longitude: 2 });
  assert.equal(r.status, 201); assert.equal(r.body.authKind, undefined);
});

test('§23: access EXPIRADO sem credencial → 401', async () => {
  const r = await req(montarApp(), 'POST', '/fretes/localizacao/sessao', { 'x-fake-access': 'expired' }, {});
  assert.equal(r.status, 401);
});

test('§23: credencial + device + access EXPIRADO → 201; seta authKind e frete vinculado', async () => {
  const r = await req(montarApp(), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred', [H_DEV]: DEV, 'x-fake-access': 'expired' }, {});
  assert.equal(r.status, 201); assert.equal(r.body.authKind, 'tracking');
  assert.equal(r.body.uid, 'mot-1'); assert.equal(r.body.frete_id, 'frete-1');
});

test('§M-1 device: credencial sem/errado device → 403 tracking_device_mismatch', async () => {
  const semDev = await req(montarApp(), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred' }, {});
  assert.equal(semDev.status, 403); assert.equal(semDev.body.error, 'tracking_device_mismatch');
  const outro = await req(montarApp(), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred', [H_DEV]: 'outro' }, {});
  assert.equal(outro.status, 403); assert.equal(outro.body.error, 'tracking_device_mismatch');
});

test('códigos semânticos: invalid/revoked/expired', async () => {
  const app = montarApp();
  for (const [tok, code] of [['xxx', 'tracking_credential_invalid'], ['revoked-cred', 'tracking_credential_revoked'], ['expired-cred', 'tracking_credential_expired']]) {
    const r = await req(app, 'POST', '/fretes/localizacao/sessao', { [H_CRED]: tok, [H_DEV]: DEV }, {});
    assert.equal(r.status, 401); assert.equal(r.body.error, code);
  }
});

test('§27 PRIVILÉGIO: credencial NÃO autentica /auth/me → 401', async () => {
  const r = await req(montarApp(), 'POST', '/auth/me', { [H_CRED]: 'valid-cred', [H_DEV]: DEV }, {});
  assert.equal(r.status, 401);
});

test('flag OFF: header ignorado → ramo de sessão (compatível)', async () => {
  const ok = await req(montarApp({ flagOn: false }), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred', [H_DEV]: DEV, 'x-fake-access': 'valid' }, {});
  assert.equal(ok.status, 201); assert.equal(ok.body.authKind, undefined);
  const no = await req(montarApp({ flagOn: false }), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred', [H_DEV]: DEV, 'x-fake-access': 'expired' }, {});
  assert.equal(no.status, 401);
});

test('§9 não-ampliação: ramo tracking passa por verificarPlano (gate bloqueia)', async () => {
  const r = await req(montarApp({ verificarPlano: planoBloqueia }), 'POST', '/fretes/localizacao/sessao', { [H_CRED]: 'valid-cred', [H_DEV]: DEV }, {});
  assert.equal(r.status, 403); assert.equal(r.body.error, 'bloqueio_comercial');
});

test('renovar-credencial exige authKind tracking (sessão → 403 tracking_only)', async () => {
  const comCred = await req(montarApp(), 'POST', '/fretes/localizacao/sessao/renovar-credencial', { [H_CRED]: 'valid-cred', [H_DEV]: DEV }, {});
  assert.equal(comCred.status, 200);
  const comSessao = await req(montarApp(), 'POST', '/fretes/localizacao/sessao/renovar-credencial', { 'x-fake-access': 'valid' }, {});
  assert.equal(comSessao.status, 403); assert.equal(comSessao.body.error, 'tracking_only');
});

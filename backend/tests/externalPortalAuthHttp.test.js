'use strict';

// S4 — matriz HTTP mínima de fronteira entre:
//   • sistema interno da transportadora;
//   • Portal do Embarcador;
//   • Portal do Parceiro.
//
// Os testes unitários já protegem os serviços profundos. Este arquivo amarra o
// comportamento observável em HTTP: token de um domínio não vira credencial de
// outro, e qualquer `token_kind` externo é default-deny no auth interno.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service_key_de_teste';
process.env.JWT_SECRET = 'segredo-de-teste-s4-external-portals-http';
process.env.AUTH_SESSIONS_ENABLED = 'false';
process.env.AUTH_REFRESH_ROTATION_ENABLED = 'false';
process.env.AUTH_REQUIRE_SESSION = 'false';
process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

const { _resetAuthConfigCache } = require('../config/authConfig');
const { _resetAuthRuntimeForTests } = require('../services/auth/authRuntime');
_resetAuthConfigCache();
_resetAuthRuntimeForTests();

const { verifyToken } = require('../middlewares/auth');
const { emitirTokenPortal, verifyPortalToken } = require('../middlewares/shipperPortalAuth');

const loadOriginal = Module._load;
Module._load = function (request, parent, isMain) {
  const pedido = String(request).replace(/\\/g, '/');
  if (pedido.endsWith('config/supabase')) {
    const tabela = {
      select: () => tabela,
      eq: () => tabela,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return { from: () => tabela };
  }
  return loadOriginal.call(this, request, parent, isMain);
};
const { emitirTokenParceiro, verifyPartnerToken } = require('../middlewares/partnerPortalAuth');
Module._load = loadOriginal;

const ROTAS_INTERNAS_CRITICAS = [
  '/auth/me',
  '/usuarios',
  '/empresas',
  '/fretes',
  '/operation-campaigns',
  '/pagamentos/plano-status',
  '/shipper-inbox/solicitacoes',
  '/rede-parceiros/parceiros',
];

function appDeTeste() {
  const app = express();
  app.use(express.json());
  for (const rota of ROTAS_INTERNAS_CRITICAS) {
    app.get(rota, verifyToken, (_req, res) => res.json({ ok: true }));
  }
  app.get('/portal/embarcador/contexto', verifyPortalToken, (_req, res) => res.json({ ok: true }));
  app.get('/portal/parceiro/eu', verifyPartnerToken, (_req, res) => res.json({ ok: true }));
  return app;
}

function pedir(app, caminho, token) {
  return new Promise((resolve, reject) => {
    const servidor = app.listen(0, () => {
      const { port } = servidor.address();
      const req = http.request({
        port,
        method: 'GET',
        path: caminho,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          servidor.close();
          resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
        });
      });
      req.on('error', (e) => { servidor.close(); reject(e); });
      req.end();
    });
  });
}

const tokenInterno = () => jwt.sign({
  uid: 'u-interno-1',
  role: 'admin',
  is_super_admin: false,
}, process.env.JWT_SECRET, { expiresIn: 3600 });

const tokenEmbarcador = () => emitirTokenPortal({
  portalUserId: 'portal-user-1',
  shipperOrgId: 'shipper-org-1',
  email: 'contato@embarcador.test',
});

const tokenParceiro = () => emitirTokenParceiro({
  partnerUserId: 'partner-user-1',
  partnerOrganizationId: 'partner-org-1',
  email: 'contato@parceiro.test',
});

const tokenExternoFuturo = () => jwt.sign({
  token_kind: 'future_external_domain',
  uid: 'nao-e-interno',
  role: 'admin',
}, process.env.JWT_SECRET, { expiresIn: 3600 });

test('S4 HTTP: tokens externos e token_kind futuro são recusados nas rotas internas críticas', async () => {
  const app = appDeTeste();
  for (const rota of ROTAS_INTERNAS_CRITICAS) {
    for (const [nome, token] of [
      ['shipper_portal', tokenEmbarcador()],
      ['partner_portal', tokenParceiro()],
      ['future_external_domain', tokenExternoFuturo()],
    ]) {
      const r = await pedir(app, rota, token);
      assert.equal(r.status, 403, `${nome} não pode acessar ${rota}`);
    }
  }
});

test('S4 HTTP: token interno passa no auth interno, mas não entra nos portais externos', async () => {
  const app = appDeTeste();
  for (const rota of ROTAS_INTERNAS_CRITICAS) {
    const r = await pedir(app, rota, tokenInterno());
    assert.equal(r.status, 200, `token interno legítimo deve passar em ${rota}`);
  }

  assert.equal((await pedir(app, '/portal/embarcador/contexto', tokenInterno())).status, 403);
  assert.equal((await pedir(app, '/portal/parceiro/eu', tokenInterno())).status, 403);
});

test('S4 HTTP: os portais externos não aceitam token do outro portal', async () => {
  const app = appDeTeste();

  assert.equal((await pedir(app, '/portal/embarcador/contexto', tokenParceiro())).status, 403);
  assert.equal((await pedir(app, '/portal/parceiro/eu', tokenEmbarcador())).status, 403);
});

test('S4 HTTP: tokens externos não carregam tenant nem papel interno', () => {
  for (const token of [tokenEmbarcador(), tokenParceiro()]) {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    assert.ok(payload.token_kind, 'token externo precisa declarar o domínio');
    assert.equal(payload.empresa_id, undefined);
    assert.equal(payload.uid, undefined);
    assert.equal(payload.role, undefined);
    assert.equal(payload.is_super_admin, undefined);
  }
});

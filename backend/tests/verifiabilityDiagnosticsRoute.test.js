const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
process.env.AUTH_SESSIONS_ENABLED = 'false';
process.env.AUTH_REFRESH_ROTATION_ENABLED = 'false';
process.env.AUTH_REQUIRE_SESSION = 'false';
process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true';

const { _resetAuthConfigCache } = require('../config/authConfig');
const { _resetAuthRuntimeForTests } = require('../services/auth/authRuntime');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');

const routePath = require.resolve('../routes/diagnostics');

function carregarRouterDiagnostics() {
  const originalLoad = Module._load;
  delete require.cache[routePath];
  _resetAuthConfigCache();
  _resetAuthRuntimeForTests();

  Module._load = function (request, parent, isMain) {
    if (request === '../controllers/diagnosticsController') {
      return {
        listarDiagnosticos: (_req, res) => res.json({ ok: true }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(routePath);
  } finally {
    Module._load = originalLoad;
  }
}

function acharRoute(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === '/' && route.methods.get) return route;
  }
  throw new Error('GET /admin/diagnostics nao encontrada');
}

function subirApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/diagnostics', carregarRouterDiagnostics());
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function token(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

async function getDiagnostics(port, auth) {
  const headers = {};
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`http://127.0.0.1:${port}/admin/diagnostics`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('GET /admin/diagnostics exige verifyToken e isSuperAdmin antes do handler', () => {
  const router = carregarRouterDiagnostics();
  const route = acharRoute(router);
  const handles = route.stack.map((layer) => layer.handle);

  assert.equal(handles.length, 3, 'esperado [verifyToken, isSuperAdmin, handler]');
  assert.equal(handles[0], verifyToken);
  assert.equal(handles[1], isSuperAdmin);
});

test('GET /admin/diagnostics: sem token, motorista e admin comum nao passam; super-admin passa', async () => {
  const ctx = await subirApp();
  try {
    assert.equal((await getDiagnostics(ctx.port)).status, 401);

    const motorista = token({ uid: 'u-motorista', role: 'motorista', is_super_admin: false });
    assert.equal((await getDiagnostics(ctx.port, motorista)).status, 403);

    const adminEmpresa = token({ uid: 'u-admin', role: 'admin', is_super_admin: false });
    assert.equal((await getDiagnostics(ctx.port, adminEmpresa)).status, 403);

    const superAdmin = token({ uid: 'u-super', role: 'admin', is_super_admin: true });
    const allowed = await getDiagnostics(ctx.port, superAdmin);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body, { ok: true });
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});

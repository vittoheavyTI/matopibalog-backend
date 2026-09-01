'use strict';

// Autorização + inércia do endpoint de verifiability do ERP Hub:
//   GET /erp-hub/status
// Prova: sem token 401; com token sem permissão 403; com permissão (ou super-admin)
// 200 e resposta INERTE (mode=disabled, enabled=false, capabilities=[],
// entitlement.access=nao_implementada, display_status=em_preparacao). Nenhum write.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
delete process.env.ERP_PROVIDER_MODE; // garante default disabled

// Permissões efetivas controláveis por teste.
let permissoesEfetivas = {};

function supabaseStub() {
  function builder(tabela) {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => {
        if (tabela === 'funcionalidades') {
          return Promise.resolve({ data: { codigo: 'integracoes_erp', status_ciclo_vida: 'em_breve', ativo: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (tabela === 'usuarios') return Promise.resolve({ data: { empresa_id: 'emp-1' }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

function carregarRouterReal() {
  const originalLoad = Module._load;
  for (const p of ['../routes/erpHub', '../middlewares/tenant', '../middlewares/requirePermission']) {
    try { delete require.cache[require.resolve(p)]; } catch (_) { /* noop */ }
  }
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseStub();
    if (request === '../services/permissions/permissionResolver') {
      return { loadEffectivePermissions: async () => ({ permissions: permissoesEfetivas }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/erpHub');
  } finally {
    Module._load = originalLoad;
  }
}

function subirApp() {
  const app = express();
  app.use(express.json());
  app.use('/erp-hub', carregarRouterReal());
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function token(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
}

async function get(port, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/erp-hub/status`, { headers });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

test('GET /erp-hub/status — sem token → 401', async () => {
  const { server, port } = await subirApp();
  try {
    const r = await get(port);
    assert.equal(r.status, 401);
  } finally { server.close(); }
});

test('GET /erp-hub/status — token sem permissão → 403', async () => {
  permissoesEfetivas = {}; // sem integracoes_erp.gerenciar
  const { server, port } = await subirApp();
  try {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u1' })}` });
    assert.equal(r.status, 403);
    assert.equal(r.body.permission, 'integracoes_erp.gerenciar');
  } finally { server.close(); }
});

test('GET /erp-hub/status — com permissão → 200 inerte', async () => {
  permissoesEfetivas = { 'integracoes_erp.gerenciar': true };
  const { server, port } = await subirApp();
  try {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u1' })}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, 'disabled');
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.provider_available, false);
    assert.equal(r.body.read_only, true);
    assert.equal(r.body.production_inert, true);
    assert.deepEqual(r.body.provider_capabilities, []);
    assert.equal(r.body.display_status, 'em_preparacao');
    assert.equal(r.body.entitlement.codigo, 'integracoes_erp');
    assert.equal(r.body.entitlement.access, 'nao_implementada');
  } finally { server.close(); }
});

test('GET /erp-hub/status — super-admin passa (autoridade de plataforma)', async () => {
  permissoesEfetivas = {}; // irrelevante para super-admin
  const { server, port } = await subirApp();
  try {
    const r = await get(port, { Authorization: `Bearer ${token({ uid: 'u0', is_super_admin: true })}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.production_inert, true);
  } finally { server.close(); }
});

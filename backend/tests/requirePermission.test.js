'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// P2 — requirePermission: super-admin passa; permissão efetiva concede/nega (403).
const mwPath = require.resolve('../middlewares/requirePermission');

function carregar(effectivePermissions) {
  const originalLoad = Module._load;
  delete require.cache[mwPath];
  delete require.cache[require.resolve('../services/permissions/permissionResolver')];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return {};
      if (request === '../services/permissions/permissionResolver') {
        return { loadEffectivePermissions: async () => ({ permissions: effectivePermissions }) };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(mwPath).requirePermission;
  } finally {
    Module._load = originalLoad;
  }
}

function rodar(mw, user) {
  return new Promise((resolve) => {
    let resp = null; let passou = false;
    mw({ user }, { status(s) { return { json(b) { resp = { s, b }; resolve({ passou, resp }); } }; } },
      () => { passou = true; resolve({ passou, resp }); });
  });
}

test('super-admin passa sem checar permissão', async () => {
  const mw = carregar({});
  const { passou } = await rodar(mw('finance.operational.view'), { is_super_admin: true });
  assert.equal(passou, true);
});

test('permissão concedida → next()', async () => {
  const mw = carregar({ 'finance.operational.view': true });
  const { passou } = await rodar(mw('finance.operational.view'), { uid: 'u1', role: 'admin' });
  assert.equal(passou, true);
});

test('permissão ausente → 403', async () => {
  const mw = carregar({ 'finance.operational.view': false });
  const { passou, resp } = await rodar(mw('finance.operational.view'), { uid: 'u1', role: 'operador' });
  assert.equal(passou, false);
  assert.equal(resp.s, 403);
});

// P2 (Review 9) — matriz VIEW/MANAGE de financeiro operacional. requirePermission é a
// autoridade por-chave: quem tem só VIEW pode ler mas NÃO pode gatear MANAGE.
test('finance.operational: VIEW=true, MANAGE=false → lê, mas manage 403', async () => {
  const eff = { 'finance.operational.view': true, 'finance.operational.manage': false };
  const rView = await rodar(carregar(eff)('finance.operational.view'), { uid: 'u1', role: 'financeiro' });
  assert.equal(rView.passou, true);
  const rManage = await rodar(carregar(eff)('finance.operational.manage'), { uid: 'u1', role: 'financeiro' });
  assert.equal(rManage.passou, false);
  assert.equal(rManage.resp.s, 403);
  assert.equal(rManage.resp.b.permission, 'finance.operational.manage');
});

test('finance.operational: VIEW=true, MANAGE=true → manage liberado', async () => {
  const eff = { 'finance.operational.view': true, 'finance.operational.manage': true };
  const r = await rodar(carregar(eff)('finance.operational.manage'), { uid: 'u1', role: 'admin' });
  assert.equal(r.passou, true);
});

test('finance.operational: VIEW=false → nem lê', async () => {
  const eff = { 'finance.operational.view': false, 'finance.operational.manage': false };
  const r = await rodar(carregar(eff)('finance.operational.view'), { uid: 'u1', role: 'operador' });
  assert.equal(r.passou, false);
  assert.equal(r.resp.s, 403);
});

// P2.10 — negative admin override: role='admin' mas capability efetiva FALSE → 403.
// Prova que o middleware NÃO usa isAdmin como bypass (só super_admin + efetivo).
test('admin com drivers.manage efetivo FALSE → 403 (isAdmin não fura o V9)', async () => {
  const r = await rodar(carregar({ 'drivers.manage': false })('drivers.manage'), { uid: 'a1', role: 'admin' });
  assert.equal(r.passou, false);
  assert.equal(r.resp.s, 403);
});

// P2.10 — delegação: role='operador' com a capability efetiva TRUE → passa.
test('operador com drivers.view efetivo TRUE → next() (delegação funciona)', async () => {
  const r = await rodar(carregar({ 'drivers.view': true })('drivers.view'), { uid: 'o1', role: 'operador' });
  assert.equal(r.passou, true);
});

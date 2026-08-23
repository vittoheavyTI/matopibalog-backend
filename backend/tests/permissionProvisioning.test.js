'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// P2.9 (GAP 1) — provisionamento ESTRITO e ATÔMICO:
//  (a) ensurePermissionTemplatesForEmpresa chama a RPC atômica; falha NÃO vira sucesso;
//  (b) criarEmpresaCompleta: sucesso provisiona; FALHA compensa (delete) e retorna erro;
//  (c) repair path idempotente (2x → ok, RPC idempotente por design/pgtest);
//  (d) listTemplates (GET) permanece READ-ONLY (zero writes).

// ── (a) ensurePermissionTemplatesForEmpresa ──────────────────────────────────
test('ensure: RPC ok → {ok:true}; RPC erro → {ok:false} (sem sucesso silencioso)', async () => {
  const { ensurePermissionTemplatesForEmpresa } = require('../services/permissions/permissionProvisioning');
  const names = [];
  const okMock = { async rpc(name, args) { names.push(name); assert.equal(args.p_empresa_id, 'emp-1'); return { data: null, error: null }; } };
  assert.deepEqual(await ensurePermissionTemplatesForEmpresa(okMock, 'emp-1'), { ok: true });
  assert.deepEqual(names, ['ensure_permission_templates_for_empresa', 'ensure_operation_campaign_template_permissions_for_empresa']);

  const failMock = { async rpc() { return { data: null, error: { message: 'boom' } }; } };
  const r = await ensurePermissionTemplatesForEmpresa(failMock, 'emp-1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rpc_error');

  const noEmp = await ensurePermissionTemplatesForEmpresa(okMock, null);
  assert.equal(noEmp.ok, false);
});

test('ensure (repair): idempotente — 2x retorna ok (RPC idempotente por design)', async () => {
  let calls = 0;
  const mock = { async rpc() { calls += 1; return { data: null, error: null }; } };
  const { ensurePermissionTemplatesForEmpresa } = require('../services/permissions/permissionProvisioning');
  assert.equal((await ensurePermissionTemplatesForEmpresa(mock, 'emp-1')).ok, true);
  assert.equal((await ensurePermissionTemplatesForEmpresa(mock, 'emp-1')).ok, true);
  assert.equal(calls, 4);
});

// ── (b) criarEmpresaCompleta estrito ─────────────────────────────────────────
const servicePath = require.resolve('../services/empresaService');
function carregarService(supabaseMock) {
  const originalLoad = Module._load;
  delete require.cache[servicePath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(servicePath).criarEmpresaCompleta;
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

function supabaseMock({ rpcError = null } = {}) {
  const ops = { deleted: null, rpc: 0 };
  const api = {
    from(t) {
      const b = {
        _payload: null, _t: t,
        select() { return b; }, eq(col, val) { b._eqVal = val; return b; },
        insert(p) { b._payload = p; return b; },
        update() { return b; },
        delete() { return { eq(col, val) { if (b._t === 'empresas') ops.deleted = val; return Promise.resolve({ data: null, error: null }); } }; },
        async maybeSingle() { return { data: null, error: null }; },
        async single() { return { data: { id: 'nova-empresa', nome: b._payload?.nome, codigo_convite: b._payload?.codigo_convite }, error: null }; },
      };
      return b;
    },
    async rpc() { ops.rpc += 1; return { data: null, error: rpcError }; },
  };
  api._ops = ops;
  return api;
}

test('NEW_COMPANY_SUCCESS: provisiona templates (RPC) e retorna empresa sem erro', async () => {
  const sb = supabaseMock({ rpcError: null });
  const criar = carregarService(sb);
  const r = await criar({ nome: 'Empresa Nova', cnpj: '11444777000161' });
  assert.equal(r.error, null);
  assert.ok(r.empresa && r.empresa.id === 'nova-empresa');
  assert.equal(sb._ops.rpc, 2, 'provisionou baseline + complemento Campaign via RPC');
  assert.equal(sb._ops.deleted, null, 'não compensou');
});

test('NEW_COMPANY_TEMPLATE_PROVISIONING_FAILURE: NÃO retorna sucesso; compensa (delete) + erro 500', async () => {
  const sb = supabaseMock({ rpcError: { message: 'ensure falhou' } });
  const criar = carregarService(sb);
  const r = await criar({ nome: 'Empresa X', cnpj: '12345678909' });
  assert.equal(r.empresa, null, 'não retorna empresa em sucesso falso');
  assert.equal(r.status, 500);
  assert.ok(/provisionamento/i.test(r.error));
  assert.equal(sb._ops.deleted, 'nova-empresa', 'compensou removendo a empresa recém-criada');
});

// ── (d) listTemplates write-free ─────────────────────────────────────────────
function carregarController(templatesExistentes) {
  const controllerPath = require.resolve('../controllers/permissionsController');
  const writes = [];
  const sb = {
    from(tabela) {
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; },
        upsert() { writes.push(`upsert:${tabela}`); return b; },
        insert() { writes.push(`insert:${tabela}`); return b; },
        update() { writes.push(`update:${tabela}`); return b; },
        delete() { writes.push(`delete:${tabela}`); return b; },
        then(resolve) {
          if (tabela === 'permission_templates') return resolve({ data: templatesExistentes, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
    rpc(name) { writes.push(`rpc:${name}`); return { async then(r) { r({ data: null, error: null }); } }; },
  };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return sb;
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), writes };
  } finally {
    Module._load = originalLoad;
  }
}

async function chamarList(controller) {
  let resp = null;
  await controller.listTemplates({ empresa_id: 'emp-1' }, { status(s) { return { json(b) { resp = { s, b }; } }; } });
  return resp;
}

test('listTemplates: empresa SEM templates → 200 vazio, ZERO escritas (sem write-on-read)', async () => {
  const { controller, writes } = carregarController([]);
  const resp = await chamarList(controller);
  assert.equal(resp.s, 200);
  assert.deepEqual(resp.b.templates, []);
  assert.deepEqual(writes, []);
});

test('listTemplates: empresa COM templates → 200 com dados, ZERO escritas', async () => {
  const { controller, writes } = carregarController([{ id: 't1', stable_key: 'administrador', display_name: 'Administrador', editable: true }]);
  const resp = await chamarList(controller);
  assert.equal(resp.s, 200);
  assert.equal(resp.b.templates.length, 1);
  assert.deepEqual(writes, []);
});

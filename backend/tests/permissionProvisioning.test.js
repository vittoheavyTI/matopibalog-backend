'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// P2 (Review 2.2) — provisionamento de templates:
//  (a) provisionTemplatesForEmpresa semeia 9 templates baseline + permissões (novo tenant);
//  (b) listTemplates (GET) é READ-ONLY: NUNCA escreve (sem write-on-read).

// ── (a) provisionTemplatesForEmpresa ─────────────────────────────────────────
test('provisionTemplatesForEmpresa: upsert dos 9 templates + permissões (write só na criação)', async () => {
  const ops = [];
  const supabaseMock = {
    from(tabela) {
      const b = {
        _tabela: tabela,
        upsert(payload) { ops.push({ op: 'upsert', tabela, payload }); return { async then(r) { r({ data: null, error: null }); } }; },
        select() { return b; },
        eq() { return b; },
        async maybeSingle() {
          // devolve um id estável por (empresa,stable_key) para o passo de permissões
          return { data: { id: `tpl-${tabela}` }, error: null };
        },
      };
      return b;
    },
  };
  const { provisionTemplatesForEmpresa } = require('../services/permissions/permissionProvisioning');
  const r = await provisionTemplatesForEmpresa(supabaseMock, 'emp-1');
  assert.equal(r.ok, true);

  const tplUpserts = ops.filter((o) => o.tabela === 'permission_templates');
  const stableKeys = tplUpserts.map((o) => o.payload.stable_key).sort();
  assert.deepEqual(stableKeys, [
    'administrador', 'embarcador', 'financeiro', 'gerente_filial', 'gerente_frota',
    'gerente_nacional', 'gerente_regional', 'motorista', 'operador',
  ]);
  // permissões baseline também são semeadas
  const permUpserts = ops.filter((o) => o.tabela === 'permission_template_permissions');
  assert.ok(permUpserts.length >= 1, 'semeia permissões dos templates');
  // template motorista carrega a visibility policy default
  const moto = tplUpserts.find((o) => o.payload.stable_key === 'motorista');
  assert.equal(moto.payload.driver_financial_visibility_mode, 'commission_only');
});

// ── (b) listTemplates é write-free ───────────────────────────────────────────
function carregarController(templatesExistentes) {
  const controllerPath = require.resolve('../controllers/permissionsController');
  const writes = [];
  const supabaseMock = {
    from(tabela) {
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; },
        // qualquer método de ESCRITA registra e falha o contrato de leitura
        upsert() { writes.push(`upsert:${tabela}`); return b; },
        insert() { writes.push(`insert:${tabela}`); return b; },
        update() { writes.push(`update:${tabela}`); return b; },
        delete() { writes.push(`delete:${tabela}`); return b; },
        rpc() { writes.push(`rpc:${tabela}`); return b; },
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
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), writes };
  } finally {
    Module._load = originalLoad;
  }
}

async function chamarList(controller) {
  let resp = null;
  await controller.listTemplates(
    { empresa_id: 'emp-1' },
    { status(s) { return { json(b) { resp = { s, b }; } }; } }
  );
  return resp;
}

test('listTemplates: empresa SEM templates → 200 lista vazia, ZERO escritas (sem write-on-read)', async () => {
  const { controller, writes } = carregarController([]);
  const resp = await chamarList(controller);
  assert.equal(resp.s, 200);
  assert.deepEqual(resp.b.templates, []);
  assert.deepEqual(writes, [], 'GET não pode provisionar/escrever');
});

test('listTemplates: empresa COM templates → 200 com dados, ZERO escritas', async () => {
  const { controller, writes } = carregarController([
    { id: 't1', stable_key: 'administrador', display_name: 'Administrador', editable: true },
  ]);
  const resp = await chamarList(controller);
  assert.equal(resp.s, 200);
  assert.equal(resp.b.templates.length, 1);
  assert.deepEqual(writes, []);
});

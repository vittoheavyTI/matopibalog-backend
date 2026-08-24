'use strict';

// Intercepta config/supabase ANTES de carregar as tools, devolvendo um stub — assim
// createClient real NÃO roda (evita "Node 20 sem WebSocket" no CI e não conecta a
// nada). As tools recebem o supabase via ctx; o client real nunca é usado aqui.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../config/supabase' || request === '../../config/supabase' || /[\\/]config[\\/]supabase$/.test(request)) {
    return { from: () => { throw new Error('stub supabase (não deve ser usado)'); } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/ai/toolRegistry');
const { registerAllTools } = require('../services/ai/tools');

Module._load = originalLoad; // restaura após carregar os módulos

registry.clear();
registerAllTools();

function ctx(overrides = {}) {
  return {
    supabase: {},
    empresaId: 'empresa-A',
    user: { uid: 'u1' },
    isSuperAdmin: false,
    effectivePermissions: {},
    operationalScope: null,
    ...overrides,
  };
}

test('tools reais registradas com permissão canônica', () => {
  const names = registry.listTools().map((t) => t.name).sort();
  assert.deepEqual(names, ['commercial.current_plan.summary', 'fleet.current.summary', 'operation.campaign.progress', 'operation.command_center.summary', 'operation.dispatch.status', 'operation.freights.attention', 'route.estimate']);
  assert.equal(registry.getTool('fleet.current.summary').requiredPermission, 'fleet.view');
  assert.equal(registry.getTool('operation.freights.attention').requiredPermission, 'freight.view');
  assert.equal(registry.getTool('commercial.current_plan.summary').requiredPermission, 'company.settings.view');
  assert.equal(registry.getTool('operation.campaign.progress').requiredPermission, 'campaign.view');
  assert.equal(registry.getTool('operation.campaign.progress').requiredEntitlement, 'operation_campaign');
  assert.equal(registry.getTool('operation.dispatch.status').requiredPermission, 'campaign.view');
  assert.equal(registry.getTool('operation.dispatch.status').requiredEntitlement, 'operation_campaign');
});

test('sem permissão → negado (handler nem roda, DB intocado)', async () => {
  for (const name of ['fleet.current.summary', 'operation.freights.attention', 'commercial.current_plan.summary']) {
    const r = await registry.executeTool(name, {}, ctx());
    assert.equal(r.ok, false, `${name} deveria negar`);
    assert.equal(r.error, 'permission_denied');
  }
});

test('commercial.current_plan.summary: com permissão usa tenant do servidor', async () => {
  let empresaConsultada = null;
  const supabase = {
    from(tabela) {
      const api = {
        select() { return api; },
        eq(col, val) { if (tabela === 'empresas' && col === 'id') empresaConsultada = val; return api; },
        in() { return api; },
        maybeSingle: async () => ({ data: { plano_id: 'p1', planos: { nome: 'Empresa Start', limite_motoristas: null } }, error: null }),
      };
      return api;
    },
  };
  const r = await registry.executeTool(
    'commercial.current_plan.summary',
    { empresa_id: 'empresa-B' }, // injeção ignorada
    ctx({ supabase, effectivePermissions: { 'company.settings.view': true } }),
  );
  assert.equal(r.ok, true);
  assert.equal(empresaConsultada, 'empresa-A');
  assert.equal(r.data.plano, 'Empresa Start');
  assert.equal(r.data.ilimitado, true);
});

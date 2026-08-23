'use strict';

// Env dummy p/ permitir carregar módulos que importam config/supabase (o client
// real nunca é usado — passamos um stub em ctx.supabase).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/ai/toolRegistry');
const { registerAllTools } = require('../services/ai/tools');

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
  assert.deepEqual(names, ['commercial.current_plan.summary', 'fleet.current.summary', 'operation.freights.attention']);
  assert.equal(registry.getTool('fleet.current.summary').requiredPermission, 'fleet.view');
  assert.equal(registry.getTool('operation.freights.attention').requiredPermission, 'freight.view');
  assert.equal(registry.getTool('commercial.current_plan.summary').requiredPermission, 'company.settings.view');
});

test('sem permissão → negado (handler nem roda, DB intocado)', async () => {
  for (const name of ['fleet.current.summary', 'operation.freights.attention', 'commercial.current_plan.summary']) {
    const r = await registry.executeTool(name, {}, ctx()); // effectivePermissions vazio
    assert.equal(r.ok, false, `${name} deveria negar`);
    assert.equal(r.error, 'permission_denied');
  }
});

test('commercial.current_plan.summary: com permissão usa tenant do servidor', async () => {
  let empresaConsultada = null;
  // Stub supabase mínimo: empresas → plano ilimitado (limite null evita count).
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
  assert.equal(empresaConsultada, 'empresa-A'); // tenant do servidor, não o arg
  assert.equal(r.data.plano, 'Empresa Start');
  assert.equal(r.data.ilimitado, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/ai/toolRegistry');

function ctx(overrides = {}) {
  return {
    supabase: { from: () => { throw new Error('no db in this test'); } },
    empresaId: 'empresa-A',
    user: { uid: 'u1' },
    isSuperAdmin: false,
    effectivePermissions: { 'freight.view': true },
    operationalScope: null,
    ...overrides,
  };
}

test('tool desconhecida é negada (allowlist)', async () => {
  registry.clear();
  const r = await registry.executeTool('nao.existe', {}, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_tool');
});

test('permissão insuficiente é negada', async () => {
  registry.clear();
  registry.registerTool({ name: 't.perm', requiredPermission: 'fleet.view', handler: async () => ({ ok: true, data: {} }) });
  const r = await registry.executeTool('t.perm', {}, ctx()); // só tem freight.view
  assert.equal(r.ok, false);
  assert.equal(r.error, 'permission_denied');
});

test('super-admin passa a permissão', async () => {
  registry.clear();
  registry.registerTool({ name: 't.perm', requiredPermission: 'fleet.view', handler: async () => ({ ok: true, data: { x: 1 } }) });
  const r = await registry.executeTool('t.perm', {}, ctx({ isSuperAdmin: true }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { x: 1 });
});

test('entitlement negado', async () => {
  registry.clear();
  registry.registerTool({ name: 't.ent', requiredPermission: 'freight.view', requiredEntitlement: 'fleet_module', handler: async () => ({ ok: true, data: {} }) });
  const r = await registry.executeTool('t.ent', {}, ctx({ hasEntitlement: () => false }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'entitlement_denied');
});

test('timeout de tool é tratado', async () => {
  registry.clear();
  registry.registerTool({ name: 't.slow', requiredPermission: 'freight.view', timeoutMs: 30, handler: () => new Promise((r) => setTimeout(() => r({ ok: true, data: {} }), 200)) });
  const r = await registry.executeTool('t.slow', {}, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'tool_timeout');
});

test('exceção da tool não vaza stack', async () => {
  registry.clear();
  registry.registerTool({ name: 't.boom', requiredPermission: 'freight.view', handler: async () => { throw new Error('SELECT * falhou: senha=123'); } });
  const r = await registry.executeTool('t.boom', {}, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'tool_error');
  assert.ok(!JSON.stringify(r).includes('senha=123'));
});

test('sanitização remove campos sensíveis e URLs assinadas', async () => {
  registry.clear();
  registry.registerTool({ name: 't.sens', requiredPermission: 'freight.view', handler: async () => ({
    ok: true,
    data: { api_key: 'sk-123', nome: 'Frete 1', signed_url: 'https://x/o?token=abc&X-Amz-Signature=zz', nested: { authorization: 'Bearer y' } },
  }) });
  const r = await registry.executeTool('t.sens', {}, ctx());
  assert.equal(r.data.api_key, '[redacted]');
  assert.equal(r.data.nested.authorization, '[redacted]');
  assert.equal(r.data.signed_url, '[redacted]');
  assert.equal(r.data.nome, 'Frete 1');
});

test('tenant vem do ctx do servidor (handler recebe empresaId autêntico)', async () => {
  registry.clear();
  let visto = null;
  registry.registerTool({ name: 't.tenant', requiredPermission: 'freight.view', handler: async (c, args) => { visto = { empresaId: c.empresaId, argEmpresa: args.empresa_id }; return { ok: true, data: { empresaId: c.empresaId } }; } });
  // Modelo tenta injetar empresa_id de outro tenant nos args:
  const r = await registry.executeTool('t.tenant', { empresa_id: 'empresa-B' }, ctx());
  assert.equal(r.data.empresaId, 'empresa-A'); // sempre o do servidor
  assert.equal(visto.empresaId, 'empresa-A');
});

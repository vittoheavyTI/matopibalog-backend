'use strict';

// Stub config/supabase antes de carregar as tools (evita createClient/Node20 no CI).
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/[\\/]config[\\/]supabase$/.test(request) || request === '../config/supabase' || request === '../../config/supabase') {
    return { from: () => { throw new Error('stub'); } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/ai/toolRegistry');
const { registerAllTools } = require('../services/ai/tools');

Module._load = originalLoad;
registry.clear();
registerAllTools();

const ctx = (over = {}) => ({ supabase: {}, empresaId: 'e1', user: { uid: 'u1' }, isSuperAdmin: false, effectivePermissions: {}, ...over });

test('route.estimate registrada com permissão freight.view', () => {
  const t = registry.getTool('route.estimate');
  assert.ok(t);
  assert.equal(t.requiredPermission, 'freight.view');
});

test('sem permissão → negado', async () => {
  const r = await registry.executeTool('route.estimate', { origin: 'A', destination: 'B' }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'permission_denied');
});

test('com permissão + fake: estimativa determinística sem PII', async () => {
  const prev = process.env.ROUTE_PROVIDER_MODE;
  process.env.ROUTE_PROVIDER_MODE = 'fake';
  try {
    const r = await registry.executeTool('route.estimate', { origin: 'A', destination: 'B' }, ctx({ effectivePermissions: { 'freight.view': true } }));
    assert.equal(r.ok, true);
    assert.equal(r.data.route_source, 'PROVIDER');
    assert.ok(r.data.distance_km > 0);
    assert.equal(r.data.tolls_amount, null);
  } finally {
    process.env.ROUTE_PROVIDER_MODE = prev;
  }
});

test('com permissão + disabled: UNAVAILABLE (não zero)', async () => {
  const prev = process.env.ROUTE_PROVIDER_MODE;
  process.env.ROUTE_PROVIDER_MODE = 'disabled';
  try {
    const r = await registry.executeTool('route.estimate', { origin: 'A', destination: 'B' }, ctx({ effectivePermissions: { 'freight.view': true } }));
    assert.equal(r.ok, true);
    assert.equal(r.data.availability, 'UNAVAILABLE');
    assert.equal(r.data.distance_km, null);
  } finally {
    process.env.ROUTE_PROVIDER_MODE = prev;
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
  CampaignError,
  buildResourceCandidates,
  createCampaign,
  planCampaign,
  toKg,
  fromKg,
} = require('../services/campaign/campaignService');
const { PERMISSION_BY_KEY, templateBaselineMap } = require('../services/permissions/permissionRegistry');
const { computeEffectivePermissions, hasPermission } = require('../services/permissions/permissionResolver');

test('campaign permissions require operation_campaign entitlement before template or override', () => {
  for (const key of ['campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve', 'campaign.manage']) {
    assert.equal(PERMISSION_BY_KEY[key].scoped, true);
    assert.equal(PERMISSION_BY_KEY[key].entitlementCodigo, 'operation_campaign');
  }

  const denied = computeEffectivePermissions({
    user: { tipo: 'admin' },
    template: { permissions: { 'campaign.manage': true } },
    overrides: { 'campaign.view': 'allow' },
    entitlements: { operation_campaign: false },
  });
  assert.equal(hasPermission(denied, 'campaign.view'), false);
  assert.equal(hasPermission(denied, 'campaign.manage'), false);
  assert.equal(denied.source['campaign.view'], 'entitlement_denied');

  const allowed = computeEffectivePermissions({
    user: { tipo: 'admin' },
    template: { permissions: templateBaselineMap('administrador') },
    entitlements: { operation_campaign: true },
  });
  assert.equal(hasPermission(allowed, 'campaign.view'), true);
  assert.equal(hasPermission(allowed, 'campaign.manage'), true);
});

test('campaign planner is deterministic, capacity-based and never models freight writes', () => {
  const campaign = { id: 'camp-1' };
  const locations = [
    { id: 'origin-2', kind: 'origin', priority: 20 },
    { id: 'origin-1', kind: 'origin', priority: 10 },
    { id: 'dest-1', kind: 'destination', priority: 10 },
  ];
  const demands = [
    { id: 'demand-b', origin_location_id: 'origin-2', destination_location_id: 'dest-1', target_quantity: 15, quantity_unit: 'ton' },
    { id: 'demand-a', origin_location_id: 'origin-1', destination_location_id: 'dest-1', target_quantity: 20, quantity_unit: 'ton' },
  ];
  const resources = [
    { type: 'asset', id: 'asset-2', asset_id: 'asset-2', composition_id: null, driver_id: 'driver-2', capacity_kg: 10000, warnings: [] },
    { type: 'composition', id: 'comp-1', asset_id: null, composition_id: 'comp-1', driver_id: 'driver-1', capacity_kg: 18000, warnings: [] },
  ];

  const first = planCampaign({ campaign, locations, demands, resources });
  const second = planCampaign({ campaign, locations, demands, resources });
  assert.deepEqual(first, second);
  assert.equal(first.summary.total_required_capacity_kg, 35000);
  assert.equal(first.plannedTrips[0].demand_id, 'demand-a');
  assert.equal(first.plannedTrips.every((trip) => !Object.prototype.hasOwnProperty.call(trip, 'frete_id')), true);
});

test('campaign resource candidates prefer compositions with explicit capacity and keep warnings objective', () => {
  const candidates = buildResourceCandidates({
    assets: [
      { id: 'asset-1', status: 'active', useful_capacity_kg: 12000, unidade_operacional_id: 'unit-a' },
      { id: 'asset-2', status: 'inactive', useful_capacity_kg: 30000, unidade_operacional_id: 'unit-a' },
    ],
    compositions: [
      { id: 'comp-1', status: 'active', metadata: { usable_capacity_kg: 25000 }, unidade_operacional_id: 'unit-a' },
    ],
    assignments: [
      { driver_id: 'driver-1', asset_id: 'asset-1', assignment_status: 'active', valid_until: null },
    ],
    maintenance: [
      { composition_id: 'comp-1', status: 'open' },
    ],
    unitIds: ['unit-a'],
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].type, 'composition');
  assert.equal(candidates[0].capacity_kg, 25000);
  assert.deepEqual(candidates[0].warnings.sort(), ['MAINTENANCE_CONFLICT', 'NO_DRIVER'].sort());
});

test('campaign create rejects operational units outside scope before database write', async () => {
  const supabase = {
    from() {
      throw new Error('database should not be touched after scope denial');
    },
  };

  await assert.rejects(
    () => createCampaign(supabase, {
      empresaId: 'empresa-1',
      user: { uid: 'user-1' },
      operationalScope: {
        mode: 'LIMITED',
        allowed_unit_ids: ['unit-a'],
        has_operational_structure: true,
        include_legacy_unscoped: false,
      },
      body: {
        reference_code: 'SAFRA-1',
        name: 'Safra 1',
        cargo_name: 'Soja',
        operational_unit_ids: ['unit-b'],
      },
    }),
    (err) => err instanceof CampaignError && err.code === 'operational_unit_forbidden',
  );
});

test('campaign quantity conversion is stable for ton and kg', () => {
  assert.equal(toKg(12.5, 'ton'), 12500);
  assert.equal(toKg(12.5, 'kg'), 12.5);
  assert.equal(fromKg(12500, 'ton'), 12.5);
});

test('migration 076 is additive and does not map campaign commercially or touch fretes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '076_operation_campaign_foundation.sql'), 'utf8');
  for (const table of [
    'operation_campaigns',
    'campaign_operational_units',
    'campaign_locations',
    'campaign_demands',
    'campaign_plan_versions',
    'campaign_plan_scenarios',
    'campaign_planned_trips',
    'campaign_approvals',
    'campaign_exceptions',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${table} TO authenticated`));
  }
  assert.match(sql, /'operation_campaign'/);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.plano_funcionalidades\b/i);
  assert.doesNotMatch(sql, /\b(ALTER|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(TABLE\s+)?public\.fretes\b/i);
});

test('campaign router is protected by auth, tenant, plan and effective permissions', () => {
  const routePath = require.resolve('../routes/operationCampaigns');
  const originalLoad = Module._load;
  const calls = [];
  const router = {
    use: (...args) => calls.push(['use', ...args]),
    get: (...args) => calls.push(['get', ...args]),
    post: (...args) => calls.push(['post', ...args]),
    put: (...args) => calls.push(['put', ...args]),
    patch: (...args) => calls.push(['patch', ...args]),
  };

  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '../middlewares/auth') return { verifyToken: 'verifyToken' };
    if (request === '../middlewares/tenant') return { verificarEmpresa: 'verificarEmpresa' };
    if (request === '../middlewares/verificarPlano') return { verificarPlano: 'verificarPlano' };
    if (request === '../middlewares/requirePermission') return { ensureEffective: async () => ({ permissions: {}, source: {} }) };
    if (request === '../services/operationalScopeService') {
      return { resolverEscopoOperacional: async () => ({ mode: 'LEGACY_COMPANY' }), escopoTemSelecaoInvalida: () => false };
    }
    if (request === '../controllers/campaignController') {
      return {
        listarCampanhas: 'listarCampanhas',
        criarCampanha: 'criarCampanha',
        substituirLocais: 'substituirLocais',
        substituirDemandas: 'substituirDemandas',
        gerarPlano: 'gerarPlano',
        obterPlano: 'obterPlano',
        aprovarPlano: 'aprovarPlano',
        rejeitarPlano: 'rejeitarPlano',
        cancelarCampanha: 'cancelarCampanha',
        verificarPlano: 'verificarPlano',
      };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[routePath];
  try {
    require(routePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }

  assert.deepEqual(calls[0].slice(0, 5), ['use', 'verifyToken', 'verificarEmpresa', 'verificarPlano', calls[0][4]]);
  assert.ok(calls.some((call) => call[0] === 'post' && call[1] === '/:campaignId/plans' && call.length >= 4));
  assert.ok(calls.some((call) => call[0] === 'post' && call[1] === '/:campaignId/plans/:planId/approve' && call.length >= 4));
});

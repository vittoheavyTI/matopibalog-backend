'use strict';

// Intercepta config/supabase (stub) antes de carregar as tools (evita createClient
// real). O supabase real nunca é usado (passamos ctx.supabase).
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

function makeSupabase(dataPorTabela) {
  function builder(tabela) {
    const rows = () => (dataPorTabela[tabela] || []);
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      order() { return b; }, limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { resolve({ data: rows(), error: null }); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const EMP = 'e1';
const SCOPE = { mode: 'LEGACY_COMPANY' };

function fullData() {
  return {
    operation_campaigns: [{ id: 'c1', empresa_id: EMP, reference_code: 'CMP-1', name: 'Safra', cargo_name: 'Soja', status: 'APPROVED', planning_status: 'APPROVED', approved_plan_version_id: 'p1' }],
    campaign_operational_units: [],
    campaign_plan_versions: [{ id: 'p1', version_number: 1, status: 'APPROVED', approved_at: '2026-08-24T00:00:00Z' }],
    campaign_planned_trips: [{ id: 't1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', status: 'PLANNED', planned_quantity: 10, quantity_unit: 'ton', required_capacity_kg: 10000, origin_location_id: 'o', destination_location_id: 'd', candidate_driver_id: 'd1', candidate_asset_id: 'a1' }],
    campaign_trip_freights: [{ id: 'l1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', planned_trip_id: 't1', frete_id: 'f1', materialization_status: 'MATERIALIZED' }],
    campaign_demands: [{ target_quantity: 10, quantity_unit: 'ton' }],
    campaign_locations: [{ id: 'o', name: 'Fazenda' }, { id: 'd', name: 'Porto' }],
    fretes: [{ id: 'f1', status: 'finalizado' }],
    usuarios: [{ id: 'd1', empresa_id: EMP, status: 'ativo' }],
    fleet_assets: [{ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000, metadata: {} }],
    vehicle_compositions: [],
    driver_vehicle_assignments: [{ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', assignment_status: 'active', valid_until: null }],
    asset_documents: [],
    maintenance_events: [],
  };
}

function ctx(over = {}) {
  return {
    supabase: makeSupabase(fullData()),
    empresaId: EMP, user: { uid: 'u1' }, isSuperAdmin: false,
    effectivePermissions: {}, operationalScope: SCOPE, ...over,
  };
}

test('tool registrada com campaign.view + entitlement operation_campaign', () => {
  const t = registry.getTool('operation.campaign.progress');
  assert.ok(t);
  assert.equal(t.requiredPermission, 'campaign.view');
  assert.equal(t.requiredEntitlement, 'operation_campaign');
});

test('sem permissão → negado (handler não roda)', async () => {
  const r = await registry.executeTool('operation.campaign.progress', {}, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'permission_denied');
});

test('com permissão, sem id/ref → lista campanhas para escolher', async () => {
  const r = await registry.executeTool('operation.campaign.progress', {}, ctx({ effectivePermissions: { 'campaign.view': true } }));
  assert.equal(r.ok, true);
  assert.equal(r.data.needs_selection, true);
  assert.equal(r.data.campaigns[0].reference_code, 'CMP-1');
});

test('com ref → progresso derivado, sem PII, sem valores financeiros', async () => {
  const r = await registry.executeTool('operation.campaign.progress', { campaign_reference_code: 'CMP-1' }, ctx({ effectivePermissions: { 'campaign.view': true } }));
  assert.equal(r.ok, true);
  assert.equal(r.data.campaign.reference_code, 'CMP-1');
  assert.equal(r.data.trips.completed, 1);
  assert.equal(r.data.health.state, 'COMPLETED');
  assert.equal(r.data.quantity.quantity_source, 'PLANNED_FREIGHT_QUANTITY');
  // Sem candidate_driver_id / motorista / valor no payload.
  const json = JSON.stringify(r.data);
  assert.ok(!json.includes('candidate_driver_id'));
  assert.ok(!json.includes('valor_frete'));
});

test('evidência presente e sem write', async () => {
  const r = await registry.executeTool('operation.campaign.progress', { campaign_reference_code: 'CMP-1' }, ctx({ effectivePermissions: { 'campaign.view': true } }));
  assert.ok(Array.isArray(r.evidence) && r.evidence.length >= 1);
  assert.equal(r.evidence[0].entity_type, 'campaign');
});

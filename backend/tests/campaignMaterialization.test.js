'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildFreightBodyFromTrip,
  deterministicUuid,
  materializePlan,
  previewMaterialization,
  quantityToTon,
} = require('../services/campaign/campaignMaterializationService');

function createSupabaseMock(seed) {
  const calls = [];
  const tables = Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, [...value]]));

  function applyFilters(table, filters, inFilters) {
    return (tables[table] || []).filter((row) => {
      for (const [field, value] of filters) {
        if (row[field] !== value) return false;
      }
      for (const [field, values] of inFilters) {
        if (!values.includes(row[field])) return false;
      }
      return true;
    });
  }

  return {
    calls,
    from(table) {
      const state = { table, filters: [], inFilters: [], insertPayload: null, singleMode: false };
      const builder = {
        select() { return this; },
        eq(field, value) { state.filters.push([field, value]); return this; },
        in(field, values) { state.inFilters.push([field, values]); return this; },
        order() { return this; },
        insert(payload) { state.insertPayload = payload; return this; },
        maybeSingle() {
          const rows = applyFilters(state.table, state.filters, state.inFilters);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        single() {
          if (state.insertPayload) {
            const row = Array.isArray(state.insertPayload) ? state.insertPayload[0] : state.insertPayload;
            tables[state.table] = tables[state.table] || [];
            tables[state.table].push(row);
            calls.push(['insert', state.table, row]);
            return Promise.resolve({ data: row, error: null });
          }
          const rows = applyFilters(state.table, state.filters, state.inFilters);
          return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { code: 'PGRST116', message: 'not found' } });
        },
        then(resolve) {
          resolve({ data: applyFilters(state.table, state.filters, state.inFilters), error: null });
        },
      };
      return builder;
    },
  };
}

const operationalScope = {
  mode: 'LIMITED',
  allowed_unit_ids: ['unit-a'],
  has_operational_structure: true,
};

const baseSeed = {
  operation_campaigns: [{ id: 'camp-1', empresa_id: 'emp-1', status: 'APPROVED', approved_plan_version_id: 'plan-1' }],
  campaign_operational_units: [{ campaign_id: 'camp-1', empresa_id: 'emp-1', unidade_operacional_id: 'unit-a' }],
  campaign_plan_versions: [{ id: 'plan-1', campaign_id: 'camp-1', empresa_id: 'emp-1', status: 'APPROVED' }],
  campaign_locations: [
    { id: 'origin-1', campaign_id: 'camp-1', empresa_id: 'emp-1', name: 'Fazenda A' },
    { id: 'dest-1', campaign_id: 'camp-1', empresa_id: 'emp-1', name: 'Armazem B' },
  ],
  campaign_trip_freights: [{ planned_trip_id: 'trip-existing', plan_version_id: 'plan-1', empresa_id: 'emp-1', frete_id: 'frete-existing' }],
  campaign_planned_trips: [
    { id: 'trip-ready', empresa_id: 'emp-1', campaign_id: 'camp-1', plan_version_id: 'plan-1', origin_location_id: 'origin-1', destination_location_id: 'dest-1', planned_quantity: 20, quantity_unit: 'ton', candidate_driver_id: 'driver-1', candidate_asset_id: 'asset-1', candidate_composition_id: null, status: 'PLANNED' },
    { id: 'trip-existing', empresa_id: 'emp-1', campaign_id: 'camp-1', plan_version_id: 'plan-1', origin_location_id: 'origin-1', destination_location_id: 'dest-1', planned_quantity: 10, quantity_unit: 'ton', candidate_driver_id: 'driver-1', candidate_asset_id: 'asset-1', candidate_composition_id: null, status: 'PLANNED' },
    { id: 'trip-no-driver', empresa_id: 'emp-1', campaign_id: 'camp-1', plan_version_id: 'plan-1', origin_location_id: 'origin-1', destination_location_id: 'dest-1', planned_quantity: 10, quantity_unit: 'ton', candidate_driver_id: null, candidate_asset_id: 'asset-1', candidate_composition_id: null, status: 'PLANNED' },
    { id: 'trip-stale', empresa_id: 'emp-1', campaign_id: 'camp-1', plan_version_id: 'plan-1', origin_location_id: 'origin-1', destination_location_id: 'dest-1', planned_quantity: 10, quantity_unit: 'ton', candidate_driver_id: 'driver-2', candidate_asset_id: 'asset-1', candidate_composition_id: null, status: 'PLANNED' },
  ],
  usuarios: [
    { id: 'driver-1', empresa_id: 'emp-1', status: 'ativo' },
    { id: 'driver-2', empresa_id: 'emp-1', status: 'ativo' },
  ],
  fleet_assets: [{ id: 'asset-1', empresa_id: 'emp-1', status: 'active', unidade_operacional_id: 'unit-a' }],
  vehicle_compositions: [],
  driver_vehicle_assignments: [{ empresa_id: 'emp-1', driver_id: 'driver-1', asset_id: 'asset-1', composition_id: null, assignment_status: 'active', valid_until: null }],
};

test('Campaign-B preview classifies ready, existing and blocked planned trips', async () => {
  const supabase = createSupabaseMock(baseSeed);
  const result = await previewMaterialization(supabase, {
    empresaId: 'emp-1',
    campaignId: 'camp-1',
    planId: 'plan-1',
    operationalScope,
  });

  assert.equal(result.summary.requested, 4);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.already_materialized, 1);
  assert.equal(result.summary.blocked, 2);
  assert.equal(result.items.find((item) => item.planned_trip_id === 'trip-ready').deterministic_frete_id, deterministicUuid('campaign-materialization:trip-ready'));
  assert.equal(result.items.find((item) => item.planned_trip_id === 'trip-no-driver').reason, 'DRIVER_REQUIRED');
  assert.equal(result.items.find((item) => item.planned_trip_id === 'trip-stale').reason, 'STALE_DRIVER_RESOURCE_ASSIGNMENT');
});

test('Campaign-B materialization requires freight pricing before any write', async () => {
  const supabase = createSupabaseMock(baseSeed);
  await assert.rejects(
    () => materializePlan(supabase, {
      empresaId: 'emp-1',
      campaignId: 'camp-1',
      planId: 'plan-1',
      user: { uid: 'user-1' },
      operationalScope,
      body: { modalidade_calculo: 'valor_fixo' },
    }),
    (err) => err.code === 'materialization_freight_pricing_required',
  );
  assert.deepEqual(supabase.calls, []);
});

test('Campaign-B freight instruction derives canonical freight create body', () => {
  const body = buildFreightBodyFromTrip({
    origem: 'Fazenda A',
    destino: 'Armazem B',
    motorista_id: 'driver-1',
    unidade_operacional_id: 'unit-a',
    planned_quantity: 25000,
    quantity_unit: 'kg',
  }, { modalidade_calculo: 'tonelada_km', valor_tonelada_km: 0.2 });

  assert.equal(body.origem, 'Fazenda A');
  assert.equal(body.destino, 'Armazem B');
  assert.equal(body.motorista_id, 'driver-1');
  assert.equal(body.toneladas, 25);
  assert.equal(body.valor_tonelada_km, 0.2);
  assert.equal(body.odometro_obrigatorio, true);
  assert.equal(quantityToTon(12, 'ton'), 12);
});

test('migration 078 adds only Campaign-Freight linkage and does not alter fretes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '078_operation_campaign_materialization.sql'), 'utf8');

  assert.match(sql, /OWNER_MIGRATION_GATE_CAMPAIGN_078/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.campaign_trip_freights/);
  assert.match(sql, /campaign_trip_freights_trip_key/);
  assert.match(sql, /campaign_trip_freights_frete_key/);
  assert.match(sql, /FOREIGN KEY \(planned_trip_id, plan_version_id, campaign_id, empresa_id\)/);
  assert.match(sql, /FOREIGN KEY \(frete_id, empresa_id\)/);
  assert.match(sql, /ALTER TABLE public\.campaign_trip_freights ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /rls_is_super_admin\(\) OR \(rls_is_company_admin\(\) AND empresa_id = rls_empresa_id\(\)\)/);
  assert.doesNotMatch(sql, /ALTER TABLE\s+public\.fretes/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bauth\.role\s*\(/i);
});

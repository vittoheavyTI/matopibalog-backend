'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCampaignProgress,
  toTon,
  deriveHealth,
  deriveReplan,
  deriveWindow,
} = require('../services/campaign/campaignProgressService');

// Stub encadeável de supabase: dados fixos por tabela. Suporta maybeSingle/single
// (retorna o primeiro registro) e is()/in()/eq() como no-ops de filtro.
function makeSupabase(dataPorTabela) {
  function builder(tabela) {
    const rows = () => (dataPorTabela[tabela] || []);
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { resolve({ data: rows(), error: null }); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const SCOPE = { mode: 'LEGACY_COMPANY' };
const EMP = 'e1';

function baseCampaign(over = {}) {
  return {
    id: 'c1', empresa_id: EMP, reference_code: 'CMP-1', name: 'Safra', cargo_name: 'Soja',
    status: 'APPROVED', planning_status: 'APPROVED', approved_plan_version_id: 'p1',
    planned_start: null, planned_end: null, timezone: 'America/Sao_Paulo', ...over,
  };
}
const plan = { id: 'p1', version_number: 1, status: 'APPROVED', approved_at: '2026-08-24T00:00:00Z' };

function trip(over = {}) {
  return {
    id: over.id || 't1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1',
    status: 'PLANNED', planned_quantity: 10, quantity_unit: 'ton', required_capacity_kg: 10000,
    origin_location_id: 'loc-o', destination_location_id: 'loc-d',
    candidate_driver_id: 'd1', candidate_asset_id: 'a1', candidate_composition_id: null,
    constraint_metadata: {}, ...over,
  };
}
function link(over = {}) {
  return {
    id: over.id || 'l1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1',
    planned_trip_id: over.planned_trip_id || 't1', frete_id: over.frete_id || 'f1',
    materialization_status: over.materialization_status || 'MATERIALIZED', ...over,
  };
}

function data(over = {}) {
  return {
    operation_campaigns: [over.campaign || baseCampaign()],
    campaign_operational_units: [],
    campaign_plan_versions: [plan],
    campaign_planned_trips: over.trips || [],
    campaign_trip_freights: over.links || [],
    campaign_demands: over.demands || [{ target_quantity: 10, quantity_unit: 'ton' }],
    campaign_locations: [{ id: 'loc-o', name: 'Fazenda' }, { id: 'loc-d', name: 'Porto' }],
    fretes: over.fretes || [],
    usuarios: over.usuarios || [{ id: 'd1', empresa_id: EMP, status: 'ativo' }],
    fleet_assets: over.assets || [{ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000, metadata: {} }],
    vehicle_compositions: [],
    driver_vehicle_assignments: over.assignments || [{ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', composition_id: null, assignment_status: 'active', valid_until: null }],
    asset_documents: over.docs || [],
    maintenance_events: over.maintenance || [],
  };
}

async function run(over = {}) {
  const supabase = makeSupabase(data(over));
  return getCampaignProgress(supabase, { empresaId: EMP, campaignId: 'c1', operationalScope: SCOPE });
}

// ---------- toTon / conversões ----------
test('toTon: kg→ton exato, ton passthrough, unidade incompatível', () => {
  assert.deepEqual(toTon(1000, 'kg'), { value: 1, known: true, compatible: true });
  assert.deepEqual(toTon(5, 'tonelada'), { value: 5, known: true, compatible: true });
  assert.equal(toTon(5, 'litros').compatible, false);
  assert.equal(toTon(null, 'ton').known, false);
});

// ---------- estados de execução ----------
test('sem plano aprovado → NO_EXECUTION_YET / PLAN_NOT_APPROVED', async () => {
  const r = await run({ campaign: baseCampaign({ status: 'DRAFT', approved_plan_version_id: null }) });
  assert.equal(r.approved_plan, null);
  assert.equal(r.health.state, 'NO_EXECUTION_YET');
  assert.equal(r.health.reason_code, 'PLAN_NOT_APPROVED');
});

test('materializado pendente/ativo → in_execution, saúde ON_TRACK, sem dupla contagem', async () => {
  const r = await run({ trips: [trip()], links: [link()], fretes: [{ id: 'f1', status: 'ativo' }] });
  assert.equal(r.progress.trips.planned_total, 1);
  assert.equal(r.progress.trips.materialized, 1);
  assert.equal(r.progress.trips.in_execution, 1);
  assert.equal(r.progress.trips.completed, 0);
  // Sem dupla contagem: 1 trip conta exatamente 1 vez.
  const t = r.progress.trips;
  assert.equal(t.blocked + t.not_materialized + t.materialized, t.planned_total);
  assert.equal(t.in_execution + t.completed + t.cancelled + t.unknown, t.materialized);
  assert.equal(r.health.state, 'ON_TRACK');
});

test('concluído (finalizado) → completed + quantidade concluída + saúde COMPLETED', async () => {
  const r = await run({ trips: [trip()], links: [link()], fretes: [{ id: 'f1', status: 'finalizado' }] });
  assert.equal(r.progress.trips.completed, 1);
  assert.equal(r.progress.quantity.completed, 10);
  assert.equal(r.progress.quantity.remaining, 0);
  assert.equal(r.health.state, 'COMPLETED');
});

test('cancelado → visível como cancelado, remaining ajustado, replan RECOMMENDED', async () => {
  const r = await run({ trips: [trip()], links: [link()], fretes: [{ id: 'f1', status: 'cancelado' }] });
  assert.equal(r.progress.trips.cancelled, 1);
  assert.equal(r.progress.trips.completed, 0);
  assert.equal(r.progress.quantity.cancelled, 10);
  assert.equal(r.progress.quantity.remaining, 10); // target 10, completado 0
  assert.equal(r.health.state, 'ATTENTION');
  assert.equal(r.replan.status, 'REPLAN_RECOMMENDED');
  assert.equal(r.replan.reason_code, 'CANCELLED_FREIGHT_REMAINING_DEMAND');
});

test('status de frete desconhecido → bucket UNKNOWN (não IN_EXECUTION) + CRITICAL', async () => {
  const r = await run({ trips: [trip()], links: [link()], fretes: [{ id: 'f1', status: 'estado_novo_inesperado' }] });
  assert.equal(r.progress.trips.unknown, 1);
  assert.equal(r.progress.trips.in_execution, 0);
  assert.equal(r.health.state, 'CRITICAL');
  assert.equal(r.health.reason_code, 'FREIGHT_UNKNOWN_STATUS');
});

test('link ativo com frete ausente → anomalia LINK_MISSING_FREIGHT (read-only)', async () => {
  const r = await run({ trips: [trip()], links: [link({ frete_id: 'fX' })], fretes: [] });
  assert.equal(r.progress.trips.unknown, 1);
  assert.ok(r.link_anomalies.some((a) => a.type === 'LINK_MISSING_FREIGHT'));
});

test('viagem planejada bloqueada (planner) → blocked + CRITICAL + replan REQUIRED_BY_INVARIANT', async () => {
  const r = await run({
    trips: [trip({ id: 't1', status: 'BLOCKED', planned_quantity: 0, constraint_metadata: { reason: 'INSUFFICIENT_CAPACITY' } })],
    links: [], demands: [{ target_quantity: 10, quantity_unit: 'ton' }],
  });
  assert.equal(r.progress.trips.blocked, 1);
  assert.equal(r.health.state, 'CRITICAL');
  assert.equal(r.replan.status, 'REPLAN_REQUIRED_BY_INVARIANT');
  assert.deepEqual(r.replan.affected_trip_ids, ['t1']);
});

test('não materializado com candidato ativo → readiness READY_FOR_DIRECT_ASSIGNMENT', async () => {
  const r = await run({ trips: [trip()], links: [] });
  assert.equal(r.progress.trips.not_materialized, 1);
  assert.equal(r.readiness.ready_direct, 1);
  const detail = r.trips_detail[0];
  assert.equal(detail.readiness, 'READY_FOR_DIRECT_ASSIGNMENT');
});

test('não materializado com candidato inativo → readiness BLOCKED + exceção', async () => {
  const r = await run({ trips: [trip()], links: [], usuarios: [{ id: 'd1', empresa_id: EMP, status: 'inativo' }] });
  assert.equal(r.readiness.blocked, 1);
  assert.equal(r.trips_detail[0].readiness, 'BLOCKED');
  assert.ok(r.exceptions.some((e) => e.type === 'DRIVER_INACTIVE'));
});

test('quantidade kg→ton agregada corretamente na demanda', async () => {
  const r = await run({
    trips: [trip({ planned_quantity: 5000, quantity_unit: 'kg' })],
    links: [link()], fretes: [{ id: 'f1', status: 'finalizado' }],
    demands: [{ target_quantity: 10000, quantity_unit: 'kg' }],
  });
  assert.equal(r.progress.quantity.unit, 'ton');
  assert.equal(r.progress.quantity.target, 10);       // 10000 kg
  assert.equal(r.progress.quantity.completed, 5);     // 5000 kg
  assert.equal(r.progress.quantity.remaining, 5);
  assert.equal(r.progress.quantity.coverage.quantity_source, 'PLANNED_FREIGHT_QUANTITY');
  assert.equal(r.progress.quantity.coverage.measured_actual_available, false);
});

test('cenário misto: concluído + em execução + cancelado sem dupla contagem', async () => {
  const trips = [
    trip({ id: 't1' }), trip({ id: 't2' }), trip({ id: 't3' }),
  ];
  const links = [
    link({ id: 'l1', planned_trip_id: 't1', frete_id: 'f1' }),
    link({ id: 'l2', planned_trip_id: 't2', frete_id: 'f2' }),
    link({ id: 'l3', planned_trip_id: 't3', frete_id: 'f3' }),
  ];
  const fretes = [
    { id: 'f1', status: 'finalizado' },
    { id: 'f2', status: 'ativo' },
    { id: 'f3', status: 'cancelado' },
  ];
  const r = await run({ trips, links, fretes, demands: [{ target_quantity: 30, quantity_unit: 'ton' }] });
  const t = r.progress.trips;
  assert.equal(t.planned_total, 3);
  assert.equal(t.completed, 1);
  assert.equal(t.in_execution, 1);
  assert.equal(t.cancelled, 1);
  assert.equal(t.materialized, 3);
  assert.equal(t.in_execution + t.completed + t.cancelled + t.unknown, t.materialized);
  assert.equal(r.progress.quantity.completed, 10);
  assert.equal(r.progress.quantity.remaining, 20);
});

// ---------- unidades puras ----------
test('deriveWindow: not started / active / exceeded', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(deriveWindow({ planned_start: future }).state, 'WINDOW_NOT_STARTED');
  assert.equal(deriveWindow({ planned_end: past }).state, 'WINDOW_EXCEEDED');
  assert.equal(deriveWindow({}), null);
});

test('deriveReplan: janela excedida com demanda restante → RECOMMENDED', () => {
  const r = deriveReplan({
    trips: { blocked: 0, cancelled: 0, unknown: 0 },
    quantity: { remaining: 5, unit: 'ton' },
    window: { state: 'WINDOW_EXCEEDED' },
    blockedTripIds: [], cancelledTripIds: [], unknownTripIds: [],
  });
  assert.equal(r.status, 'REPLAN_RECOMMENDED');
  assert.equal(r.reason_code, 'WINDOW_EXCEEDED_REMAINING_DEMAND');
});

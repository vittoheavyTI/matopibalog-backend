'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCandidate,
  resourceCapacityKg,
  listTripEligibility,
  ELIGIBILITY,
} = require('../services/campaign/dispatchEligibilityService');

const LEGACY = { mode: 'LEGACY_COMPANY' };

// ---------------- evaluateCandidate (puro) ----------------
function candidate(over = {}) {
  return evaluateCandidate({
    driver: over.driver !== undefined ? over.driver : { id: 'd1', status: 'ativo' },
    resource: over.resource !== undefined ? over.resource : { id: 'a1', status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000 },
    resourceType: over.resourceType || 'asset',
    activeAssignment: over.activeAssignment !== undefined ? over.activeAssignment : { driver_id: 'd1', asset_id: 'a1' },
    requiredCapacityKg: over.requiredCapacityKg !== undefined ? over.requiredCapacityKg : 10000,
    maintenanceActive: over.maintenanceActive || false,
    documents: over.documents || [],
    operationalScope: over.operationalScope || LEGACY,
  });
}

test('motorista + ativo ativos → ELIGIBLE, rota UNKNOWN', () => {
  const r = candidate();
  assert.equal(r.eligibility, ELIGIBILITY.ELIGIBLE);
  assert.equal(r.route_compatibility, 'UNKNOWN'); // §53/§114 nunca route-compatible
  assert.equal(r.capacity_match, 'MATCH');
  assert.equal(r.assignment_status, 'ACTIVE');
});

test('motorista inativo → INELIGIBLE DRIVER_INACTIVE', () => {
  const r = candidate({ driver: { id: 'd1', status: 'inativo' } });
  assert.equal(r.eligibility, ELIGIBILITY.INELIGIBLE);
  assert.ok(r.reasons.includes('DRIVER_INACTIVE'));
});

test('recurso inativo → INELIGIBLE RESOURCE_INACTIVE', () => {
  const r = candidate({ resource: { id: 'a1', status: 'inactive', unidade_operacional_id: null } });
  assert.equal(r.eligibility, ELIGIBILITY.INELIGIBLE);
  assert.ok(r.reasons.includes('RESOURCE_INACTIVE'));
});

test('vínculo ausente/stale → INELIGIBLE ASSIGNMENT_MISSING', () => {
  const r = candidate({ activeAssignment: null });
  assert.equal(r.eligibility, ELIGIBILITY.INELIGIBLE);
  assert.ok(r.reasons.includes('ASSIGNMENT_MISSING'));
});

test('escopo negado → INELIGIBLE RESOURCE_SCOPE_DENIED', () => {
  const scope = { mode: 'UNIT', allowed_unit_ids: ['u-ok'] };
  const r = candidate({
    resource: { id: 'a1', status: 'active', unidade_operacional_id: 'u-forbidden', useful_capacity_kg: 30000 },
    operationalScope: scope,
  });
  assert.equal(r.eligibility, ELIGIBILITY.INELIGIBLE);
  assert.ok(r.reasons.includes('RESOURCE_SCOPE_DENIED'));
});

test('capacidade insuficiente → ELIGIBLE_WITH_WARNINGS + CAPACITY_INSUFFICIENT', () => {
  const r = candidate({ resource: { id: 'a1', status: 'active', unidade_operacional_id: null, useful_capacity_kg: 5000 }, requiredCapacityKg: 20000 });
  assert.equal(r.eligibility, ELIGIBILITY.ELIGIBLE_WITH_WARNINGS);
  assert.equal(r.capacity_match, 'INSUFFICIENT');
});

test('capacidade desconhecida → capacity_match UNKNOWN (não infere), ainda ELIGIBLE', () => {
  const r = candidate({ resource: { id: 'a1', status: 'active', unidade_operacional_id: null }, requiredCapacityKg: 20000 });
  assert.equal(r.capacity_match, 'UNKNOWN');
  assert.equal(r.eligibility, ELIGIBILITY.ELIGIBLE);
});

test('documento vencido → DOCUMENTS_ATTENTION (warning, não bloqueia)', () => {
  const r = candidate({ documents: [{ status: 'expired' }] });
  assert.equal(r.documents_status, 'DOCUMENTS_ATTENTION');
  assert.equal(r.eligibility, ELIGIBILITY.ELIGIBLE_WITH_WARNINGS);
});

test('manutenção aberta → MAINTENANCE_ATTENTION (warning, não bloqueia)', () => {
  const r = candidate({ maintenanceActive: true });
  assert.equal(r.maintenance_status, 'MAINTENANCE_ATTENTION');
  assert.equal(r.eligibility, ELIGIBILITY.ELIGIBLE_WITH_WARNINGS);
});

test('resourceCapacityKg: asset useful, composição metadata, desconhecida=null', () => {
  assert.equal(resourceCapacityKg({ useful_capacity_kg: 12000 }, 'asset'), 12000);
  assert.equal(resourceCapacityKg({ metadata: { capacity_kg: 40000 } }, 'composition'), 40000);
  assert.equal(resourceCapacityKg({ metadata: {} }, 'composition'), null);
});

// ---------------- listTripEligibility (integração com stub) ----------------
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
function baseData(over = {}) {
  return {
    operation_campaigns: [{ id: 'c1', empresa_id: EMP }],
    campaign_operational_units: [],
    campaign_planned_trips: [over.trip || { id: 't1', empresa_id: EMP, campaign_id: 'c1', plan_version_id: 'p1', status: 'PLANNED', required_capacity_kg: 10000, planned_quantity: 10, quantity_unit: 'ton', candidate_driver_id: 'd1', candidate_asset_id: 'a1' }],
    driver_vehicle_assignments: over.assignments || [{ empresa_id: EMP, driver_id: 'd1', asset_id: 'a1', composition_id: null, assignment_status: 'active', valid_until: null }],
    usuarios: over.usuarios || [{ id: 'd1', empresa_id: EMP, status: 'ativo' }],
    fleet_assets: over.assets || [{ id: 'a1', empresa_id: EMP, status: 'active', unidade_operacional_id: null, plate: 'ABC1D23', useful_capacity_kg: 30000, metadata: {} }],
    vehicle_compositions: [],
    asset_documents: over.docs || [],
    maintenance_events: over.maintenance || [],
  };
}

test('listTripEligibility: candidato ativo → 1 elegível', async () => {
  const r = await listTripEligibility(makeSupabase(baseData()), { empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1', operationalScope: LEGACY });
  assert.equal(r.summary.total_candidates, 1);
  assert.equal(r.summary.eligible, 1);
  assert.equal(r.summary.has_any_eligible, true);
  assert.equal(r.candidates[0].route_compatibility, 'UNKNOWN');
});

test('listTripEligibility: motorista inativo → 0 elegíveis', async () => {
  const r = await listTripEligibility(makeSupabase(baseData({ usuarios: [{ id: 'd1', empresa_id: EMP, status: 'inativo' }] })), { empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1', operationalScope: LEGACY });
  assert.equal(r.summary.eligible, 0);
  assert.equal(r.summary.ineligible, 1);
  assert.equal(r.summary.has_any_eligible, false);
});

test('listTripEligibility: escopo sem acesso → 403', async () => {
  await assert.rejects(
    () => listTripEligibility(makeSupabase(baseData()), { empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1', operationalScope: { mode: 'NO_ACCESS' } }),
    (err) => err.status === 403,
  );
});

test('listTripEligibility: viagem inexistente → 404', async () => {
  const d = baseData(); d.campaign_planned_trips = [];
  await assert.rejects(
    () => listTripEligibility(makeSupabase(d), { empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 'tX', operationalScope: LEGACY }),
    (err) => err.status === 404,
  );
});

test('listTripEligibility: limite/paginação (top-N determinístico)', async () => {
  const assignments = Array.from({ length: 5 }, (_, i) => ({ empresa_id: EMP, driver_id: `d${i}`, asset_id: `a${i}`, composition_id: null, assignment_status: 'active', valid_until: null }));
  const usuarios = assignments.map((a) => ({ id: a.driver_id, empresa_id: EMP, status: 'ativo' }));
  const assets = assignments.map((a, i) => ({ id: a.asset_id, empresa_id: EMP, status: 'active', unidade_operacional_id: null, useful_capacity_kg: 30000 - i, metadata: {} }));
  const r = await listTripEligibility(makeSupabase(baseData({ assignments, usuarios, assets })), { empresaId: EMP, campaignId: 'c1', planId: 'p1', tripId: 't1', operationalScope: LEGACY, limit: 2 });
  assert.equal(r.candidates.length, 2);
  assert.equal(r.truncated, true);
  // Ordenação estável por capacidade desc.
  assert.ok(r.candidates[0].capacity_kg >= r.candidates[1].capacity_kg);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultInvariantRegistry } = require('../services/verifiability/defaultInvariants');
const { createInvariantRegistry } = require('../services/verifiability/invariantRegistry');
const { createFinding, passResult, failResult } = require('../services/verifiability/findings');
const { verifyTarget } = require('../services/verifiability/verifier');

function facts(overrides = {}) {
  return {
    sampleAuthAudit: async () => [],
    sampleLancamentoEventos: async () => [],
    sampleDocumentoUploads: async () => [],
    sampleDocumentoEventos: async () => [],
    sampleBillingOutbox: async () => [],
    sampleFleetCompositionMembers: async () => [],
    sampleFleetDriverAssignments: async () => [],
    sampleFleetAssets: async () => [],
    sampleFleetCompositions: async () => [],
    sampleCampaignPlanVersions: async () => [],
    sampleCampaignPlannedTrips: async () => [],
    sampleCampaignApprovals: async () => [],
    sampleDispatchRounds: async () => [],
    sampleDispatchOffers: async () => [],
    ...overrides,
  };
}

test('default verifier returns PASS with compatible empty mature-domain samples', async () => {
  const run = await verifyTarget({
    target: { type: 'platform_diagnostics' },
    context: { facts: facts(), correlation: { request_id: 'req-1' } },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'PASS');
  assert.equal(run.findings.length, 0);
  assert.equal(run.results.length, 16); // 11 pre-existentes + 5 Dispatch V1 (§63)
});

test('default verifier returns FAIL findings for objective contract drift', async () => {
  const run = await verifyTarget({
    target: { type: 'platform_diagnostics' },
    context: {
      facts: facts({
        sampleAuthAudit: async () => [{ event: 'x', motivo: 'Authorization: Bearer abc' }],
        sampleLancamentoEventos: async () => [{ entity_type: 'despesa', entity_id: null, action: 'created', source: 'web' }],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'auth.audit.secret_free.v1'));
  assert.ok(run.findings.some((f) => f.invariant_key === 'launch.events.audit_shape.v1'));
});

test('fleet invariants detect active assignment conflicts', async () => {
  const run = await verifyTarget({
    target: { domain: 'fleet' },
    context: {
      facts: facts({
        sampleFleetDriverAssignments: async () => [
          { id: 'a1', empresa_id: 'e1', driver_id: 'd1', asset_id: 'asset-1', assignment_status: 'active', valid_until: null },
          { id: 'a2', empresa_id: 'e1', driver_id: 'd1', asset_id: 'asset-2', assignment_status: 'active', valid_until: null },
        ],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'fleet.driver_assignment.no_active_conflict.v1'));
});

test('fleet invariants detect duplicated active composition memberships', async () => {
  const run = await verifyTarget({
    target: { domain: 'fleet' },
    context: {
      facts: facts({
        sampleFleetCompositionMembers: async () => [
          { id: 'm1', empresa_id: 'tenant-a', composition_id: 'c1', asset_id: 'asset-1', valid_until: null },
          { id: 'm2', empresa_id: 'tenant-a', composition_id: 'c2', asset_id: 'asset-1', valid_until: null },
          { id: 'm3', empresa_id: 'tenant-b', composition_id: 'c3', asset_id: 'asset-2', valid_until: '2026-08-22T00:00:00.000Z' },
        ],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'fleet.composition.unique_active_asset.v1'));
});

test('fleet invariants detect tenant-inconsistent assignment targets', async () => {
  const run = await verifyTarget({
    target: { domain: 'fleet' },
    context: {
      facts: facts({
        sampleFleetDriverAssignments: async () => [
          { id: 'a1', empresa_id: 'tenant-a', driver_id: 'd1', asset_id: 'asset-b', assignment_status: 'active', valid_until: null },
          { id: 'a2', empresa_id: 'tenant-a', driver_id: 'd2', composition_id: 'comp-a', assignment_status: 'ended', valid_until: '2026-08-22T00:00:00.000Z' },
        ],
        sampleFleetAssets: async () => [{ id: 'asset-b', empresa_id: 'tenant-b' }],
        sampleFleetCompositions: async () => [{ id: 'comp-a', empresa_id: 'tenant-a' }],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'fleet.assignment.tenant_consistency.v1'));
});

test('campaign invariants detect invalid planned trip targets and approved plan evidence', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleCampaignPlanVersions: async () => [
          { id: 'plan-1', empresa_id: 'tenant-a', campaign_id: 'camp-1', status: 'APPROVED', result_summary: null, resource_snapshot: {}, generated_at: '2026-08-22T00:00:00.000Z' },
        ],
        sampleCampaignPlannedTrips: async () => [
          { id: 'trip-1', empresa_id: 'tenant-a', campaign_id: 'camp-1', plan_version_id: 'plan-1', planned_quantity: 10, required_capacity_kg: 1000, candidate_asset_id: 'asset-1', candidate_composition_id: 'comp-1', status: 'PLANNED' },
        ],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'campaign.plan.status_contract.v1'));
  assert.ok(run.findings.some((f) => f.invariant_key === 'campaign.trip.quantity_capacity.v1'));
});

test('dispatch invariants detect two ACCEPTED offers for the same round (DISPATCH_ONE_WINNER)', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleDispatchOffers: async () => [
          { id: 'o1', empresa_id: 'e1', round_id: 'r1', driver_id: 'd1', status: 'ACCEPTED', responded_at: '2026-08-22T00:00:00.000Z' },
          { id: 'o2', empresa_id: 'e1', round_id: 'r1', driver_id: 'd2', status: 'ACCEPTED', responded_at: '2026-08-22T00:00:00.000Z' },
        ],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'dispatch.round.one_winner.v1'));
});

test('dispatch invariants detect two OPEN rounds for the same planned trip (DISPATCH_ONE_ACTIVE_ASSIGNMENT)', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleDispatchRounds: async () => [
          { id: 'r1', empresa_id: 'e1', planned_trip_id: 't1', status: 'OPEN' },
          { id: 'r2', empresa_id: 'e1', planned_trip_id: 't1', status: 'OPEN' },
        ],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'dispatch.round.one_active_per_trip.v1'));
});

test('dispatch invariants detect winner mismatch against the planned trip candidate (DISPATCH_WINNER_HAS_CANONICAL_ASSIGNMENT)', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleDispatchRounds: async () => [{ id: 'r1', empresa_id: 'e1', planned_trip_id: 't1', status: 'ASSIGNED', winner_offer_id: 'o1' }],
        sampleDispatchOffers: async () => [{ id: 'o1', empresa_id: 'e1', round_id: 'r1', driver_id: 'driver-vencedor', status: 'ACCEPTED' }],
        sampleCampaignPlannedTrips: async () => [{ id: 't1', empresa_id: 'e1', candidate_driver_id: 'driver-diferente', status: 'PLANNED', planned_quantity: 10, required_capacity_kg: 1000 }],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'dispatch.winner.canonical_assignment.v1'));
});

test('dispatch invariants detect accept after round expiry (DISPATCH_NO_ACCEPT_AFTER_EXPIRY)', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleDispatchRounds: async () => [{ id: 'r1', empresa_id: 'e1', planned_trip_id: 't1', status: 'ASSIGNED', expires_at: '2026-08-22T00:00:00.000Z' }],
        sampleDispatchOffers: async () => [{ id: 'o1', empresa_id: 'e1', round_id: 'r1', driver_id: 'd1', status: 'ACCEPTED', responded_at: '2026-08-22T00:10:00.000Z' }],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'dispatch.offer.no_accept_after_expiry.v1'));
});

test('dispatch invariants detect tenant mismatch between offer and round (DISPATCH_RECIPIENT_TENANT_MATCH)', async () => {
  const run = await verifyTarget({
    target: { domain: 'operation_campaign' },
    context: {
      facts: facts({
        sampleDispatchRounds: async () => [{ id: 'r1', empresa_id: 'tenant-a', planned_trip_id: 't1', status: 'OPEN' }],
        sampleDispatchOffers: async () => [{ id: 'o1', empresa_id: 'tenant-b', round_id: 'r1', driver_id: 'd1', status: 'PENDING' }],
      }),
    },
    registry: createDefaultInvariantRegistry(),
    now: () => '2026-08-22T00:00:00.000Z',
  });
  assert.equal(run.status, 'FAIL');
  assert.ok(run.findings.some((f) => f.invariant_key === 'dispatch.offer.tenant_match.v1'));
});

test('verifier supports multiple findings and stable invariant keys', async () => {
  const registry = createInvariantRegistry([
    {
      stable_key: 'test.one.v1',
      domain: 'platform',
      severity: 'low',
      check: async ({ invariant }) => failResult(createFinding({ invariant_key: invariant.stable_key, summary: 'one' })),
    },
    {
      stable_key: 'test.two.v1',
      domain: 'platform',
      severity: 'medium',
      check: async ({ invariant }) => failResult(createFinding({ invariant_key: invariant.stable_key, summary: 'two' })),
    },
  ]);
  const run = await verifyTarget({ registry, target: {}, context: {} });
  assert.deepEqual(run.findings.map((f) => f.invariant_key), ['test.one.v1', 'test.two.v1']);
});

test('registry rejects duplicate invariant keys', () => {
  assert.throws(() => createInvariantRegistry([
    { stable_key: 'dup.v1', severity: 'low', check: async () => passResult() },
    { stable_key: 'dup.v1', severity: 'low', check: async () => passResult() },
  ]), /duplicate_invariant/);
});

test('verifier is safe under concurrent read-only execution', async () => {
  let reads = 0;
  const registry = createDefaultInvariantRegistry();
  const context = { facts: facts({ sampleAuthAudit: async () => { reads += 1; return []; } }) };
  const runs = await Promise.all(Array.from({ length: 5 }, () =>
    verifyTarget({ target: {}, context, registry, now: () => '2026-08-22T00:00:00.000Z' })
  ));
  assert.equal(runs.every((run) => run.status === 'PASS'), true);
  assert.equal(reads, 5);
});

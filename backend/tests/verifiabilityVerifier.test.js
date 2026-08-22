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
  assert.equal(run.results.length, 5);
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRODUCTION_EXECUTE_POLICY,
  RISK_CLASSES,
  RepairPlaybookRegistry,
  runPlaybook,
} = require('../services/verifiability/repairPlaybookEngine');

test('repair playbook dry-run reports no mutation', async () => {
  let mutated = false;
  const registry = new RepairPlaybookRegistry().register({
    stable_key: 'repair.test.v1',
    risk_class: RISK_CLASSES.CONFIRM_REQUIRED,
    dryRun: async () => ({ would_mutate: false, operations: ['explain'] }),
  });
  const result = await runPlaybook({ registry, stable_key: 'repair.test.v1', phase: 'dryRun' });
  assert.equal(result.would_mutate, false);
  assert.deepEqual(result.operations, ['explain']);
  assert.equal(mutated, false);
});

test('repair playbook execute is blocked by policy', async () => {
  const registry = new RepairPlaybookRegistry().register({
    stable_key: 'repair.blocked.v1',
    risk_class: RISK_CLASSES.OWNER_GATE,
  });
  const result = await runPlaybook({ registry, stable_key: 'repair.blocked.v1', phase: 'execute' });
  assert.equal(result.status, PRODUCTION_EXECUTE_POLICY);
  assert.equal(result.would_mutate, false);
});

test('repair playbook registry rejects invalid risk class', () => {
  const registry = new RepairPlaybookRegistry();
  assert.throws(() => registry.register({ stable_key: 'bad.v1', risk_class: 'NOPE' }), /invalid_risk_class/);
});

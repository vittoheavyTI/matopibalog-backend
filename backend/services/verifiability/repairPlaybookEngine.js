'use strict';

const RISK_CLASSES = Object.freeze({
  SAFE_AUTO: 'SAFE_AUTO',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  OWNER_GATE: 'OWNER_GATE',
});

const PRODUCTION_EXECUTE_POLICY = 'DISABLED_BY_POLICY';

class RepairPlaybookRegistry {
  constructor() {
    this._items = new Map();
  }

  register(playbook) {
    const key = playbook && playbook.stable_key;
    if (!key) throw new Error('stable_key_required');
    if (this._items.has(key)) throw new Error(`duplicate_playbook:${key}`);
    if (!Object.values(RISK_CLASSES).includes(playbook.risk_class)) {
      throw new Error(`invalid_risk_class:${key}`);
    }
    this._items.set(key, Object.freeze({
      stable_key: key,
      risk_class: playbook.risk_class,
      required_permission: playbook.required_permission || null,
      scope_behavior: playbook.scope_behavior || 'explicit_scope_only',
      idempotency_behavior: playbook.idempotency_behavior || 'idempotent_by_key',
      confirmation_policy: playbook.confirmation_policy || PRODUCTION_EXECUTE_POLICY,
      rollback_strategy: playbook.rollback_strategy || 'not_applicable',
      check: playbook.check || (async () => ({ ok: true })),
      diagnose: playbook.diagnose || (async () => ({ diagnosis: 'not_implemented' })),
      dryRun: playbook.dryRun || (async () => ({ would_mutate: false, operations: [] })),
      verify: playbook.verify || (async () => ({ ok: true })),
    }));
    return this;
  }

  get(key) {
    return this._items.get(key) || null;
  }

  list() {
    return Array.from(this._items.values());
  }
}

async function runPlaybook({ registry, stable_key, phase, context = {} }) {
  const playbook = registry.get(stable_key);
  if (!playbook) throw new Error(`playbook_not_found:${stable_key}`);
  if (phase === 'execute') {
    return {
      status: PRODUCTION_EXECUTE_POLICY,
      stable_key,
      risk_class: playbook.risk_class,
      would_mutate: false,
    };
  }
  if (phase === 'check') return playbook.check(context);
  if (phase === 'diagnose') return playbook.diagnose(context);
  if (phase === 'dryRun') return playbook.dryRun(context);
  if (phase === 'verify') return playbook.verify(context);
  throw new Error(`invalid_playbook_phase:${phase}`);
}

module.exports = {
  PRODUCTION_EXECUTE_POLICY,
  RISK_CLASSES,
  RepairPlaybookRegistry,
  runPlaybook,
};

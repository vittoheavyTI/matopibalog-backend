'use strict';

const { SEVERITIES } = require('./findings');

class InvariantRegistry {
  constructor() {
    this._items = new Map();
  }

  register(invariant) {
    const key = invariant && invariant.stable_key;
    if (!key || typeof key !== 'string') throw new Error('stable_key_required');
    if (this._items.has(key)) throw new Error(`duplicate_invariant:${key}`);
    if (!SEVERITIES.includes(invariant.severity)) throw new Error(`invalid_severity:${key}`);
    if (typeof invariant.check !== 'function') throw new Error(`check_required:${key}`);
    this._items.set(key, Object.freeze({
      stable_key: key,
      domain: invariant.domain || 'platform',
      description: invariant.description || key,
      severity: invariant.severity,
      remediation_policy: invariant.remediation_policy || 'manual_review',
      version: invariant.version || 1,
      check: invariant.check,
    }));
    return this;
  }

  list() {
    return Array.from(this._items.values());
  }

  get(stableKey) {
    return this._items.get(stableKey) || null;
  }
}

function createInvariantRegistry(invariants = []) {
  const registry = new InvariantRegistry();
  for (const invariant of invariants) registry.register(invariant);
  return registry;
}

module.exports = { InvariantRegistry, createInvariantRegistry };

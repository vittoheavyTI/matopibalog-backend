'use strict';

const crypto = require('crypto');
const { STATUSES, createFinding } = require('./findings');

async function verifyTarget({ target = {}, context = {}, registry, now = () => new Date().toISOString() }) {
  if (!registry || typeof registry.list !== 'function') throw new Error('registry_required');
  const invariants = registry.list().filter((invariant) => {
    if (!target.domain) return true;
    return invariant.domain === target.domain || invariant.domain === 'platform';
  });

  const checked_at = now();
  const results = [];
  const findings = [];

  for (const invariant of invariants) {
    try {
      const result = await invariant.check({ target, context, invariant, checked_at });
      const invariantFindings = Array.isArray(result?.findings) ? result.findings : [];
      results.push({
        invariant_key: invariant.stable_key,
        domain: invariant.domain,
        status: invariantFindings.length ? STATUSES.FAIL : STATUSES.PASS,
        evidence: result?.evidence || {},
      });
      findings.push(...invariantFindings);
    } catch (error) {
      const finding = createFinding({
        invariant_key: invariant.stable_key,
        severity: invariant.severity,
        summary: 'Invariant check failed to execute.',
        evidence: { error_class: error?.code || error?.message || 'unknown_error' },
        detected_at: checked_at,
        recommended_action: 'Inspect diagnostic provider and invariant implementation.',
      });
      results.push({
        invariant_key: invariant.stable_key,
        domain: invariant.domain,
        status: STATUSES.FAIL,
        evidence: { error_class: error?.code || error?.message || 'unknown_error' },
      });
      findings.push(finding);
    }
  }

  return {
    verification_run_id: `vrun_${crypto.randomUUID()}`,
    status: findings.length ? STATUSES.FAIL : STATUSES.PASS,
    checked_at,
    target,
    correlation: context.correlation || null,
    results,
    findings,
  };
}

module.exports = { verifyTarget };

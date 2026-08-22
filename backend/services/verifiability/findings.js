'use strict';

const SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'critical']);
const STATUSES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL' });

function normalizeSeverity(severity) {
  return SEVERITIES.includes(severity) ? severity : 'medium';
}

function createFinding(input = {}) {
  if (!input.invariant_key) throw new Error('invariant_key_required');
  return {
    invariant_key: input.invariant_key,
    severity: normalizeSeverity(input.severity),
    entity: input.entity || null,
    summary: String(input.summary || 'Invariant failed.').slice(0, 500),
    evidence: input.evidence || {},
    detected_at: input.detected_at || new Date().toISOString(),
    recommended_action: input.recommended_action || 'Review diagnostic evidence.',
    repair_playbook_key: input.repair_playbook_key || null,
  };
}

function passResult(evidence = {}) {
  return { status: STATUSES.PASS, findings: [], evidence };
}

function failResult(findings) {
  return {
    status: STATUSES.FAIL,
    findings: Array.isArray(findings) ? findings : [findings],
  };
}

module.exports = {
  SEVERITIES,
  STATUSES,
  createFinding,
  failResult,
  normalizeSeverity,
  passResult,
};

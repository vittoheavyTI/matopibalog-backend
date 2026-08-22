'use strict';

const supabase = require('../config/supabase');
const { buildDiagnosticAccessContext } = require('../services/verifiability/diagnosticAccess');
const { createSupabaseDiagnosticFacts } = require('../services/verifiability/diagnosticFacts');
const { createDefaultInvariantRegistry } = require('../services/verifiability/defaultInvariants');
const { verifyTarget } = require('../services/verifiability/verifier');
const { PRODUCTION_EXECUTE_POLICY, RepairPlaybookRegistry, RISK_CLASSES } = require('../services/verifiability/repairPlaybookEngine');

function createFoundationPlaybookRegistry() {
  return new RepairPlaybookRegistry().register({
    stable_key: 'diagnostics.manual_review.v1',
    risk_class: RISK_CLASSES.CONFIRM_REQUIRED,
    required_permission: 'platform.diagnostics.review',
    scope_behavior: 'explicit_scope_only',
    idempotency_behavior: 'no_mutation_in_e15a',
    confirmation_policy: PRODUCTION_EXECUTE_POLICY,
    rollback_strategy: 'not_applicable_read_only',
    dryRun: async () => ({
      would_mutate: false,
      operations: ['collect_evidence', 'open_manual_review'],
    }),
  });
}

async function listarDiagnosticos(req, res) {
  let access;
  try {
    access = buildDiagnosticAccessContext(req);
  } catch (error) {
    return res.status(error.status || 403).json({ message: 'Acesso restrito ao diagnostico da plataforma.' });
  }

  const registry = createDefaultInvariantRegistry();
  const playbooks = createFoundationPlaybookRegistry();
  const run = await verifyTarget({
    target: { type: 'platform_diagnostics' },
    context: {
      access,
      correlation: req.correlation || null,
      facts: createSupabaseDiagnosticFacts(supabase),
    },
    registry,
  });

  return res.json({
    status: run.status,
    checked_at: run.checked_at,
    correlation: run.correlation,
    target: run.target,
    authority: access.authority,
    production_execute_policy: PRODUCTION_EXECUTE_POLICY,
    invariants: registry.list().map((item) => ({
      stable_key: item.stable_key,
      domain: item.domain,
      severity: item.severity,
      description: item.description,
      version: item.version,
    })),
    results: run.results,
    findings: run.findings,
    repair_playbooks: playbooks.list().map((item) => ({
      stable_key: item.stable_key,
      risk_class: item.risk_class,
      required_permission: item.required_permission,
      scope_behavior: item.scope_behavior,
      idempotency_behavior: item.idempotency_behavior,
      confirmation_policy: item.confirmation_policy,
      rollback_strategy: item.rollback_strategy,
    })),
  });
}

module.exports = {
  createFoundationPlaybookRegistry,
  listarDiagnosticos,
};

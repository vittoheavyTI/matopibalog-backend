'use strict';

const { createFinding, failResult, passResult } = require('./findings');
const { createInvariantRegistry } = require('./invariantRegistry');

const SECRET_RE = /(authorization|bearer\s+[a-z0-9._-]+|cookie=|refresh_token|access_token|otp|senha|password|secret|pix copia|base64,)/i;
const LANCAMENTO_SOURCES = new Set(['web', 'app', 'api', 'system']);
const LANCAMENTO_ENTITIES = new Set(['despesa', 'abastecimento', 'vale']);
const LANCAMENTO_ACTIONS = new Set(['created', 'approved', 'rejected', 'cancelled', 'updated']);
const DOCUMENT_STATUS = new Set(['ativo', 'cancelado']);
const DOCUMENT_EVENT_TYPES = new Set(['uploaded', 'replaced', 'cancelled', 'acknowledged', 'returned']);
const BILLING_OUTBOX_STATUS = new Set(['pending', 'processing', 'processed', 'failed', 'dead']);

function countDuplicates(rows, keyFn) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates.size;
}

function containsSecretLikeValue(row) {
  return Object.entries(row || {}).some(([key, value]) => {
    if (value == null) return false;
    if (/id$|created_at|occurred_at/i.test(key)) return false;
    return SECRET_RE.test(String(value));
  });
}

function buildFinding(invariant, summary, evidence, checkedAt) {
  return createFinding({
    invariant_key: invariant.stable_key,
    severity: invariant.severity,
    summary,
    evidence,
    detected_at: checkedAt,
    recommended_action: 'Corrigir a fonte canônica antes de habilitar automação dependente deste diagnóstico.',
  });
}

function createDefaultInvariantRegistry() {
  return createInvariantRegistry([
    {
      stable_key: 'auth.audit.secret_free.v1',
      domain: 'auth',
      description: 'Auth audit must not expose tokens, OTP, cookies, passwords or raw secrets.',
      severity: 'high',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleAuthAudit();
        const invalid = rows.filter(containsSecretLikeValue);
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Auth audit sample contains secret-like values.', {
            sampled: rows.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'launch.events.audit_shape.v1',
      domain: 'finance_operational',
      description: 'Operational launch events keep objective entity/action/source audit shape.',
      severity: 'medium',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleLancamentoEventos();
        const invalid = rows.filter((row) =>
          !LANCAMENTO_ENTITIES.has(row.entity_type) ||
          !row.entity_id ||
          !LANCAMENTO_ACTIONS.has(row.action) ||
          (row.source != null && !LANCAMENTO_SOURCES.has(row.source))
        );
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Launch event audit shape has invalid rows.', {
            sampled: rows.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'documents.upload.idempotency_contract.v1',
      domain: 'documents',
      description: 'Document uploads preserve contract version, status and non-blank idempotency keys when present.',
      severity: 'medium',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleDocumentoUploads();
        const invalid = rows.filter((row) => {
          const versionOk = row.document_contract_version === 1 || row.document_contract_version === 2;
          const statusOk = DOCUMENT_STATUS.has(row.status);
          const requestIdOk = row.client_request_id == null || String(row.client_request_id).trim().length > 0;
          const outroMetadataOk =
            row.tipo !== 'outro' ||
            row.document_contract_version !== 2 ||
            Boolean(String(row.nome_documento || row.descricao || '').trim());
          return !versionOk || !statusOk || !requestIdOk || !outroMetadataOk;
        });
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Document upload contract has invalid sampled rows.', {
            sampled: rows.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'documents.events.audit_shape.v1',
      domain: 'documents',
      description: 'Document events keep event/source audit fields without requiring raw document data.',
      severity: 'medium',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleDocumentoEventos();
        const invalid = rows.filter((row) =>
          !DOCUMENT_EVENT_TYPES.has(row.evento) ||
          !row.source ||
          containsSecretLikeValue(row.metadata || {})
        );
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Document event audit shape has invalid sampled rows.', {
            sampled: rows.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'billing.outbox.idempotent_status.v1',
      domain: 'saas_billing',
      description: 'Billing outbox rows keep dedupe key and bounded processing status.',
      severity: 'high',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleBillingOutbox();
        const invalid = rows.filter((row) =>
          !String(row.dedupe_key || '').trim() ||
          !BILLING_OUTBOX_STATUS.has(row.status) ||
          Number(row.attempts) < 0 ||
          Number(row.max_attempts) < 1
        );
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Billing outbox idempotency/status contract has invalid rows.', {
            sampled: rows.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'fleet.composition.unique_active_asset.v1',
      domain: 'fleet',
      description: 'Each fleet asset can have at most one active composition membership.',
      severity: 'high',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleFleetCompositionMembers();
        const active = rows.filter((row) => !row.valid_until);
        const duplicateCount = countDuplicates(active, (row) => row.asset_id);
        if (duplicateCount) {
          return failResult(buildFinding(invariant, 'Fleet composition membership sample has duplicated active assets.', {
            sampled: rows.length,
            duplicate_count: duplicateCount,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'fleet.driver_assignment.no_active_conflict.v1',
      domain: 'fleet',
      description: 'Active fleet driver assignments do not conflict by driver, asset or composition.',
      severity: 'high',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const rows = await context.facts.sampleFleetDriverAssignments();
        const active = rows.filter((row) => row.assignment_status === 'active' && !row.valid_until);
        const duplicateDrivers = countDuplicates(active, (row) => row.driver_id);
        const duplicateAssets = countDuplicates(active, (row) => row.asset_id);
        const duplicateCompositions = countDuplicates(active, (row) => row.composition_id);
        const conflictCount = duplicateDrivers + duplicateAssets + duplicateCompositions;
        if (conflictCount) {
          return failResult(buildFinding(invariant, 'Fleet driver assignment sample has active conflicts.', {
            sampled: rows.length,
            duplicate_drivers: duplicateDrivers,
            duplicate_assets: duplicateAssets,
            duplicate_compositions: duplicateCompositions,
          }, checked_at));
        }
        return passResult({ sampled: rows.length });
      },
    },
    {
      stable_key: 'fleet.assignment.tenant_consistency.v1',
      domain: 'fleet',
      description: 'Fleet assignment targets stay inside the same tenant as assets and compositions.',
      severity: 'high',
      remediation_policy: 'manual_review',
      version: 1,
      async check({ context, invariant, checked_at }) {
        const [assignments, assets, compositions] = await Promise.all([
          context.facts.sampleFleetDriverAssignments(),
          context.facts.sampleFleetAssets(),
          context.facts.sampleFleetCompositions(),
        ]);
        const assetTenant = new Map(assets.map((asset) => [asset.id, asset.empresa_id]));
        const compositionTenant = new Map(compositions.map((composition) => [composition.id, composition.empresa_id]));
        const invalid = assignments.filter((row) => (
          (row.asset_id && assetTenant.get(row.asset_id) && assetTenant.get(row.asset_id) !== row.empresa_id) ||
          (row.composition_id && compositionTenant.get(row.composition_id) && compositionTenant.get(row.composition_id) !== row.empresa_id)
        ));
        if (invalid.length) {
          return failResult(buildFinding(invariant, 'Fleet assignment sample has tenant-inconsistent targets.', {
            sampled: assignments.length,
            invalid_count: invalid.length,
          }, checked_at));
        }
        return passResult({ sampled: assignments.length });
      },
    },
  ]);
}

module.exports = {
  createDefaultInvariantRegistry,
};

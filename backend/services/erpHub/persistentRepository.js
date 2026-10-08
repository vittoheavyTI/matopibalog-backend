'use strict';

const { validateEnvelope } = require('./canonicalEnvelope');
const { deriveIdempotencyKey, intentFingerprintForEnvelope } = require('./idempotency');

const MISSING_SCHEMA_RE = /(erp_outbox|erp_external_identity_mappings|erp_enqueue_outbox|does not exist|schema cache)/i;

function isMissingPersistence(error) {
  return Boolean(error && MISSING_SCHEMA_RE.test(error.message || String(error)));
}

function unwrapSingle(data) {
  return Array.isArray(data) ? data[0] : data;
}

function createPersistentErpRepository(supabase) {
  if (!supabase) throw new Error('createPersistentErpRepository: supabase obrigatorio');

  async function rpc(name, params) {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw error;
    return unwrapSingle(data);
  }

  async function persistenceStatus(empresaId = null) {
    try {
      let q = supabase.from('erp_outbox').select('status', { count: 'exact', head: false }).limit(1000);
      if (empresaId) q = q.eq('empresa_id', empresaId);
      const { data, error, count } = await q;
      if (error) throw error;
      const byStatus = { pending: 0, processing: 0, failed: 0, succeeded: 0, unknown: 0, dead: 0 };
      for (const row of data || []) {
        if (byStatus[row.status] != null) byStatus[row.status] += 1;
      }
      return { available: true, outbox_count_sampled: count ?? (data || []).length, outbox_by_status: byStatus };
    } catch (error) {
      if (isMissingPersistence(error)) return { available: false, reason: 'schema_not_applied' };
      return { available: false, reason: 'read_failed' };
    }
  }

  async function enqueue({ provider, envelope, maxSendAttempts, maxReconcileAttempts }) {
    const v = validateEnvelope(envelope);
    if (!v.ok) return { code: 'invalid_envelope', motivo: v.motivo, chaveSensivel: v.chaveSensivel || null };
    const intent = intentFingerprintForEnvelope(envelope);
    const dedupeKey = deriveIdempotencyKey({
      provider,
      empresaId: envelope.empresa_id,
      eventId: envelope.event_id,
      schemaVersion: envelope.schema_version,
    });
    const row = await rpc('erp_enqueue_outbox', {
      p_provider: provider,
      p_envelope: envelope,
      p_intent_fingerprint: intent,
      p_dedupe_key: dedupeKey,
      p_max_send_attempts: maxSendAttempts || 8,
      p_max_reconcile_attempts: maxReconcileAttempts || 8,
    });
    return { ...row, dedupeKey, intentFingerprint: intent };
  }

  async function claimNext({ action, claimAuthority = 'worker', leaseSeconds = 300 } = {}) {
    return rpc('erp_claim_next_outbox', {
      p_action: action,
      p_claim_authority: claimAuthority,
      p_lease_seconds: leaseSeconds,
    });
  }

  async function markProcessed(id, claimToken, result = {}) {
    return rpc('erp_mark_outbox_succeeded', {
      p_item_id: id,
      p_claim_token: claimToken,
      p_external_reference: result.externalReference || null,
      p_external_result: result.externalResult || null,
    });
  }

  async function markFailed(id, claimToken, reason, opts = {}) {
    return rpc('erp_mark_outbox_failed', {
      p_item_id: id,
      p_claim_token: claimToken,
      p_failure: reason,
      p_retry_safe: opts.retrySafe === true,
      p_retry_safe_evidence: opts.retrySafeEvidence || null,
    });
  }

  async function recordReconcile(id, claimToken, status, opts = {}) {
    return rpc('erp_record_outbox_reconcile', {
      p_item_id: id,
      p_claim_token: claimToken,
      p_reconcile_status: status,
      p_retry_safe: opts.retrySafe === true,
      p_retry_safe_evidence: opts.retrySafeEvidence || null,
    });
  }

  async function bindExternalIdentity(args) {
    return rpc('erp_bind_external_identity', {
      p_empresa_id: args.empresaId,
      p_provider: args.provider,
      p_entity_type: args.entityType,
      p_internal_entity_id: args.internalEntityId,
      p_external_entity_id: args.externalEntityId,
      p_metadata: args.metadata || {},
    });
  }

  async function rebindExternalIdentity(args) {
    return rpc('erp_rebind_external_identity', {
      p_empresa_id: args.empresaId,
      p_provider: args.provider,
      p_entity_type: args.entityType,
      p_internal_entity_id: args.internalEntityId,
      p_external_entity_id: args.externalEntityId,
      p_reason: args.reason,
    });
  }

  return {
    persistenceStatus,
    enqueue,
    claimNext,
    markProcessed,
    markFailed,
    recordReconcile,
    bindExternalIdentity,
    rebindExternalIdentity,
  };
}

module.exports = { createPersistentErpRepository, isMissingPersistence };

'use strict';

const crypto = require('crypto');

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|senha|password|otp|pix|payload|document_bytes|bytes|base64)/i;

function sanitizeMetadata(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitizeMetadata(raw, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 497)}...`;
  return value;
}

function createEventEnvelope(input = {}) {
  const eventType = String(input.event_type || '').trim();
  const domain = String(input.domain || '').trim();
  if (!eventType) throw new Error('event_type_required');
  if (!domain) throw new Error('domain_required');

  return {
    event_id: input.event_id || `evt_${crypto.randomUUID()}`,
    event_type: eventType,
    domain,
    empresa_id: input.empresa_id || null,
    entity_type: input.entity_type || null,
    entity_id: input.entity_id || null,
    correlation_id: input.correlation_id || input.correlation?.correlation_id || null,
    operation_id: input.operation_id || input.correlation?.operation_id || null,
    causation_id: input.causation_id || input.correlation?.causation_id || null,
    actor_id: input.actor_id || null,
    actor_role: input.actor_role || null,
    source: input.source || 'system',
    occurred_at: input.occurred_at || new Date().toISOString(),
    version: input.version || 1,
    metadata: sanitizeMetadata(input.metadata || {}),
    evidence_refs: Array.isArray(input.evidence_refs) ? input.evidence_refs.slice(0, 20) : [],
  };
}

module.exports = {
  SENSITIVE_KEY_RE,
  createEventEnvelope,
  sanitizeMetadata,
};

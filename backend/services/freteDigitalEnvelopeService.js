'use strict';

const { randomUUID } = require('node:crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers?.[name] || req.headers?.[name.toLowerCase()];
    if (Array.isArray(value) && value[0]) return String(value[0]);
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function requestIdForEnvelope(req) {
  const incoming = firstHeader(req, ['x-request-id', 'x-correlation-id']);
  if (incoming && incoming.trim().length >= 8 && incoming.trim().length <= 128) return incoming.trim();
  return `e38-${randomUUID()}`;
}

function correlationIdForEnvelope(req, requestId) {
  const incoming = firstHeader(req, ['x-correlation-id', 'x-request-id']);
  if (incoming && incoming.trim().length >= 8 && incoming.trim().length <= 128) return incoming.trim();
  return requestId;
}

function actorParams(req) {
  const uid = req.user?.uid || req.user?.id || null;
  return {
    actorUserId: uuidOrNull(uid),
    actorAuthUid: uid ? String(uid) : null,
    actorRole: req.user?.role || req.user?.tipo || (req.user?.is_super_admin ? 'super_admin' : null),
  };
}

async function finalizarFreteComEnvelope(supabase, req, { freteId, empresaId, patch, reason }) {
  const requestId = requestIdForEnvelope(req);
  const correlationId = correlationIdForEnvelope(req, requestId);
  const actor = actorParams(req);

  const { data, error } = await supabase.rpc('e38_finalize_frete_with_envelope', {
    p_frete_id: freteId,
    p_empresa_id: empresaId,
    p_actor_user_id: actor.actorUserId,
    p_actor_auth_uid: actor.actorAuthUid,
    p_actor_role: actor.actorRole,
    p_reason: reason || 'formal freight closure envelope',
    p_source: 'backend_finalization',
    p_request_id: requestId,
    p_correlation_id: correlationId,
    p_patch: patch || {},
  });

  if (error) throw error;
  return data;
}

function normalizarErroEnvelope(error) {
  const msg = error?.message || '';
  if (msg.includes('E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE')) return 'E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE';
  if (msg.includes('E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE')) return 'E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE';
  if (msg.includes('e38_frete_envelope_frete_not_found')) return 'e38_frete_envelope_frete_not_found';
  if (msg.includes('e38_frete_envelope_status_locked')) return 'e38_frete_envelope_status_locked';
  if (msg.includes('e38_frete_envelope_request_id_conflict')) return 'e38_frete_envelope_request_id_conflict';
  if (msg.includes('e38_frete_envelope_patch_field_not_allowed')) return 'e38_frete_envelope_patch_field_not_allowed';
  return null;
}

module.exports = {
  finalizarFreteComEnvelope,
  normalizarErroEnvelope,
};

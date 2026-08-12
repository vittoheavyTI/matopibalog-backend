// backend/services/auth/trackingEmissaoDiag.js — observabilidade DIAGNÓSTICA da emissão da
// credencial de rastreamento (credential storm hardening). PURO: sem Express, sem Supabase,
// sem segredo. Usado APENAS para log de correlação server-side (Railway) — NUNCA para
// autorização, escopo ou qualquer decisão de segurança, e NADA aqui é persistido.

const crypto = require('crypto');

// Allowlist FECHADA dos motivos diagnósticos (header X-Tracking-Reason). Qualquer outro valor,
// ausência, tipo não-string → 'unknown'. O resultado é SEMPRE allowlist ∪ {'unknown'}.
const DIAGNOSTIC_REASONS = new Set([
  'login_reconcile', 'finance_reconcile', 'trip_started', 'manual_enable', 'native_recovery',
]);

function lerReasonDiagnostico(req) {
  const raw = req && req.headers ? req.headers['x-tracking-reason'] : undefined;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return DIAGNOSTIC_REASONS.has(v) ? v : 'unknown';
}

// Hash curto NÃO reversível do device_id (correlação, não sigilo). Nunca loga o device cru.
function deviceHashCurto(deviceId) {
  if (!deviceId) return null;
  return crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 12);
}

// Objeto de log SANITIZADO da emissão. Só campos de correlação: reason (allowlist), prefixo do
// sid autenticado, presença + hash curto do device, contagem do escopo e resultado. NUNCA inclui
// credential/access/refresh/hash da credential — construção pura e testável.
function montarLogEmissao({ req, sid, deviceId, scopeCount }) {
  return {
    reason: lerReasonDiagnostico(req),
    session_id: sid ? String(sid).slice(0, 8) : null,
    device_present: !!deviceId,
    device_hash: deviceHashCurto(deviceId),
    scope_count: scopeCount,
    result: 'issued',
  };
}

module.exports = { DIAGNOSTIC_REASONS, lerReasonDiagnostico, deviceHashCurto, montarLogEmissao };

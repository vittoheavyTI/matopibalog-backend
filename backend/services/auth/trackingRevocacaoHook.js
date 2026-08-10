// backend/services/auth/trackingRevocacaoHook.js — hooks BEST-EFFORT de revogação da
// credencial de rastreamento (SEC-1 / Opção C). NUNCA lançam.
//
// IMPORTANTE (pós-revisão): estes hooks são apenas ACELERAÇÃO/limpeza. A SEGURANÇA NÃO
// depende deles — a validação server-side já rejeita canonicamente credencial de viagem
// finalizada/cancelada (frete inativo = tracking_trip_inactive), motorista bloqueado,
// sessão revogada, device/tenant/viagem divergentes e teto absoluto. Se o hook falhar,
// o próximo request ainda é rejeitado pelo estado canônico.
//
// Quando a flag está OFF (trackingService null), tudo é no-op.

const { getTrackingRuntime } = require('./trackingCredentialRuntime');

/** Revoga as credenciais de tracking vinculadas a um frete (fim/cancelamento). */
async function revogarTrackingDoFrete({ freteId, motivo }) {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService || !freteId) return;
    await trackingService.revogarDoFrete(freteId, motivo || 'viagem_encerrada');
  } catch {
    /* best-effort: não afeta a operação chamadora */
  }
}

/** Revoga as credenciais de tracking emitidas por uma sessão (logout explícito). */
async function revogarTrackingDaSessao({ sessionId, motivo }) {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService || !sessionId) return;
    await trackingService.revogarDaSessao(sessionId, motivo || 'logout');
  } catch {
    /* best-effort */
  }
}

module.exports = { revogarTrackingDoFrete, revogarTrackingDaSessao };

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

/**
 * MULTI-VIAGEM: ao fim/cancelamento de uma viagem, se o motorista NÃO tem mais viagem
 * ativa, revoga suas credenciais de tracking (não faz sentido rastrear sem viagem).
 * Best-effort: a validação já rejeita canonicamente (tracking_trip_inactive) mesmo que
 * este hook falhe.
 */
async function revogarTrackingSeSemViagemAtiva({ empresaId, motoristaId, motivo }) {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService || !empresaId || !motoristaId) return;
    const { listarFretesAtivosDoMotorista } = require('../../controllers/freteLocalizacaoController');
    const ativos = await listarFretesAtivosDoMotorista(empresaId, motoristaId);
    if (ativos.length === 0) {
      await trackingService.revogarDoMotorista(motoristaId, motivo || 'viagem_encerrada');
    }
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

module.exports = { revogarTrackingSeSemViagemAtiva, revogarTrackingDaSessao };

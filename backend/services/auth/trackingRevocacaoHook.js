// backend/services/auth/trackingRevocacaoHook.js — hooks BEST-EFFORT de revogação da
// credencial de rastreamento (SEC-1 / Opção C). NUNCA lançam: uma falha aqui não pode
// quebrar finalização de viagem, cancelamento ou logout.
//
// Quando a flag está OFF (trackingService null), tudo é no-op.

const { getTrackingRuntime } = require('./trackingCredentialRuntime');

/**
 * Revoga as credenciais de tracking do motorista quando ele NÃO tem mais viagem ativa
 * (fim/cancelamento de viagem). Reusa a regra canônica de "viagem apta".
 */
async function revogarTrackingSeSemViagemAtiva({ empresaId, motoristaId, motivo }) {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService || !empresaId || !motoristaId) return;
    // require tardio: evita ciclo de import no boot (controller ↔ hook).
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

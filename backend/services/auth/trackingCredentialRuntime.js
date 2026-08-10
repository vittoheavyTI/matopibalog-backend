// backend/services/auth/trackingCredentialRuntime.js — wiring isolado da credencial
// de rastreamento (SEC-1 / Opção C). NÃO toca o authRuntime do SEC-1.
//
// Constrói o serviço UMA vez (memoizado) quando a flag está ON. Enquanto a flag
// estiver OFF, o serviço nasce null e o middllware/rotas caem no fluxo compatível.

const { getAuthConfig } = require('../../config/authConfig');
const { criarTrackingCredentialService } = require('./trackingCredentialService');

let cached = null;

function getTrackingRuntime() {
  if (cached) return cached;
  const cfg = getAuthConfig();
  let trackingService = null;
  if (cfg.trackingScopedCredentialEnabled) {
    const supabase = require('../../config/supabase');
    trackingService = criarTrackingCredentialService({ supabase, cfg });
  }
  cached = Object.freeze({ cfg, trackingService });
  return cached;
}

function _resetTrackingRuntimeForTests() { cached = null; }

module.exports = { getTrackingRuntime, _resetTrackingRuntimeForTests };

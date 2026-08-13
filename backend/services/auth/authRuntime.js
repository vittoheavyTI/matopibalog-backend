const { getAuthConfig } = require('../../config/authConfig');
const { criarSessionService } = require('./sessionService');

let cached = null;

function criarAuditorAuth(client) {
  return async (evento) => {
    const payload = {
      event: String(evento.event || 'auth_event').slice(0, 64),
      usuario_id: evento.usuario_id || null,
      empresa_id: evento.empresa_id || null,
      session_id: evento.session_id || null,
      refresh_family_id: evento.refresh_family_id || null,
      client_type: evento.client_type || null,
      origem: evento.origem || evento.origin || null,
      request_id: evento.request_id || null,
      resultado: evento.resultado || null,
      motivo: evento.motivo ? String(evento.motivo).slice(0, 500) : null,
      ip_hash: evento.ip_hash || null,
      user_agent: evento.user_agent ? String(evento.user_agent).slice(0, 512) : null,
    };
    const { error } = await client.from('auth_event_audit').insert(payload);
    if (error) throw error;
  };
}

function getAuthRuntime() {
  if (cached) return cached;
  const cfg = getAuthConfig();
  let sessionService = null;
  if (cfg.sessionsEnabled) {
    const supabase = require('../../config/supabase');
    sessionService = criarSessionService({ supabase, cfg, auditar: criarAuditorAuth(supabase) });
  }
  cached = Object.freeze({ cfg, sessionService });
  return cached;
}

function _resetAuthRuntimeForTests() {
  cached = null;
}

module.exports = { getAuthRuntime, _resetAuthRuntimeForTests };

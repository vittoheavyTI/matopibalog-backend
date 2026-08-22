'use strict';

function buildDiagnosticAccessContext(req) {
  const user = req.user || {};
  if (user.is_super_admin !== true) {
    const err = new Error('diagnostics_super_admin_required');
    err.status = 403;
    throw err;
  }
  return {
    authority: 'super_admin',
    actor_id: user.uid || user.id || null,
    actor_role: user.role || user.tipo || 'super_admin',
    // Diagnostico E1.5A e global/read-only; tenant nunca vem de header/correlation.
    scope: { type: 'platform', empresa_id: null },
  };
}

module.exports = { buildDiagnosticAccessContext };

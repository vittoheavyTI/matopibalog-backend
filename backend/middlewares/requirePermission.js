// requirePermission.js — enforcement de permissão efetiva V9 (P2).
//
// Uso: router.post('/x', verifyToken, requirePermission('finance.operational.view'), ctrl.x)
//
// - super_admin: authority de plataforma → passa.
// - resolve o efetivo (templates+overrides+entitlement+legado) e nega com 403 se
//   a capability não estiver concedida.
// - ADITIVO: pensado para NOVOS gates (finance, freight.create) sem alterar a
//   autoridade coarse (isAdmin/isSuperAdmin) das rotas já protegidas — preserva o
//   comportamento existente durante a transição (DEPRECATED_READ_COMPATIBILITY).
//
// scope: a verificação de escopo operacional continua no middleware/serviço próprio
// (verificarEscopoOperacional / canAccessUnit). Permissão NÃO expande scope.

'use strict';

const supabase = require('../config/supabase');
const { loadEffectivePermissions } = require('../services/permissions/permissionResolver');

async function ensureEffective(req) {
  if (req._effectivePermissions) return req._effectivePermissions;
  const user = req.user || {};
  const eff = await loadEffectivePermissions(supabase, {
    uid: user.uid || user.id,
    tipo: user.role || user.tipo,
    is_super_admin: user.is_super_admin === true,
    empresa_id: user.empresa_id,
    empresa_tipo: user.empresa_tipo,
  });
  req._effectivePermissions = eff;
  return eff;
}

function requirePermission(permissionKey) {
  return async function (req, res, next) {
    try {
      if (req.user && req.user.is_super_admin === true) return next();
      const eff = await ensureEffective(req);
      if (eff && eff.permissions && eff.permissions[permissionKey] === true) return next();
      return res.status(403).json({ message: 'Permissão insuficiente para esta ação.', permission: permissionKey });
    } catch (err) {
      console.error('[requirePermission] erro ao resolver permissão:', err?.message || err);
      return res.status(500).json({ message: 'Erro ao verificar permissão.' });
    }
  };
}

module.exports = { requirePermission, ensureEffective };

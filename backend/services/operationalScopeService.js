const supabase = require('../config/supabase');
const {
  resolveOperationalScopeState,
  canAccessUnit,
  deriveUnitForWrite,
} = require('./operationalScopeDomainService');

async function loadUser(userId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, empresa_id, tipo, status, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadScopeData(empresaId, userId) {
  if (!empresaId) {
    return { units: [], memberships: [], regionalUnitRows: [] };
  }
  const [unitsRes, membershipsRes, regionalRes] = await Promise.all([
    supabase
      .from('unidades_operacionais')
      .select('id, empresa_id, grupo_id, nome, codigo, tipo, status, is_default')
      .eq('empresa_id', empresaId),
    userId
      ? supabase
        .from('usuario_operacional_memberships')
        .select('id, usuario_id, empresa_id, grupo_id, unidade_operacional_id, regiao_operacional_id, scope_level, papel, status')
        .eq('usuario_id', userId)
        .eq('empresa_id', empresaId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('regiao_operacional_unidades')
      .select('regiao_id, empresa_id, unidade_operacional_id, status')
      .eq('empresa_id', empresaId),
  ]);

  if (unitsRes.error) throw unitsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  if (regionalRes.error) throw regionalRes.error;
  return {
    units: unitsRes.data || [],
    memberships: membershipsRes.data || [],
    regionalUnitRows: regionalRes.data || [],
  };
}

async function resolverEscopoOperacional(req, options = {}) {
  const user = await loadUser(req.user?.uid);
  const empresaId = options.empresaId || req.query?.empresa_id || req.empresa_id || user?.empresa_id || null;
  const requestedUnitHeader = req.headers?.['x-operational-unit-id'];
  const requestedUnitId = options.unidadeOperacionalId
    || req.query?.unidade_operacional_id
    || (Array.isArray(requestedUnitHeader) ? requestedUnitHeader[0] : requestedUnitHeader)
    || null;
  const data = await loadScopeData(empresaId, user?.id);
  return resolveOperationalScopeState({
    user: {
      ...user,
      role: req.user?.role,
      is_super_admin: req.user?.is_super_admin === true || user?.is_super_admin === true,
    },
    empresaId,
    requestedUnitId,
    isSuperAdmin: req.user?.is_super_admin === true || user?.is_super_admin === true,
    ...data,
  });
}

function aplicarEscopoOperacionalQuery(query, scope) {
  if (!scope) return query;
  if (scope.empresa_id) query = query.eq('empresa_id', scope.empresa_id);
  if (scope.mode === 'SUPER_ADMIN' || scope.mode === 'LEGACY_COMPANY' || scope.mode === 'GLOBAL') {
    return query;
  }
  const ids = scope.allowed_unit_ids || [];
  if (!ids.length) return query.in('unidade_operacional_id', ['00000000-0000-0000-0000-000000000000']);
  if (scope.include_legacy_unscoped) {
    const unitFilter = ids.length === 1
      ? `unidade_operacional_id.eq.${ids[0]}`
      : `unidade_operacional_id.in.(${ids.join(',')})`;
    return query.or(`unidade_operacional_id.is.null,${unitFilter}`);
  }
  return query.in('unidade_operacional_id', ids);
}

async function unidadePertenceAoEscopo(req, unidadeId) {
  const scope = req.operationalScope || await resolverEscopoOperacional(req);
  return canAccessUnit(scope, unidadeId);
}

module.exports = {
  resolverEscopoOperacional,
  aplicarEscopoOperacionalQuery,
  unidadePertenceAoEscopo,
  canAccessUnit,
  deriveUnitForWrite,
};

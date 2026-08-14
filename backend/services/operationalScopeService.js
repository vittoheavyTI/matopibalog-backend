const supabase = require('../config/supabase');
const {
  resolveOperationalScopeState,
  canAccessUnit,
  canDelegateScope,
  deriveUnitForWrite,
} = require('./operationalScopeDomainService');

async function loadUser(userId) {
  if (!userId) return null;
  const query = supabase
    .from('usuarios')
    .select('id, empresa_id, tipo, status, is_super_admin')
    .eq('id', userId);
  const { data, error } = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query.single();
  if (error) throw error;
  return data || null;
}

async function loadCompany(empresaId) {
  if (!empresaId) return null;
  const query = supabase
    .from('empresas')
    .select('id, operational_scope_mode')
    .eq('id', empresaId);
  const { data, error } = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query.single();
  if (error) throw error;
  return data || null;
}

async function loadGroupCompanies(grupoId) {
  if (!grupoId) return [];
  const { data, error } = await supabase
    .from('grupo_empresarial_empresas')
    .select('grupo_id, empresa_id, status')
    .eq('grupo_id', grupoId);
  if (error) throw error;
  return data || [];
}

async function loadScopeData({ empresaId, userId, grupoId }) {
  if (!empresaId && !grupoId) {
    return { units: [], memberships: [], regionalUnitRows: [] };
  }
  const groupCompanyRows = await loadGroupCompanies(grupoId);
  const empresaIds = grupoId ? groupCompanyRows.map((row) => row.empresa_id).filter(Boolean) : [empresaId].filter(Boolean);
  const emptyUuid = '00000000-0000-0000-0000-000000000000';
  const [unitsRes, membershipsRes, regionalRes] = await Promise.all([
    supabase
      .from('unidades_operacionais')
      .select('id, empresa_id, grupo_id, nome, codigo, tipo, status, is_default')
      .in('empresa_id', empresaIds.length ? empresaIds : [emptyUuid]),
    userId
      ? supabase
        .from('usuario_operacional_memberships')
        .select('id, usuario_id, empresa_id, grupo_id, unidade_operacional_id, regiao_operacional_id, scope_level, papel, status')
        .eq('usuario_id', userId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('regiao_operacional_unidades')
      .select('regiao_id, empresa_id, unidade_operacional_id, status')
      .in('empresa_id', empresaIds.length ? empresaIds : [emptyUuid]),
  ]);

  if (unitsRes.error) throw unitsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  if (regionalRes.error) throw regionalRes.error;
  return {
    units: unitsRes.data || [],
    memberships: membershipsRes.data || [],
    regionalUnitRows: regionalRes.data || [],
    groupCompanyRows,
  };
}

async function resolverEscopoOperacional(req, options = {}) {
  const isSuperAdmin = req.user?.is_super_admin === true;
  const user = isSuperAdmin ? null : await loadUser(req.user?.uid);
  const requestedEmpresaId = options.empresaId || req.query?.empresa_id || req.body?.empresa_id || null;
  const empresaId = isSuperAdmin
    ? (requestedEmpresaId || req.empresa_id || user?.empresa_id || null)
    : (req.empresa_id || options.empresaId || user?.empresa_id || null);
  const requestedGroupHeader = req.headers?.['x-operational-group-id'];
  const requestedGroupId = req.query?.grupo_id
    || req.body?.grupo_id
    || (Array.isArray(requestedGroupHeader) ? requestedGroupHeader[0] : requestedGroupHeader)
    || null;
  const grupoId = options.grupoId || requestedGroupId;
  const requestedUnitHeader = req.headers?.['x-operational-unit-id'];
  const requestedUnitId = options.unidadeOperacionalId
    || req.query?.unidade_operacional_id
    || (Array.isArray(requestedUnitHeader) ? requestedUnitHeader[0] : requestedUnitHeader)
    || null;
  const company = await loadCompany(empresaId);
  if (!grupoId && !requestedUnitId && (company?.operational_scope_mode || 'legacy') === 'legacy') {
    return resolveOperationalScopeState({
      user: {
        ...user,
        role: req.user?.role,
        is_super_admin: req.user?.is_super_admin === true || user?.is_super_admin === true,
      },
      empresaId,
      empresaMode: 'legacy',
      requestedEmpresaId,
      isSuperAdmin: isSuperAdmin || user?.is_super_admin === true,
      units: [],
      memberships: [],
      regionalUnitRows: [],
      groupCompanyRows: [],
    });
  }
  const data = await loadScopeData({ empresaId, userId: user?.id || req.user?.uid, grupoId });
  return resolveOperationalScopeState({
    user: {
      ...user,
      role: req.user?.role,
      is_super_admin: req.user?.is_super_admin === true || user?.is_super_admin === true,
    },
    empresaId,
    grupoId,
    empresaMode: company?.operational_scope_mode || 'legacy',
    requestedEmpresaId,
    requestedUnitId,
    isSuperAdmin: isSuperAdmin || user?.is_super_admin === true,
    ...data,
  });
}

function aplicarEscopoOperacionalQuery(query, scope) {
  if (!scope) return query;
  const empresaIds = scope.authorized_empresa_ids || [];
  if (empresaIds.length > 1) query = query.in('empresa_id', empresaIds);
  else if (empresaIds.length === 1) query = query.eq('empresa_id', empresaIds[0]);
  else if (scope.empresa_id) query = query.eq('empresa_id', scope.empresa_id);

  const filterIds = scope.effective_filter_unit_ids || [];
  if (filterIds.length) {
    return query.in('unidade_operacional_id', filterIds);
  }
  if (scope.mode === 'SUPER_ADMIN' || scope.mode === 'LEGACY_COMPANY' || scope.mode === 'GLOBAL' || scope.mode === 'GLOBAL_CORPORATE') {
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

function escopoTemSelecaoInvalida(scope) {
  return Boolean(scope?.invalid_selected_unit_id);
}

async function unidadePertenceAoEscopo(req, unidadeId) {
  const scope = req.operationalScope || await resolverEscopoOperacional(req);
  return canAccessUnit(scope, unidadeId);
}

module.exports = {
  resolverEscopoOperacional,
  aplicarEscopoOperacionalQuery,
  unidadePertenceAoEscopo,
  escopoTemSelecaoInvalida,
  canAccessUnit,
  canDelegateScope,
  deriveUnitForWrite,
};

const SCOPE_LEVELS = new Set(['LOCAL', 'REGIONAL', 'GLOBAL']);
const ROLLOUT_MODES = new Set(['legacy', 'configured', 'enforced']);

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function normalizeScopeLevel(value) {
  const level = String(value || '').trim().toUpperCase();
  return SCOPE_LEVELS.has(level) ? level : null;
}

function normalizeRolloutMode(value) {
  const mode = String(value || 'legacy').trim().toLowerCase();
  return ROLLOUT_MODES.has(mode) ? mode : 'legacy';
}

function activeRows(rows) {
  return (rows || []).filter((row) => String(row?.status || 'ativo') === 'ativo');
}

function buildRegionalUnitMap(regionUnitRows) {
  const map = new Map();
  for (const row of activeRows(regionUnitRows)) {
    const regionId = row.regiao_id || row.regiao_operacional_id;
    const unitId = row.unidade_operacional_id;
    if (!regionId || !unitId) continue;
    if (!map.has(String(regionId))) map.set(String(regionId), []);
    map.get(String(regionId)).push(String(unitId));
  }
  return map;
}

function subset(candidate, allowed) {
  const allowedSet = new Set((allowed || []).map(String));
  return (candidate || []).map(String).every((id) => allowedSet.has(id));
}

function resolveOperationalScopeState({
  user,
  empresaId,
  grupoId = null,
  empresaMode = 'legacy',
  units = [],
  memberships = [],
  regionalUnitRows = [],
  groupCompanyRows = [],
  requestedUnitId = null,
  requestedEmpresaId = null,
  isSuperAdmin = false,
} = {}) {
  const effectiveEmpresaId = empresaId || user?.empresa_id || null;
  const rolloutMode = normalizeRolloutMode(empresaMode);
  const activeGroupCompanyRows = activeRows(groupCompanyRows);
  const groupEmpresaIds = unique(activeGroupCompanyRows
    .filter((row) => !grupoId || row.grupo_id === grupoId)
    .map((row) => row.empresa_id));
  const activeUnits = activeRows(units).filter((unit) => {
    if (grupoId && groupEmpresaIds.length) return groupEmpresaIds.includes(unit.empresa_id);
    return !effectiveEmpresaId || unit.empresa_id === effectiveEmpresaId;
  });
  const unitIds = unique(activeUnits.map((unit) => unit.id));
  const defaultUnit = activeUnits.find((unit) => unit.is_default === true) || null;
  const hasOperationalStructure = activeUnits.length > 0;
  const effectiveEmpresaIds = grupoId && groupEmpresaIds.length ? groupEmpresaIds : unique([effectiveEmpresaId]);

  if (isSuperAdmin || user?.is_super_admin === true) {
    const selectedUnit = requestedUnitId ? String(requestedUnitId) : null;
    const selectedAllowed = !selectedUnit || unitIds.includes(selectedUnit);
    return {
      mode: 'SUPER_ADMIN',
      empresa_id: effectiveEmpresaId,
      grupo_id: grupoId,
      rollout_mode: rolloutMode,
      scope_level: 'GLOBAL',
      authority_level: 'PLATFORM_SUPER_ADMIN',
      has_operational_structure: hasOperationalStructure,
      authorized_empresa_ids: requestedEmpresaId ? [String(requestedEmpresaId)] : effectiveEmpresaIds,
      authorized_unit_ids: unitIds,
      all_unit_ids: unitIds,
      allowed_unit_ids: unitIds,
      selected_unit_id: selectedAllowed ? selectedUnit : null,
      effective_filter_unit_ids: selectedAllowed && selectedUnit ? [selectedUnit] : [],
      invalid_selected_unit_id: selectedAllowed ? null : selectedUnit,
      default_unit_id: defaultUnit?.id || null,
      include_legacy_unscoped: true,
      can_manage_operational_structure: true,
      can_enforce_operational_scope: true,
      delegable_unit_ids: unitIds,
    };
  }

  if (!effectiveEmpresaId && !grupoId) {
    return {
      mode: 'NO_COMPANY',
      empresa_id: null,
      grupo_id: null,
      rollout_mode: 'legacy',
      scope_level: null,
      authority_level: 'NONE',
      has_operational_structure: false,
      authorized_empresa_ids: [],
      authorized_unit_ids: [],
      all_unit_ids: [],
      allowed_unit_ids: [],
      selected_unit_id: null,
      effective_filter_unit_ids: [],
      invalid_selected_unit_id: null,
      default_unit_id: null,
      include_legacy_unscoped: false,
      can_manage_operational_structure: false,
      can_enforce_operational_scope: false,
      delegable_unit_ids: [],
    };
  }

  const activeMemberships = activeRows(memberships)
    .filter((membership) => (
      (membership.empresa_id && effectiveEmpresaIds.includes(membership.empresa_id))
      || (grupoId && membership.grupo_id === grupoId && membership.empresa_id == null)
    ));

  if (rolloutMode !== 'enforced') {
    const requested = requestedUnitId ? String(requestedUnitId) : null;
    const requestedIsValid = !requested || unitIds.includes(requested);
    return {
      mode: 'LEGACY_COMPANY',
      empresa_id: effectiveEmpresaId,
      grupo_id: grupoId,
      rollout_mode: rolloutMode,
      scope_level: 'LEGACY_COMPANY',
      authority_level: user?.role === 'admin' || user?.tipo === 'admin' ? 'COMPANY_OWNER' : 'LEGACY_USER',
      has_operational_structure: hasOperationalStructure,
      authorized_empresa_ids: effectiveEmpresaIds,
      authorized_unit_ids: unitIds,
      all_unit_ids: unitIds,
      allowed_unit_ids: unitIds,
      selected_unit_id: requestedIsValid ? requested : null,
      effective_filter_unit_ids: requestedIsValid && requested ? [requested] : [],
      invalid_selected_unit_id: requestedIsValid ? null : requested,
      default_unit_id: defaultUnit?.id || null,
      include_legacy_unscoped: true,
      can_manage_operational_structure: user?.role === 'admin' || user?.tipo === 'admin',
      can_enforce_operational_scope: user?.role === 'admin' || user?.tipo === 'admin',
      delegable_unit_ids: unitIds,
    };
  }

  const regionalUnitMap = buildRegionalUnitMap(regionalUnitRows);
  const allowed = new Set();
  const authorizedEmpresaIds = new Set();
  let hasGlobal = false;
  let hasCorporateGlobal = false;
  let canManage = false;
  let canEnforce = false;
  let authorityLevel = 'NONE';

  for (const membership of activeMemberships) {
    const level = normalizeScopeLevel(membership.scope_level);
    if (!level) continue;
    if (membership.empresa_id) authorizedEmpresaIds.add(String(membership.empresa_id));
    if (membership.grupo_id && membership.empresa_id == null) {
      for (const id of groupEmpresaIds) authorizedEmpresaIds.add(String(id));
    }
    if (level === 'GLOBAL') {
      hasGlobal = true;
      if (membership.grupo_id && membership.empresa_id == null) {
        hasCorporateGlobal = true;
        for (const id of unitIds) allowed.add(id);
      } else if (membership.empresa_id) {
        for (const unit of activeUnits) {
          if (String(unit.empresa_id) === String(membership.empresa_id)) allowed.add(String(unit.id));
        }
      }
      if (membership.papel === 'admin') {
        canManage = true;
        canEnforce = true;
        authorityLevel = membership.grupo_id && membership.empresa_id == null ? 'GLOBAL_CORPORATE_ADMIN' : 'GLOBAL_COMPANY_ADMIN';
      }
    } else if (level === 'LOCAL' && membership.unidade_operacional_id) {
      allowed.add(String(membership.unidade_operacional_id));
      if (membership.papel === 'gestor' || membership.papel === 'admin') {
        canManage = true;
        if (authorityLevel === 'NONE') authorityLevel = 'LOCAL_MANAGER';
      }
    } else if (level === 'REGIONAL' && membership.regiao_operacional_id) {
      for (const id of regionalUnitMap.get(String(membership.regiao_operacional_id)) || []) {
        allowed.add(id);
      }
      if (membership.papel === 'gestor' || membership.papel === 'admin') {
        canManage = true;
        if (authorityLevel === 'NONE' || authorityLevel === 'LOCAL_MANAGER') authorityLevel = 'REGIONAL_MANAGER';
      }
    }
  }

  let allowedUnitIds = [...allowed].filter((id) => unitIds.includes(id));
  const requested = requestedUnitId ? String(requestedUnitId) : null;
  const requestedAllowed = !requested || allowedUnitIds.includes(requested);
  const effectiveFilterUnitIds = requestedAllowed && requested ? [requested] : [];
  if (requestedUnitId) {
    allowedUnitIds = requestedAllowed ? allowedUnitIds : [];
  }

  return {
    mode: hasGlobal ? (hasCorporateGlobal ? 'GLOBAL_CORPORATE' : 'GLOBAL') : (allowedUnitIds.length > 0 ? 'LIMITED' : 'NO_ACCESS'),
    empresa_id: effectiveEmpresaId,
    grupo_id: grupoId,
    rollout_mode: rolloutMode,
    scope_level: hasGlobal ? 'GLOBAL' : 'LIMITED',
    authority_level: authorityLevel,
    has_operational_structure: true,
    authorized_empresa_ids: unique([...authorizedEmpresaIds]).length ? unique([...authorizedEmpresaIds]) : effectiveEmpresaIds,
    authorized_unit_ids: allowedUnitIds,
    all_unit_ids: unitIds,
    allowed_unit_ids: allowedUnitIds,
    selected_unit_id: requestedAllowed ? requested : null,
    effective_filter_unit_ids: effectiveFilterUnitIds,
    invalid_selected_unit_id: requestedAllowed ? null : requested,
    default_unit_id: defaultUnit?.id || null,
    include_legacy_unscoped: hasGlobal || (defaultUnit && allowedUnitIds.includes(String(defaultUnit.id)) && (!requested || requested === String(defaultUnit.id))),
    can_manage_operational_structure: canManage,
    can_enforce_operational_scope: canEnforce,
    delegable_unit_ids: allowedUnitIds,
  };
}

function canAccessUnit(scope, unidadeOperacionalId) {
  if (!scope) return false;
  if (scope.mode === 'SUPER_ADMIN') return true;
  if (scope.mode === 'LEGACY_COMPANY') return true;
  if (!unidadeOperacionalId) return Boolean(scope.include_legacy_unscoped);
  return (scope.allowed_unit_ids || []).includes(String(unidadeOperacionalId));
}

function canDelegateScope(actorScope, requested = {}, regionUnitRows = []) {
  if (!actorScope || !actorScope.can_manage_operational_structure) {
    return { ok: false, reason: 'operational_admin_required' };
  }
  const level = normalizeScopeLevel(requested.scope_level);
  if (!level) return { ok: false, reason: 'invalid_scope_level' };
  if (actorScope.authority_level === 'PLATFORM_SUPER_ADMIN' || actorScope.authority_level === 'GLOBAL_COMPANY_ADMIN' || actorScope.authority_level === 'GLOBAL_CORPORATE_ADMIN' || actorScope.rollout_mode !== 'enforced') {
    return { ok: true };
  }
  if (level === 'GLOBAL') return { ok: false, reason: 'global_scope_requires_company_admin' };
  if (level === 'LOCAL') {
    return canAccessUnit(actorScope, requested.unidade_operacional_id)
      ? { ok: true }
      : { ok: false, reason: 'delegated_scope_outside_actor_scope' };
  }
  const regionId = requested.regiao_operacional_id ? String(requested.regiao_operacional_id) : null;
  const regionUnitIds = activeRows(regionUnitRows)
    .filter((row) => String(row.regiao_id || row.regiao_operacional_id) === regionId)
    .map((row) => row.unidade_operacional_id);
  if (!regionId || !regionUnitIds.length) return { ok: false, reason: 'invalid_region_scope' };
  return subset(regionUnitIds, actorScope.delegable_unit_ids)
    ? { ok: true }
    : { ok: false, reason: 'delegated_scope_outside_actor_scope' };
}

function deriveUnitForWrite({ scope, requestedUnitId = null, motoristaUnitId = null } = {}) {
  if (!scope || scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
    return { ok: false, reason: 'operational_scope_denied' };
  }
  const requested = requestedUnitId ? String(requestedUnitId) : null;
  const motoristaUnit = motoristaUnitId ? String(motoristaUnitId) : null;

  if (requested) {
    return canAccessUnit(scope, requested)
      ? { ok: true, unidade_operacional_id: requested }
      : { ok: false, reason: 'operational_unit_forbidden' };
  }
  if (motoristaUnit && canAccessUnit(scope, motoristaUnit)) {
    return { ok: true, unidade_operacional_id: motoristaUnit };
  }
  if (scope.mode === 'LEGACY_COMPANY' || !scope.has_operational_structure) {
    return { ok: true, unidade_operacional_id: null };
  }
  if (scope.default_unit_id && canAccessUnit(scope, scope.default_unit_id)) {
    return { ok: true, unidade_operacional_id: scope.default_unit_id };
  }
  return { ok: false, reason: 'operational_unit_required' };
}

module.exports = {
  normalizeScopeLevel,
  normalizeRolloutMode,
  resolveOperationalScopeState,
  canAccessUnit,
  canDelegateScope,
  deriveUnitForWrite,
};

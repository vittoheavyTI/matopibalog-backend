const SCOPE_LEVELS = new Set(['LOCAL', 'REGIONAL', 'GLOBAL']);

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function normalizeScopeLevel(value) {
  const level = String(value || '').trim().toUpperCase();
  return SCOPE_LEVELS.has(level) ? level : null;
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

function resolveOperationalScopeState({
  user,
  empresaId,
  units = [],
  memberships = [],
  regionalUnitRows = [],
  requestedUnitId = null,
  isSuperAdmin = false,
} = {}) {
  const effectiveEmpresaId = empresaId || user?.empresa_id || null;
  const activeUnits = activeRows(units).filter((unit) => !effectiveEmpresaId || unit.empresa_id === effectiveEmpresaId);
  const unitIds = unique(activeUnits.map((unit) => unit.id));
  const defaultUnit = activeUnits.find((unit) => unit.is_default === true) || null;
  const hasOperationalStructure = activeUnits.length > 0;

  if (isSuperAdmin || user?.is_super_admin === true) {
    return {
      mode: 'SUPER_ADMIN',
      empresa_id: effectiveEmpresaId,
      scope_level: 'GLOBAL',
      has_operational_structure: hasOperationalStructure,
      all_unit_ids: unitIds,
      allowed_unit_ids: requestedUnitId ? [String(requestedUnitId)] : unitIds,
      default_unit_id: defaultUnit?.id || null,
      include_legacy_unscoped: true,
      can_manage_operational_structure: true,
    };
  }

  if (!effectiveEmpresaId) {
    return {
      mode: 'NO_COMPANY',
      empresa_id: null,
      scope_level: null,
      has_operational_structure: false,
      all_unit_ids: [],
      allowed_unit_ids: [],
      default_unit_id: null,
      include_legacy_unscoped: false,
      can_manage_operational_structure: false,
    };
  }

  const activeMemberships = activeRows(memberships)
    .filter((membership) => membership.empresa_id === effectiveEmpresaId);

  if (!hasOperationalStructure) {
    return {
      mode: 'LEGACY_COMPANY',
      empresa_id: effectiveEmpresaId,
      scope_level: 'LEGACY_COMPANY',
      has_operational_structure: false,
      all_unit_ids: [],
      allowed_unit_ids: [],
      default_unit_id: null,
      include_legacy_unscoped: true,
      can_manage_operational_structure: user?.role === 'admin' || user?.tipo === 'admin',
    };
  }

  const regionalUnitMap = buildRegionalUnitMap(regionalUnitRows);
  const allowed = new Set();
  let hasGlobal = false;
  let canManage = false;

  for (const membership of activeMemberships) {
    const level = normalizeScopeLevel(membership.scope_level);
    if (!level) continue;
    if (membership.papel === 'admin' || membership.papel === 'gestor') canManage = true;
    if (level === 'GLOBAL') {
      hasGlobal = true;
      for (const id of unitIds) allowed.add(id);
    } else if (level === 'LOCAL' && membership.unidade_operacional_id) {
      allowed.add(String(membership.unidade_operacional_id));
    } else if (level === 'REGIONAL' && membership.regiao_operacional_id) {
      for (const id of regionalUnitMap.get(String(membership.regiao_operacional_id)) || []) {
        allowed.add(id);
      }
    }
  }

  let allowedUnitIds = [...allowed].filter((id) => unitIds.includes(id));
  if (requestedUnitId) {
    const requested = String(requestedUnitId);
    allowedUnitIds = allowedUnitIds.includes(requested) ? [requested] : [];
  }

  return {
    mode: hasGlobal ? 'GLOBAL' : (allowedUnitIds.length > 0 ? 'LIMITED' : 'NO_ACCESS'),
    empresa_id: effectiveEmpresaId,
    scope_level: hasGlobal ? 'GLOBAL' : 'LIMITED',
    has_operational_structure: true,
    all_unit_ids: unitIds,
    allowed_unit_ids: allowedUnitIds,
    default_unit_id: defaultUnit?.id || null,
    include_legacy_unscoped: hasGlobal || (defaultUnit && allowedUnitIds.includes(String(defaultUnit.id))),
    can_manage_operational_structure: canManage,
  };
}

function canAccessUnit(scope, unidadeOperacionalId) {
  if (!scope) return false;
  if (scope.mode === 'SUPER_ADMIN') return true;
  if (scope.mode === 'LEGACY_COMPANY') return unidadeOperacionalId == null;
  if (!unidadeOperacionalId) return Boolean(scope.include_legacy_unscoped);
  return (scope.allowed_unit_ids || []).includes(String(unidadeOperacionalId));
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
  resolveOperationalScopeState,
  canAccessUnit,
  deriveUnitForWrite,
};

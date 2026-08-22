'use strict';

const {
  canAccessUnit,
  deriveUnitForWrite,
} = require('../operationalScopeDomainService');

const ASSET_TYPES = Object.freeze(['truck', 'tractor', 'semitrailer', 'trailer', 'dolly', 'implement', 'other']);
const ASSET_STATUS = Object.freeze(['active', 'inactive', 'maintenance', 'sold', 'archived']);
const COMPOSITION_STATUS = Object.freeze(['active', 'inactive', 'archived']);
const MEMBER_ROLES = Object.freeze(['primary_power', 'trailer', 'dolly', 'implement', 'accessory']);

class FleetError extends Error {
  constructor(status, message, code = 'fleet_error') {
    super(message);
    this.name = 'FleetError';
    this.status = status;
    this.code = code;
  }
}

function text(value) {
  if (value === undefined || value === null) return null;
  const out = String(value).trim();
  return out || null;
}

function normalizedPlate(value) {
  const out = text(value);
  return out ? out.toUpperCase().replace(/\s+/g, '') : null;
}

function sanitizeSearchFilter(value) {
  const out = text(value);
  return out ? out.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

function finiteNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new FleetError(422, `${field} inválido.`, 'invalid_number');
  return n;
}

function positiveInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new FleetError(422, `${field} inválido.`, 'invalid_integer');
  return n;
}

function enumValue(value, allowed, field, fallback = null) {
  const out = text(value) || fallback;
  if (!out || !allowed.includes(out)) throw new FleetError(422, `${field} inválido.`, 'invalid_enum');
  return out;
}

function metadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new FleetError(422, 'metadata inválido.', 'invalid_metadata');
  return value;
}

function requireEmpresa(empresaId) {
  if (!empresaId) throw new FleetError(400, 'empresa_id obrigatório.', 'missing_empresa');
}

function actorId(user) {
  return user?.uid || user?.id || null;
}

function buildAssetPayload(input, { partial = false } = {}) {
  const payload = {};
  const assetType = input.asset_type ?? input.tipo;
  const internalIdentifier = input.internal_identifier ?? input.identificador_interno;

  if (!partial || assetType !== undefined) payload.asset_type = enumValue(assetType, ASSET_TYPES, 'asset_type');
  if (!partial || internalIdentifier !== undefined) {
    const id = text(internalIdentifier);
    if (!id) throw new FleetError(422, 'internal_identifier obrigatório.', 'missing_identifier');
    payload.internal_identifier = id;
  }
  if (!partial || input.plate !== undefined || input.placa !== undefined) payload.plate = normalizedPlate(input.plate ?? input.placa);
  if (!partial || input.brand !== undefined || input.marca !== undefined) payload.brand = text(input.brand ?? input.marca);
  if (!partial || input.model !== undefined || input.modelo !== undefined) payload.model = text(input.model ?? input.modelo);
  if (!partial || input.model_year !== undefined || input.ano !== undefined) payload.model_year = positiveInteger(input.model_year ?? input.ano, 'model_year');
  if (!partial || input.status !== undefined) payload.status = enumValue(input.status, ASSET_STATUS, 'status', 'active');
  if (!partial || input.useful_capacity_kg !== undefined) payload.useful_capacity_kg = finiteNumber(input.useful_capacity_kg, 'useful_capacity_kg');
  if (!partial || input.metadata !== undefined) payload.metadata = metadata(input.metadata);
  if (!partial || input.unidade_operacional_id !== undefined) payload.unidade_operacional_id = text(input.unidade_operacional_id);

  return payload;
}

function buildCompositionPayload(input, { partial = false } = {}) {
  const payload = {};
  if (!partial || input.code !== undefined || input.codigo !== undefined) {
    const code = text(input.code ?? input.codigo);
    if (!code) throw new FleetError(422, 'code obrigatório.', 'missing_code');
    payload.code = code;
  }
  if (!partial || input.name !== undefined || input.nome !== undefined) payload.name = text(input.name ?? input.nome);
  if (!partial || input.status !== undefined) payload.status = enumValue(input.status, COMPOSITION_STATUS, 'status', 'active');
  if (!partial || input.metadata !== undefined) payload.metadata = metadata(input.metadata);
  if (!partial || input.unidade_operacional_id !== undefined) payload.unidade_operacional_id = text(input.unidade_operacional_id);
  return payload;
}

function targetPayload(input) {
  const assetId = text(input.asset_id);
  const compositionId = text(input.composition_id);
  if ((assetId && compositionId) || (!assetId && !compositionId)) {
    throw new FleetError(422, 'Informe exatamente um alvo: asset_id ou composition_id.', 'invalid_target');
  }
  return { asset_id: assetId, composition_id: compositionId };
}

function ensureUnitAccess(scope, unitId) {
  if (!canAccessUnit(scope, unitId || null)) {
    throw new FleetError(403, 'Unidade operacional fora do escopo.', 'operational_scope_denied');
  }
}

function deriveScopedUnit(scope, requestedUnitId) {
  const decision = deriveUnitForWrite({ scope, requestedUnitId });
  if (!decision.ok) {
    throw new FleetError(403, 'Unidade operacional nao autorizada para frota.', decision.reason || 'operational_scope_denied');
  }
  return decision.unidade_operacional_id;
}

function applyOperationalScope(query, scope) {
  if (!scope) return query;
  const empresaIds = scope.authorized_empresa_ids || [];
  if (empresaIds.length > 1) query = query.in('empresa_id', empresaIds);
  else if (empresaIds.length === 1) query = query.eq('empresa_id', empresaIds[0]);

  const filterIds = scope.effective_filter_unit_ids || [];
  if (filterIds.length) return query.in('unidade_operacional_id', filterIds);
  if (['SUPER_ADMIN', 'LEGACY_COMPANY', 'GLOBAL', 'GLOBAL_CORPORATE'].includes(scope.mode)) return query;

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

async function oneByEmpresa(supabase, table, empresaId, id, columns = 'id, empresa_id') {
  const { data, error } = await supabase.from(table).select(columns).eq('id', id).eq('empresa_id', empresaId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function requireByEmpresa(supabase, table, empresaId, id, code) {
  const row = await oneByEmpresa(supabase, table, empresaId, id, 'id, empresa_id, unidade_operacional_id');
  if (!row) throw new FleetError(404, `${code} não encontrado no tenant.`, `${code}_not_found`);
  return row;
}

async function requireDriver(supabase, empresaId, driverId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, empresa_id, tipo, status')
    .eq('id', driverId)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError(404, 'Motorista não encontrado no tenant.', 'driver_not_found');
  return data;
}

async function requireTarget(supabase, empresaId, target) {
  if (target.asset_id) return requireByEmpresa(supabase, 'fleet_assets', empresaId, target.asset_id, 'asset');
  return requireByEmpresa(supabase, 'vehicle_compositions', empresaId, target.composition_id, 'composition');
}

async function listAssets(supabase, { empresaId, query = {}, operationalScope = null }) {
  requireEmpresa(empresaId);
  let q = supabase.from('fleet_assets').select('*');
  q = applyOperationalScope(q, operationalScope).eq('empresa_id', empresaId).order('created_at', { ascending: false });
  if (query.status) q = q.eq('status', query.status);
  if (query.asset_type) q = q.eq('asset_type', query.asset_type);
  const search = sanitizeSearchFilter(query.q);
  if (search) q = q.or(`plate.ilike.%${search}%,internal_identifier.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createAsset(supabase, { empresaId, user, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const payload = { ...buildAssetPayload(body), empresa_id: empresaId, created_by: actorId(user), updated_by: actorId(user) };
  payload.unidade_operacional_id = deriveScopedUnit(operationalScope, payload.unidade_operacional_id);
  const { data, error } = await supabase.from('fleet_assets').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function updateAsset(supabase, { empresaId, user, id, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const current = await requireByEmpresa(supabase, 'fleet_assets', empresaId, id, 'asset');
  ensureUnitAccess(operationalScope, current.unidade_operacional_id);
  const payload = { ...buildAssetPayload(body, { partial: true }), updated_by: actorId(user), updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(payload, 'unidade_operacional_id')) {
    payload.unidade_operacional_id = deriveScopedUnit(operationalScope, payload.unidade_operacional_id);
  }
  const { data, error } = await supabase.from('fleet_assets').update(payload).eq('id', id).eq('empresa_id', empresaId).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError(404, 'Ativo não encontrado no tenant.', 'asset_not_found');
  return data;
}

async function listCompositions(supabase, { empresaId, operationalScope = null }) {
  requireEmpresa(empresaId);
  let q = supabase
    .from('vehicle_compositions')
    .select('*, vehicle_composition_members(*)')
    .eq('empresa_id', empresaId);
  q = applyOperationalScope(q, operationalScope).order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createComposition(supabase, { empresaId, user, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const payload = { ...buildCompositionPayload(body), empresa_id: empresaId, created_by: actorId(user), updated_by: actorId(user) };
  payload.unidade_operacional_id = deriveScopedUnit(operationalScope, payload.unidade_operacional_id);
  const { data, error } = await supabase.from('vehicle_compositions').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function addCompositionMember(supabase, { empresaId, user, compositionId, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const composition = await requireByEmpresa(supabase, 'vehicle_compositions', empresaId, compositionId, 'composition');
  ensureUnitAccess(operationalScope, composition.unidade_operacional_id);
  const assetId = text(body.asset_id);
  if (!assetId) throw new FleetError(422, 'asset_id obrigatório.', 'missing_asset');
  const asset = await requireByEmpresa(supabase, 'fleet_assets', empresaId, assetId, 'asset');
  ensureUnitAccess(operationalScope, asset.unidade_operacional_id);

  const payload = {
    empresa_id: empresaId,
    composition_id: compositionId,
    asset_id: assetId,
    member_role: enumValue(body.member_role, MEMBER_ROLES, 'member_role'),
    position_order: positiveInteger(body.position_order ?? 1, 'position_order') || 1,
    position_label: text(body.position_label),
    valid_from: text(body.valid_from) || new Date().toISOString(),
    created_by: actorId(user),
  };
  const { data, error } = await supabase.from('vehicle_composition_members').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function endCompositionMember(supabase, { empresaId, memberId, body = {}, operationalScope = null }) {
  requireEmpresa(empresaId);
  const current = await oneByEmpresa(supabase, 'vehicle_composition_members', empresaId, memberId, 'id, empresa_id, composition_id');
  if (!current) throw new FleetError(404, 'Membro de composição não encontrado no tenant.', 'member_not_found');
  const composition = await requireByEmpresa(supabase, 'vehicle_compositions', empresaId, current.composition_id, 'composition');
  ensureUnitAccess(operationalScope, composition.unidade_operacional_id);
  const payload = {
    valid_until: text(body.valid_until) || new Date().toISOString(),
    ended_reason: text(body.ended_reason),
  };
  const { data, error } = await supabase
    .from('vehicle_composition_members')
    .update(payload)
    .eq('id', memberId)
    .eq('empresa_id', empresaId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createDriverAssignment(supabase, { empresaId, user, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const driverId = text(body.driver_id);
  if (!driverId) throw new FleetError(422, 'driver_id obrigatório.', 'missing_driver');
  await requireDriver(supabase, empresaId, driverId);
  const target = targetPayload(body);
  const targetRow = await requireTarget(supabase, empresaId, target);
  ensureUnitAccess(operationalScope, targetRow.unidade_operacional_id);

  const payload = {
    empresa_id: empresaId,
    driver_id: driverId,
    ...target,
    valid_from: text(body.valid_from) || new Date().toISOString(),
    created_by: actorId(user),
  };
  const { data, error } = await supabase.from('driver_vehicle_assignments').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function endDriverAssignment(supabase, { empresaId, assignmentId, body = {}, operationalScope = null }) {
  requireEmpresa(empresaId);
  const current = await oneByEmpresa(supabase, 'driver_vehicle_assignments', empresaId, assignmentId, 'id, empresa_id, asset_id, composition_id');
  if (!current) throw new FleetError(404, 'Vínculo de motorista não encontrado no tenant.', 'assignment_not_found');
  const targetRow = await requireTarget(supabase, empresaId, targetPayload(current));
  ensureUnitAccess(operationalScope, targetRow.unidade_operacional_id);
  const { data, error } = await supabase
    .from('driver_vehicle_assignments')
    .update({ assignment_status: 'ended', valid_until: text(body.valid_until) || new Date().toISOString(), ended_reason: text(body.ended_reason) })
    .eq('id', assignmentId)
    .eq('empresa_id', empresaId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createFreightAssignment(supabase, { empresaId, user, body, operationalScope = null }) {
  requireEmpresa(empresaId);
  const freteId = text(body.frete_id);
  if (!freteId) throw new FleetError(422, 'frete_id obrigatório.', 'missing_frete');
  const frete = await requireByEmpresa(supabase, 'fretes', empresaId, freteId, 'frete');
  ensureUnitAccess(operationalScope, frete.unidade_operacional_id);
  const target = targetPayload(body);
  const targetRow = await requireTarget(supabase, empresaId, target);
  ensureUnitAccess(operationalScope, targetRow.unidade_operacional_id);
  if (body.primary_driver_id) await requireDriver(supabase, empresaId, body.primary_driver_id);
  if (body.secondary_driver_id) await requireDriver(supabase, empresaId, body.secondary_driver_id);

  const payload = {
    empresa_id: empresaId,
    frete_id: freteId,
    ...target,
    primary_driver_id: text(body.primary_driver_id),
    secondary_driver_id: text(body.secondary_driver_id),
    assigned_from: text(body.assigned_from) || new Date().toISOString(),
    reason: text(body.reason),
    metadata: metadata(body.metadata),
    created_by: actorId(user),
  };
  const { data, error } = await supabase.from('freight_vehicle_assignments').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

module.exports = {
  ASSET_TYPES,
  ASSET_STATUS,
  COMPOSITION_STATUS,
  MEMBER_ROLES,
  FleetError,
  buildAssetPayload,
  buildCompositionPayload,
  targetPayload,
  listAssets,
  createAsset,
  updateAsset,
  listCompositions,
  createComposition,
  addCompositionMember,
  endCompositionMember,
  createDriverAssignment,
  endDriverAssignment,
  createFreightAssignment,
};

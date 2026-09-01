'use strict';

const { canAccessUnit } = require('../operationalScopeDomainService');
const { createSupabaseDiagnosticFacts } = require('../verifiability/diagnosticFacts');
const { createDefaultInvariantRegistry } = require('../verifiability/defaultInvariants');
const { verifyTarget } = require('../verifiability/verifier');

const RULES_VERSION = 'campaign-a.deterministic-greedy.v1';
const QUANTITY_UNITS = new Set(['kg', 'ton', 'tonelada']);
const LOCATION_KINDS = new Set(['origin', 'destination']);
const LOCATION_TYPES = new Set(['operational', 'farm', 'warehouse', 'customer', 'other']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

class CampaignError extends Error {
  constructor(message, { status = 400, code = 'campaign_error', details = null } = {}) {
    super(message);
    this.name = 'CampaignError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function requiredText(value, field) {
  const text = trim(value);
  if (!text) throw new CampaignError(`Campo obrigatorio: ${field}.`, { code: 'missing_field', details: { field } });
  return text;
}

function optionalText(value) {
  const text = trim(value);
  return text || null;
}

function finiteNumber(value, field, { min = null } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || (min !== null && n < min)) {
    throw new CampaignError(`Numero invalido: ${field}.`, { code: 'invalid_number', details: { field } });
  }
  return n;
}

function normalizeQuantityUnit(value, field = 'quantity_unit') {
  const unit = String(value || '').trim().toLowerCase();
  if (!QUANTITY_UNITS.has(unit)) {
    throw new CampaignError(`Unidade invalida: ${field}.`, { code: 'invalid_quantity_unit', details: { field } });
  }
  return unit;
}

function toKg(quantity, unit) {
  const n = finiteNumber(quantity, 'quantity', { min: 0 }) || 0;
  const normalized = normalizeQuantityUnit(unit);
  return normalized === 'kg' ? n : n * 1000;
}

function fromKg(quantityKg, unit) {
  const n = finiteNumber(quantityKg, 'quantity_kg', { min: 0 }) || 0;
  const normalized = normalizeQuantityUnit(unit);
  return normalized === 'kg' ? n : n / 1000;
}

function assertScope(scope) {
  if (!scope || scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
    throw new CampaignError('Escopo operacional nao autorizado.', { status: 403, code: 'operational_scope_denied' });
  }
}

function uniqueIds(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function requireUnitsWithinScope(operationalScope, unidadeIds, { requireAny = false } = {}) {
  assertScope(operationalScope);
  const ids = uniqueIds(unidadeIds);
  if (requireAny && ids.length === 0 && operationalScope.has_operational_structure) {
    throw new CampaignError('Informe ao menos uma unidade operacional da campanha.', { code: 'missing_operational_unit' });
  }
  const forbidden = ids.filter((id) => !canAccessUnit(operationalScope, id));
  if (forbidden.length) {
    throw new CampaignError('Unidade operacional fora do seu escopo.', {
      status: 403,
      code: 'operational_unit_forbidden',
      details: { unidade_operacional_ids: forbidden },
    });
  }
  return ids;
}

function databaseError(error) {
  if (!error) return null;
  if (error.code === '23505') return new CampaignError('Registro duplicado para esta campanha.', { status: 409, code: 'campaign_conflict' });
  if (error.code === '23503') return new CampaignError('Referencia invalida para esta campanha.', { status: 422, code: 'campaign_reference_not_found' });
  if (error.code === '42501') return new CampaignError('Acesso negado pela politica de seguranca.', { status: 403, code: 'campaign_rls_denied' });
  return new CampaignError('Erro de banco ao processar campanha.', { status: 500, code: 'campaign_database_error', details: { db_code: error.code, message: error.message } });
}

function throwDb(error) {
  if (error) throw databaseError(error);
}

function userId(user) {
  return user?.uid || user?.id || null;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildCampaignPayload({ empresaId, user, body = {}, correlation = {} }) {
  const priority = String(body.priority || 'normal').trim().toLowerCase();
  if (!PRIORITIES.has(priority)) throw new CampaignError('Prioridade invalida.', { code: 'invalid_priority' });
  return {
    empresa_id: empresaId,
    reference_code: requiredText(body.reference_code || body.referenceCode, 'reference_code'),
    name: requiredText(body.name, 'name'),
    description: optionalText(body.description),
    cargo_name: requiredText(body.cargo_name || body.cargoName, 'cargo_name'),
    priority,
    planned_start: body.planned_start || body.plannedStart || null,
    planned_end: body.planned_end || body.plannedEnd || null,
    timezone: optionalText(body.timezone) || 'America/Sao_Paulo',
    created_by: userId(user),
    updated_by: userId(user),
    client_request_id: optionalText(body.client_request_id || body.clientRequestId),
    source: optionalText(body.source) || 'web',
    request_id: correlation.request_id || null,
    correlation_id: correlation.correlation_id || null,
    metadata: normalizeMetadata(body.metadata),
  };
}

function normalizeLocationInput(input = {}) {
  const kind = String(input.kind || '').trim().toLowerCase();
  const locationType = String(input.location_type || input.locationType || 'operational').trim().toLowerCase();
  if (!LOCATION_KINDS.has(kind)) throw new CampaignError('Tipo de local invalido.', { code: 'invalid_location_kind' });
  if (!LOCATION_TYPES.has(locationType)) throw new CampaignError('Categoria de local invalida.', { code: 'invalid_location_type' });
  return {
    kind,
    name: requiredText(input.name, 'location.name'),
    location_type: locationType,
    unidade_operacional_id: input.unidade_operacional_id || input.operational_unit_id || null,
    address_text: optionalText(input.address_text || input.addressText),
    latitude: finiteNumber(input.latitude, 'latitude', { min: -90 }),
    longitude: finiteNumber(input.longitude, 'longitude', { min: -180 }),
    time_window_start: input.time_window_start || input.timeWindowStart || null,
    time_window_end: input.time_window_end || input.timeWindowEnd || null,
    target_quantity: finiteNumber(input.target_quantity || input.targetQuantity, 'target_quantity', { min: 0 }),
    quantity_unit: input.quantity_unit || input.quantityUnit ? normalizeQuantityUnit(input.quantity_unit || input.quantityUnit) : null,
    priority: Math.trunc(finiteNumber(input.priority ?? 100, 'priority', { min: 0 }) ?? 100),
    constraints: normalizeMetadata(input.constraints),
  };
}

function normalizeDemandInput(input = {}, campaign = {}) {
  const unit = normalizeQuantityUnit(input.quantity_unit || input.quantityUnit || 'ton');
  return {
    origin_location_id: requiredText(input.origin_location_id || input.originLocationId, 'origin_location_id'),
    destination_location_id: requiredText(input.destination_location_id || input.destinationLocationId, 'destination_location_id'),
    cargo_name: requiredText(input.cargo_name || input.cargoName || campaign.cargo_name, 'cargo_name'),
    target_quantity: finiteNumber(input.target_quantity || input.targetQuantity, 'target_quantity', { min: 0 }) ?? 0,
    quantity_unit: unit,
    metadata: normalizeMetadata(input.metadata),
  };
}

function capacityFromMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return null;
  for (const key of ['usable_capacity_kg', 'useful_capacity_kg', 'capacity_kg']) {
    const value = finiteNumber(metadata[key], key, { min: 0 });
    if (value && value > 0) return value;
  }
  return null;
}

function buildResourceCandidates({ assets = [], compositions = [], assignments = [], maintenance = [], documents = [], unitIds = [] } = {}) {
  const allowed = new Set((unitIds || []).map(String));
  const filterUnit = (row) => !allowed.size || !row.unidade_operacional_id || allowed.has(String(row.unidade_operacional_id));
  const activeAssignments = (assignments || []).filter((row) => row.assignment_status === 'active' && !row.valid_until);
  const assignmentByAsset = new Map(activeAssignments.filter((row) => row.asset_id).map((row) => [row.asset_id, row]));
  const assignmentByComposition = new Map(activeAssignments.filter((row) => row.composition_id).map((row) => [row.composition_id, row]));
  const maintenanceTargets = new Set((maintenance || [])
    .filter((row) => !['completed', 'cancelled'].includes(String(row.status || '').toLowerCase()))
    .flatMap((row) => [row.asset_id, row.composition_id].filter(Boolean)));
  const documentBlocks = new Set((documents || [])
    .filter((row) => String(row.status || 'ativo') === 'ativo' && row.validade && new Date(row.validade).getTime() < Date.now())
    .map((row) => row.asset_id).filter(Boolean));

  const assetCandidates = (assets || [])
    .filter((asset) => String(asset.status || 'active') === 'active' && filterUnit(asset))
    .map((asset) => {
      const capacityKg = finiteNumber(asset.useful_capacity_kg, 'useful_capacity_kg', { min: 0 }) || capacityFromMetadata(asset.metadata) || 0;
      const assignment = assignmentByAsset.get(asset.id);
      return {
        type: 'asset',
        id: asset.id,
        asset_id: asset.id,
        composition_id: null,
        driver_id: assignment?.driver_id || null,
        unidade_operacional_id: asset.unidade_operacional_id || null,
        capacity_kg: capacityKg,
        warnings: [
          ...(assignment ? [] : ['NO_DRIVER']),
          ...(maintenanceTargets.has(asset.id) ? ['MAINTENANCE_CONFLICT'] : []),
          ...(documentBlocks.has(asset.id) ? ['DOCUMENT_BLOCK'] : []),
        ],
      };
    });

  const compositionCandidates = (compositions || [])
    .filter((composition) => String(composition.status || 'active') === 'active' && filterUnit(composition))
    .map((composition) => {
      const capacityKg = capacityFromMetadata(composition.metadata) || 0;
      const assignment = assignmentByComposition.get(composition.id);
      return {
        type: 'composition',
        id: composition.id,
        asset_id: null,
        composition_id: composition.id,
        driver_id: assignment?.driver_id || null,
        unidade_operacional_id: composition.unidade_operacional_id || null,
        capacity_kg: capacityKg,
        warnings: [
          ...(assignment ? [] : ['NO_DRIVER']),
          ...(maintenanceTargets.has(composition.id) ? ['MAINTENANCE_CONFLICT'] : []),
        ],
      };
    });

  return [...compositionCandidates, ...assetCandidates]
    .filter((candidate) => candidate.capacity_kg > 0)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'composition' ? -1 : 1;
      if (b.capacity_kg !== a.capacity_kg) return b.capacity_kg - a.capacity_kg;
      return String(a.id).localeCompare(String(b.id));
    });
}

function planCampaign({ campaign, locations = [], demands = [], resources = [] } = {}) {
  const sortedDemands = [...(demands || [])].sort((a, b) => {
    const originA = locations.find((l) => l.id === a.origin_location_id) || {};
    const originB = locations.find((l) => l.id === b.origin_location_id) || {};
    if ((originA.priority || 100) !== (originB.priority || 100)) return (originA.priority || 100) - (originB.priority || 100);
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const plannedTrips = [];
  const exceptions = [];
  const resourceUsage = new Map(resources.map((resource) => [resource.id, 0]));
  let cursor = 0;

  for (const demand of sortedDemands) {
    const totalKg = toKg(demand.target_quantity, demand.quantity_unit);
    let remainingKg = totalKg;
    if (!resources.length && totalKg > 0) {
      exceptions.push({
        exception_type: 'INSUFFICIENT_CAPACITY',
        severity: 'HARD_CONSTRAINT',
        evidence: { demand_id: demand.id, required_capacity_kg: totalKg },
      });
      plannedTrips.push({
        demand_id: demand.id || null,
        origin_location_id: demand.origin_location_id,
        destination_location_id: demand.destination_location_id,
        planned_quantity: 0,
        quantity_unit: demand.quantity_unit,
        required_capacity_kg: totalKg,
        candidate_asset_id: null,
        candidate_composition_id: null,
        candidate_driver_id: null,
        status: 'BLOCKED',
        constraint_metadata: { reason: 'INSUFFICIENT_CAPACITY' },
      });
      continue;
    }

    while (remainingKg > 0) {
      const resource = resources[cursor % resources.length];
      cursor += 1;
      const allocatedKg = Math.min(remainingKg, resource.capacity_kg);
      remainingKg = Math.max(0, remainingKg - allocatedKg);
      resourceUsage.set(resource.id, (resourceUsage.get(resource.id) || 0) + allocatedKg);
      for (const warning of resource.warnings || []) {
        exceptions.push({
          exception_type: warning,
          severity: 'WARNING',
          evidence: { demand_id: demand.id, resource_type: resource.type, resource_id: resource.id },
        });
      }
      plannedTrips.push({
        demand_id: demand.id || null,
        origin_location_id: demand.origin_location_id,
        destination_location_id: demand.destination_location_id,
        planned_quantity: fromKg(allocatedKg, demand.quantity_unit),
        quantity_unit: demand.quantity_unit,
        required_capacity_kg: allocatedKg,
        candidate_asset_id: resource.asset_id,
        candidate_composition_id: resource.composition_id,
        candidate_driver_id: resource.driver_id,
        status: 'PLANNED',
        constraint_metadata: {
          resource_type: resource.type,
          resource_capacity_kg: resource.capacity_kg,
        },
      });
    }
  }

  const hardExceptions = exceptions.filter((item) => item.severity === 'HARD_CONSTRAINT').length;
  const warningExceptions = exceptions.filter((item) => item.severity === 'WARNING').length;
  return {
    rules_version: RULES_VERSION,
    plannedTrips,
    exceptions,
    scenario: {
      scenario_key: 'own_capacity_only',
      label: 'Capacidade propria',
      strategy: 'deterministic_greedy_planner',
      capacity_gap_quantity: hardExceptions ? sortedDemands.reduce((sum, d) => sum + Number(d.target_quantity || 0), 0) : 0,
      capacity_gap_trips: hardExceptions,
      warnings: exceptions.filter((item) => item.severity !== 'HARD_CONSTRAINT').map((item) => item.exception_type),
      score_metadata: { resource_usage_kg: Object.fromEntries(resourceUsage) },
    },
    summary: {
      campaign_id: campaign?.id || null,
      demands: sortedDemands.length,
      resources: resources.length,
      planned_trips: plannedTrips.filter((trip) => trip.status === 'PLANNED').length,
      blocked_trips: plannedTrips.filter((trip) => trip.status === 'BLOCKED').length,
      hard_exceptions: hardExceptions,
      warning_exceptions: warningExceptions,
      total_required_capacity_kg: sortedDemands.reduce((sum, d) => sum + toKg(d.target_quantity, d.quantity_unit), 0),
    },
  };
}

async function listCampaigns(supabase, { empresaId, operationalScope = null } = {}) {
  assertScope(operationalScope);
  const { data, error } = await supabase
    .from('operation_campaigns')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false });
  throwDb(error);
  const items = data || [];
  if (operationalScope.mode === 'LEGACY_COMPANY' || operationalScope.mode === 'SUPER_ADMIN') return items;
  const { data: units, error: unitsError } = await supabase
    .from('campaign_operational_units')
    .select('campaign_id, unidade_operacional_id')
    .eq('empresa_id', empresaId);
  throwDb(unitsError);
  const allowed = new Set((operationalScope.allowed_unit_ids || []).map(String));
  const visible = new Set((units || []).filter((row) => allowed.has(String(row.unidade_operacional_id))).map((row) => row.campaign_id));
  return items.filter((item) => visible.has(item.id));
}

async function getCampaign(supabase, { empresaId, campaignId, operationalScope = null }) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  const [unitsRes, locationsRes, demandsRes, plansRes] = await Promise.all([
    supabase.from('campaign_operational_units').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_locations').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId).order('priority', { ascending: true }),
    supabase.from('campaign_demands').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_plan_versions').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId).order('version_number', { ascending: false }),
  ]);
  for (const result of [unitsRes, locationsRes, demandsRes, plansRes]) throwDb(result.error);
  return {
    campaign,
    operational_units: unitsRes.data || [],
    locations: locationsRes.data || [],
    demands: demandsRes.data || [],
    plans: plansRes.data || [],
  };
}

async function requireCampaign(supabase, { empresaId, campaignId, operationalScope = null }) {
  assertScope(operationalScope);
  const { data, error } = await supabase
    .from('operation_campaigns')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .maybeSingle();
  throwDb(error);
  if (!data) throw new CampaignError('Campanha nao encontrada.', { status: 404, code: 'campaign_not_found' });
  await assertCampaignScope(supabase, { empresaId, campaignId, operationalScope });
  return data;
}

async function updateDraft(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null }) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  if (!['DRAFT', 'PLANNING'].includes(campaign.status)) {
    throw new CampaignError('Campanha so pode ser editada antes da revisao.', { status: 409, code: 'campaign_locked' });
  }
  const payload = {};
  if (body.reference_code !== undefined || body.referenceCode !== undefined) payload.reference_code = requiredText(body.reference_code || body.referenceCode, 'reference_code');
  if (body.name !== undefined) payload.name = requiredText(body.name, 'name');
  if (body.description !== undefined) payload.description = optionalText(body.description);
  if (body.cargo_name !== undefined || body.cargoName !== undefined) payload.cargo_name = requiredText(body.cargo_name || body.cargoName, 'cargo_name');
  if (body.priority !== undefined) {
    const priority = String(body.priority || '').trim().toLowerCase();
    if (!PRIORITIES.has(priority)) throw new CampaignError('Prioridade invalida.', { code: 'invalid_priority' });
    payload.priority = priority;
  }
  if (body.planned_start !== undefined || body.plannedStart !== undefined) payload.planned_start = body.planned_start || body.plannedStart || null;
  if (body.planned_end !== undefined || body.plannedEnd !== undefined) payload.planned_end = body.planned_end || body.plannedEnd || null;
  if (body.timezone !== undefined) payload.timezone = optionalText(body.timezone) || 'America/Sao_Paulo';
  if (body.metadata !== undefined) payload.metadata = normalizeMetadata(body.metadata);
  if (Object.keys(payload).length === 0) return campaign;
  payload.updated_by = userId(user);
  payload.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('operation_campaigns')
    .update(payload)
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .select('*')
    .maybeSingle();
  throwDb(error);
  return data;
}

async function assertCampaignScope(supabase, { empresaId, campaignId, operationalScope }) {
  if (operationalScope.mode === 'LEGACY_COMPANY' || operationalScope.mode === 'SUPER_ADMIN') return;
  const { data, error } = await supabase
    .from('campaign_operational_units')
    .select('unidade_operacional_id')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  throwDb(error);
  const units = (data || []).map((row) => row.unidade_operacional_id);
  requireUnitsWithinScope(operationalScope, units, { requireAny: true });
}

async function createCampaign(supabase, { empresaId, user, body = {}, operationalScope = null, correlation = {} }) {
  assertScope(operationalScope);
  const creator = userId(user);
  const requestId = optionalText(body.client_request_id || body.clientRequestId);
  if (requestId && creator) {
    const { data: existing, error: existingError } = await supabase
      .from('operation_campaigns')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('created_by', creator)
      .eq('client_request_id', requestId)
      .maybeSingle();
    throwDb(existingError);
    if (existing) return existing;
  }
  const units = requireUnitsWithinScope(operationalScope, body.operational_unit_ids || body.operationalUnitIds || [], { requireAny: true });
  const payload = buildCampaignPayload({ empresaId, user, body, correlation });
  const { data: campaign, error } = await supabase.from('operation_campaigns').insert(payload).select('*').single();
  throwDb(error);
  if (units.length) {
    const rows = units.map((unitId) => ({
      empresa_id: empresaId,
      campaign_id: campaign.id,
      unidade_operacional_id: unitId,
      role: 'scope',
      created_by: creator,
    }));
    const { error: unitError } = await supabase.from('campaign_operational_units').insert(rows);
    throwDb(unitError);
  }
  return campaign;
}

async function replaceLocations(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null }) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  if (!['DRAFT', 'PLANNING'].includes(campaign.status)) throw new CampaignError('Locais so podem ser alterados antes da revisao.', { status: 409, code: 'campaign_locked' });
  const inputs = Array.isArray(body.locations) ? body.locations : [];
  if (!inputs.length) throw new CampaignError('Informe ao menos um local.', { code: 'missing_locations' });
  const rows = inputs.map((input) => {
    const location = normalizeLocationInput(input);
    if (location.unidade_operacional_id) requireUnitsWithinScope(operationalScope, [location.unidade_operacional_id]);
    return { ...location, empresa_id: empresaId, campaign_id: campaignId, created_by: userId(user) };
  });
  if (!rows.some((row) => row.kind === 'origin') || !rows.some((row) => row.kind === 'destination')) {
    throw new CampaignError('Informe ao menos uma origem e um destino.', { code: 'missing_origin_destination' });
  }
  const { error: demandDeleteError } = await supabase.from('campaign_demands').delete().eq('empresa_id', empresaId).eq('campaign_id', campaignId);
  throwDb(demandDeleteError);
  const { error: deleteError } = await supabase.from('campaign_locations').delete().eq('empresa_id', empresaId).eq('campaign_id', campaignId);
  throwDb(deleteError);
  const { data, error } = await supabase.from('campaign_locations').insert(rows).select('*');
  throwDb(error);
  return data || [];
}

async function replaceDemands(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null }) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  if (!['DRAFT', 'PLANNING'].includes(campaign.status)) throw new CampaignError('Demandas so podem ser alteradas antes da revisao.', { status: 409, code: 'campaign_locked' });
  const inputs = Array.isArray(body.demands) ? body.demands : [];
  if (!inputs.length) throw new CampaignError('Informe ao menos uma demanda.', { code: 'missing_demands' });
  const { data: locations, error: locError } = await supabase
    .from('campaign_locations')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  throwDb(locError);
  const locationById = new Map((locations || []).map((row) => [row.id, row]));
  const rows = inputs.map((input) => {
    const demand = normalizeDemandInput(input, campaign);
    const origin = locationById.get(demand.origin_location_id);
    const destination = locationById.get(demand.destination_location_id);
    if (!origin || origin.kind !== 'origin') throw new CampaignError('Origem invalida para a demanda.', { code: 'invalid_origin' });
    if (!destination || destination.kind !== 'destination') throw new CampaignError('Destino invalido para a demanda.', { code: 'invalid_destination' });
    return { ...demand, empresa_id: empresaId, campaign_id: campaignId, created_by: userId(user) };
  });
  const { error: deleteError } = await supabase.from('campaign_demands').delete().eq('empresa_id', empresaId).eq('campaign_id', campaignId);
  throwDb(deleteError);
  const { data, error } = await supabase.from('campaign_demands').insert(rows).select('*');
  throwDb(error);
  return data || [];
}

async function loadPlanningData(supabase, { empresaId, campaignId }) {
  const [unitsRes, locationsRes, demandsRes, assetsRes, compositionsRes, assignmentsRes, maintenanceRes, docsRes] = await Promise.all([
    supabase.from('campaign_operational_units').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_locations').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_demands').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('fleet_assets').select('*').eq('empresa_id', empresaId),
    supabase.from('vehicle_compositions').select('*').eq('empresa_id', empresaId),
    supabase.from('driver_vehicle_assignments').select('*').eq('empresa_id', empresaId),
    supabase.from('maintenance_events').select('*').eq('empresa_id', empresaId),
    supabase.from('asset_documents').select('*').eq('empresa_id', empresaId),
  ]);
  for (const result of [unitsRes, locationsRes, demandsRes, assetsRes, compositionsRes, assignmentsRes, maintenanceRes, docsRes]) throwDb(result.error);
  return {
    units: unitsRes.data || [],
    locations: locationsRes.data || [],
    demands: demandsRes.data || [],
    assets: assetsRes.data || [],
    compositions: compositionsRes.data || [],
    assignments: assignmentsRes.data || [],
    maintenance: maintenanceRes.data || [],
    documents: docsRes.data || [],
  };
}

// Núcleo compartilhado de persistência de uma versão de plano (§21/§22 do
// Campaign-D: reusar o planejador determinístico existente, nunca duplicar).
// Usado por generatePlan (campanha em DRAFT/PLANNING, demandas completas) E por
// campaignReplanService.generateReplan (campanha já APROVADA, demandas residuais
// apenas) -- a única diferença entre os dois é QUAIS demandas entram no planner
// e se o status da campanha é tocado no final (replan nunca toca, §24).
async function persistPlanVersion(supabase, { empresaId, campaignId, planned, unitIds, requestId, user, correlation = {}, extraAssumptions = {}, extraConstraints = {} }) {
  const resourceSnapshot = {
    rules_version: planned.rules_version,
    campaign_unit_ids: unitIds,
    resources: (planned.resourcesUsed || []).map((r) => ({ type: r.type, id: r.id, capacity_kg: r.capacity_kg, unidade_operacional_id: r.unidade_operacional_id, driver_id: r.driver_id })),
  };
  const { data: currentVersions, error: versionError } = await supabase
    .from('campaign_plan_versions')
    .select('version_number')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .order('version_number', { ascending: false })
    .limit(1);
  throwDb(versionError);
  const nextVersion = (currentVersions?.[0]?.version_number || 0) + 1;
  await supabase.from('campaign_plan_versions').update({ status: 'SUPERSEDED' }).eq('empresa_id', empresaId).eq('campaign_id', campaignId).eq('status', 'READY_FOR_REVIEW');
  const { data: plan, error } = await supabase.from('campaign_plan_versions').insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    version_number: nextVersion,
    status: 'READY_FOR_REVIEW',
    rules_version: planned.rules_version,
    resource_snapshot: resourceSnapshot,
    assumptions: normalizeMetadata(extraAssumptions),
    constraints: normalizeMetadata(extraConstraints),
    result_summary: planned.summary,
    generated_by: userId(user),
    client_request_id: requestId,
    request_id: correlation.request_id || null,
    correlation_id: correlation.correlation_id || null,
  }).select('*').single();
  throwDb(error);
  const { data: scenario, error: scenarioError } = await supabase.from('campaign_plan_scenarios').insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    plan_version_id: plan.id,
    ...planned.scenario,
  }).select('*').single();
  throwDb(scenarioError);
  if (planned.plannedTrips.length) {
    const { error: tripsError } = await supabase.from('campaign_planned_trips').insert(planned.plannedTrips.map((trip) => ({
      ...trip,
      empresa_id: empresaId,
      campaign_id: campaignId,
      plan_version_id: plan.id,
      scenario_id: scenario.id,
    })));
    throwDb(tripsError);
  }
  if (planned.exceptions.length) {
    const { error: exceptionError } = await supabase.from('campaign_exceptions').insert(planned.exceptions.map((exception) => ({
      ...exception,
      empresa_id: empresaId,
      campaign_id: campaignId,
      plan_version_id: plan.id,
    })));
    throwDb(exceptionError);
  }
  return plan;
}

async function generatePlan(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null, correlation = {} }) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  if (campaign.status === 'APPROVED' || campaign.status === 'CANCELLED') {
    throw new CampaignError('Campanha ja encerrada para planejamento.', { status: 409, code: 'campaign_closed' });
  }
  const requestId = optionalText(body.client_request_id || body.clientRequestId);
  if (requestId) {
    const { data: existing, error: existingError } = await supabase
      .from('campaign_plan_versions')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('campaign_id', campaignId)
      .eq('generated_by', userId(user))
      .eq('client_request_id', requestId)
      .maybeSingle();
    throwDb(existingError);
    if (existing) return getPlan(supabase, { empresaId, campaignId, planId: existing.id, operationalScope });
  }
  const data = await loadPlanningData(supabase, { empresaId, campaignId });
  if (!data.locations.length || !data.demands.length) {
    throw new CampaignError('Cadastre locais e demandas antes de gerar o plano.', { status: 422, code: 'campaign_incomplete' });
  }
  const unitIds = data.units.map((row) => row.unidade_operacional_id);
  requireUnitsWithinScope(operationalScope, unitIds, { requireAny: true });
  const resources = buildResourceCandidates({
    assets: data.assets,
    compositions: data.compositions,
    assignments: data.assignments,
    maintenance: data.maintenance,
    documents: data.documents,
    unitIds,
  });
  const planned = planCampaign({ campaign, locations: data.locations, demands: data.demands, resources });
  planned.resourcesUsed = resources;
  const plan = await persistPlanVersion(supabase, {
    empresaId, campaignId, planned, unitIds, requestId, user, correlation,
    extraAssumptions: body.assumptions, extraConstraints: body.constraints,
  });
  const { error: updateError } = await supabase
    .from('operation_campaigns')
    .update({ status: 'READY_FOR_REVIEW', planning_status: 'READY_FOR_REVIEW', updated_by: userId(user), updated_at: new Date().toISOString() })
    .eq('empresa_id', empresaId)
    .eq('id', campaignId);
  throwDb(updateError);
  return getPlan(supabase, { empresaId, campaignId, planId: plan.id, operationalScope });
}

async function getPlan(supabase, { empresaId, campaignId, planId, operationalScope = null }) {
  await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  const { data: plan, error } = await supabase
    .from('campaign_plan_versions')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .eq('id', planId)
    .maybeSingle();
  throwDb(error);
  if (!plan) throw new CampaignError('Plano nao encontrado.', { status: 404, code: 'plan_not_found' });
  const [scenariosRes, tripsRes, exceptionsRes, approvalsRes] = await Promise.all([
    supabase.from('campaign_plan_scenarios').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
    supabase.from('campaign_planned_trips').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId).order('created_at', { ascending: true }),
    supabase.from('campaign_exceptions').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId).order('created_at', { ascending: true }),
    supabase.from('campaign_approvals').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId).order('occurred_at', { ascending: true }),
  ]);
  for (const result of [scenariosRes, tripsRes, exceptionsRes, approvalsRes]) throwDb(result.error);
  return {
    plan,
    scenarios: scenariosRes.data || [],
    planned_trips: tripsRes.data || [],
    exceptions: exceptionsRes.data || [],
    approvals: approvalsRes.data || [],
  };
}

async function approvePlan(supabase, { empresaId, user, campaignId, planId, body = {}, operationalScope = null, correlation = {} }) {
  const detailed = await getPlan(supabase, { empresaId, campaignId, planId, operationalScope });
  const { plan, exceptions } = detailed;
  if (plan.status !== 'READY_FOR_REVIEW') throw new CampaignError('Plano nao esta pronto para aprovacao.', { status: 409, code: 'plan_not_reviewable' });
  const hardOpen = exceptions.filter((item) => item.severity === 'HARD_CONSTRAINT' && item.status === 'OPEN');
  if (hardOpen.length) throw new CampaignError('Plano possui bloqueios objetivos em aberto.', { status: 409, code: 'plan_has_hard_constraints' });
  const requestId = optionalText(body.client_request_id || body.clientRequestId);
  if (requestId) {
    const { data: existing, error: existingError } = await supabase
      .from('campaign_approvals')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('plan_version_id', planId)
      .eq('actor_user_id', userId(user))
      .eq('action', 'APPROVE')
      .eq('client_request_id', requestId)
      .maybeSingle();
    throwDb(existingError);
    if (existing) return getPlan(supabase, { empresaId, campaignId, planId, operationalScope });
  }
  const { error: approvalError } = await supabase.from('campaign_approvals').insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    plan_version_id: planId,
    action: 'APPROVE',
    actor_user_id: userId(user),
    reason: optionalText(body.reason),
    metadata: normalizeMetadata(body.metadata),
    request_id: correlation.request_id || null,
    correlation_id: correlation.correlation_id || null,
    client_request_id: requestId,
  });
  throwDb(approvalError);
  const now = new Date().toISOString();
  // Replan (Campaign-D §24/§25): se a campanha JA tem um plano aprovado
  // DIFERENTE deste, este approve e a aprovacao de um replan -- supera a
  // versao antiga PRIMEIRO (nunca a deleta/muta os dados dela, so o status
  // + lineage via superseded_by) antes de promover a nova, respeitando o
  // indice unico campaign_plan_versions_one_approved_key (no maximo 1 linha
  // com status=APPROVED por campanha). Trabalho/execucao ja comprometidos na
  // versao antiga (Fretes materializados, rodadas de despacho) nunca sao
  // tocados aqui -- ficam ligados para sempre a planned_trip_id/plan_version_id
  // historicos (§23).
  const { data: campaignRow, error: campaignReadError } = await supabase
    .from('operation_campaigns')
    .select('approved_plan_version_id')
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .maybeSingle();
  throwDb(campaignReadError);
  const previousApprovedId = campaignRow?.approved_plan_version_id || null;
  const isReplanApproval = Boolean(previousApprovedId && previousApprovedId !== planId);
  if (isReplanApproval) {
    const { error: supersedeError } = await supabase
      .from('campaign_plan_versions')
      .update({ status: 'SUPERSEDED', superseded_by: planId })
      .eq('empresa_id', empresaId)
      .eq('id', previousApprovedId)
      .eq('status', 'APPROVED');
    throwDb(supersedeError);
  }
  const { error: planError } = await supabase
    .from('campaign_plan_versions')
    .update({ status: 'APPROVED', approved_by: userId(user), approved_at: now })
    .eq('empresa_id', empresaId)
    .eq('id', planId);
  throwDb(planError);
  const { error: campaignError } = await supabase
    .from('operation_campaigns')
    .update({ status: 'APPROVED', planning_status: 'APPROVED', approved_plan_version_id: planId, updated_by: userId(user), updated_at: now })
    .eq('empresa_id', empresaId)
    .eq('id', campaignId);
  throwDb(campaignError);

  // E3.6A / HIGH-03 — aprovar um plano NOVO invalida o que já foi pedido à rede.
  //
  // Uma oportunidade compartilhada carrega o residual de um plano específico. Se
  // esse plano foi superado, o número que o parceiro está vendo deixou de ser o
  // pedido atual — e responder a ele viraria compromisso sobre uma carga que já
  // mudou. Marcar aqui é o que liga o replan à rede: sem isto, `STALE_SOURCE`
  // seria um estado que nada produz.
  //
  // O snapshot NÃO é reescrito: só o estado muda, e o evento fica registrado.
  //
  // Best-effort DELIBERADO, e a razão é que existe a segunda camada: a RPC de
  // resposta reconfere a versão do plano dentro da própria transação, então uma
  // falha aqui não deixa passar resposta obsoleta — só adia a marcação. Derrubar
  // a aprovação de um plano por causa disso seria o remédio pior que a doença.
  if (isReplanApproval) {
    // O `try/catch` sozinho NÃO percebia a falha, e essa é a parte que importa.
    //
    // O client do Supabase não lança em erro de RPC: ele RESOLVE a promessa com
    // `{ data, error }`. Uma função ausente (a 082 ainda não aplicada), sem
    // permissão, ou que levantou exceção, voltava por `error` — e o `await` dentro
    // do `try` seguia feliz. O `catch` só pegaria falha de rede.
    //
    // Ou seja: o único aviso que existia era inalcançável na prática. A marcação
    // podia estar quebrada em produção indefinidamente sem uma linha de log.
    const { error: staleError } = await supabase.rpc('partner_network_mark_source_stale', {
      p_empresa_id: empresaId,
      p_campaign_id: campaignId,
      p_motivo: 'replan_aprovado',
      p_actor_user_id: userId(user),
    });
    if (staleError) {
      // Continua sendo não-fatal DE PROPÓSITO: a autoridade final é a
      // revalidação da fonte dentro da RPC de resposta, que roda na mesma
      // transação da escrita. Uma falha aqui adia a marcação; ela não deixa
      // passar resposta obsoleta. Derrubar a aprovação de um plano por causa
      // disso seria o remédio pior que a doença.
      console.warn('[campaign:approvePlan] rede de parceiros nao marcada como obsoleta:',
        staleError.message || staleError.code || staleError);
    }
  }

  return getPlan(supabase, { empresaId, campaignId, planId, operationalScope });
}

async function rejectPlan(supabase, { empresaId, user, campaignId, planId, body = {}, operationalScope = null, correlation = {} }) {
  const detailed = await getPlan(supabase, { empresaId, campaignId, planId, operationalScope });
  if (detailed.plan.status !== 'READY_FOR_REVIEW') throw new CampaignError('Plano nao esta pronto para rejeicao.', { status: 409, code: 'plan_not_reviewable' });
  const { error: approvalError } = await supabase.from('campaign_approvals').insert({
    empresa_id: empresaId,
    campaign_id: campaignId,
    plan_version_id: planId,
    action: 'REJECT',
    actor_user_id: userId(user),
    reason: optionalText(body.reason),
    metadata: normalizeMetadata(body.metadata),
    request_id: correlation.request_id || null,
    correlation_id: correlation.correlation_id || null,
    client_request_id: optionalText(body.client_request_id || body.clientRequestId),
  });
  throwDb(approvalError);
  const { error: planError } = await supabase.from('campaign_plan_versions').update({ status: 'REJECTED' }).eq('empresa_id', empresaId).eq('id', planId);
  throwDb(planError);
  // Replan rejeitado (§24): a campanha ja tem um plano aprovado diferente deste
  // rascunho -- rejeitar o rascunho NUNCA deve tirar a campanha de APPROVED
  // (isso invalidaria a execucao ja em curso sob a versao antiga). So campanhas
  // sem plano aprovado (fluxo original, Campaign-A) voltam para PLANNING.
  const { data: campaignRow, error: campaignReadError } = await supabase
    .from('operation_campaigns')
    .select('approved_plan_version_id')
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .maybeSingle();
  throwDb(campaignReadError);
  const hasOtherApprovedPlan = Boolean(campaignRow?.approved_plan_version_id && campaignRow.approved_plan_version_id !== planId);
  const { error: campaignError } = await supabase.from('operation_campaigns').update(
    hasOtherApprovedPlan
      ? { planning_status: 'REJECTED', updated_by: userId(user), updated_at: new Date().toISOString() }
      : { status: 'PLANNING', planning_status: 'REJECTED', updated_by: userId(user), updated_at: new Date().toISOString() },
  ).eq('empresa_id', empresaId).eq('id', campaignId);
  throwDb(campaignError);
  return getPlan(supabase, { empresaId, campaignId, planId, operationalScope });
}

async function cancelCampaign(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null }) {
  await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  const { data, error } = await supabase.from('operation_campaigns').update({
    status: 'CANCELLED',
    planning_status: 'CANCELLED',
    cancelled_by: userId(user),
    cancelled_at: new Date().toISOString(),
    cancellation_reason: optionalText(body.reason),
    updated_by: userId(user),
    updated_at: new Date().toISOString(),
  }).eq('empresa_id', empresaId).eq('id', campaignId).select('*').maybeSingle();
  throwDb(error);
  return data;
}

async function verifyCampaignPlan(supabase, { empresaId, campaignId, planId, correlation = {} } = {}) {
  return verifyTarget({
    target: { domain: 'operation_campaign', empresa_id: empresaId, campaign_id: campaignId, plan_version_id: planId },
    context: { facts: createSupabaseDiagnosticFacts(supabase), correlation },
    registry: createDefaultInvariantRegistry(),
  });
}

module.exports = {
  CampaignError,
  RULES_VERSION,
  buildCampaignPayload,
  buildResourceCandidates,
  cancelCampaign,
  createCampaign,
  databaseError,
  fromKg,
  generatePlan,
  getCampaign,
  getPlan,
  listCampaigns,
  planCampaign,
  replaceDemands,
  replaceLocations,
  requireCampaign,
  requireUnitsWithinScope,
  approvePlan,
  rejectPlan,
  updateDraft,
  toKg,
  verifyCampaignPlan,
  persistPlanVersion,
  loadPlanningData,
};

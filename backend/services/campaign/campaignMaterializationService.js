'use strict';

const crypto = require('node:crypto');
const { canAccessUnit } = require('../operationalScopeDomainService');
const { createFreight, FreightCreationError } = require('../freights/freightCreationService');
const fleet = require('../fleet/fleetService');
const { CampaignError } = require('./campaignService');

const DEFAULT_BATCH_SIZE = 25;

function userId(user) {
  return user?.uid || user?.id || null;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function quantityToTon(quantity, unit) {
  const n = finiteNumber(quantity) || 0;
  const normalized = String(unit || '').toLowerCase();
  if (normalized === 'kg') return n / 1000;
  return n;
}

function assertScope(scope) {
  if (!scope || scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
    throw new CampaignError('Escopo operacional nao autorizado.', { status: 403, code: 'operational_scope_denied' });
  }
}

function canUseUnit(operationalScope, unidadeId) {
  if (!unidadeId) return operationalScope?.mode === 'LEGACY_COMPANY' || operationalScope?.mode === 'SUPER_ADMIN';
  return canAccessUnit(operationalScope, unidadeId);
}

function batchSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.trunc(n), 1), 50);
}

function validateMaterializationOptions(options = {}) {
  const modalidade = options.modalidade_calculo || 'valor_fixo';
  if (!['valor_fixo', 'tonelada_km'].includes(modalidade)) {
    throw new CampaignError('Modalidade de frete invalida para materializacao.', {
      status: 422,
      code: 'materialization_freight_mode_invalid',
    });
  }
  if (modalidade === 'valor_fixo') {
    const valor = finiteNumber(options.valor_frete);
    if (!valor || valor <= 0) {
      throw new CampaignError('Informe valor_frete maior que zero para materializar fretes.', {
        status: 422,
        code: 'materialization_freight_pricing_required',
      });
    }
  }
  if (modalidade === 'tonelada_km') {
    const valorTonKm = finiteNumber(options.valor_tonelada_km);
    if (!valorTonKm || valorTonKm <= 0) {
      throw new CampaignError('Informe valor_tonelada_km maior que zero para materializar fretes por tonelada/km.', {
        status: 422,
        code: 'materialization_freight_pricing_required',
      });
    }
  }
}

function classifyDbError(error) {
  if (!error) return null;
  if (error.code === '42P01') {
    return new CampaignError('Schema de materializacao Campaign-B ainda nao aplicado.', {
      status: 503,
      code: 'campaign_materialization_schema_missing',
    });
  }
  if (error.code === '23505') {
    return new CampaignError('Viagem ja materializada.', { status: 409, code: 'campaign_trip_already_materialized' });
  }
  if (error.code === '23503') {
    return new CampaignError('Referencia invalida para materializacao.', { status: 422, code: 'campaign_materialization_reference_invalid' });
  }
  return new CampaignError('Erro de banco ao materializar campanha.', {
    status: 500,
    code: 'campaign_materialization_database_error',
    details: { db_code: error.code, message: error.message },
  });
}

function throwDb(error) {
  if (error) throw classifyDbError(error);
}

async function loadApprovedContext(supabase, { empresaId, campaignId, planId, operationalScope }) {
  assertScope(operationalScope);
  const { data: campaign, error: campaignError } = await supabase
    .from('operation_campaigns')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .maybeSingle();
  throwDb(campaignError);
  if (!campaign) throw new CampaignError('Campanha nao encontrada.', { status: 404, code: 'campaign_not_found' });

  const { data: units, error: unitsError } = await supabase
    .from('campaign_operational_units')
    .select('unidade_operacional_id')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  throwDb(unitsError);

  const campaignUnitIds = (units || []).map((row) => row.unidade_operacional_id).filter(Boolean);
  const forbidden = campaignUnitIds.filter((unitId) => !canAccessUnit(operationalScope, unitId));
  if (forbidden.length) {
    throw new CampaignError('Unidade operacional fora do seu escopo atual.', {
      status: 403,
      code: 'operational_unit_forbidden',
      details: { unidade_operacional_ids: forbidden },
    });
  }

  const { data: plan, error: planError } = await supabase
    .from('campaign_plan_versions')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .eq('id', planId)
    .maybeSingle();
  throwDb(planError);
  if (!plan) throw new CampaignError('Plano nao encontrado.', { status: 404, code: 'plan_not_found' });
  if (campaign.status !== 'APPROVED' || campaign.approved_plan_version_id !== planId || plan.status !== 'APPROVED') {
    throw new CampaignError('Materializacao exige campanha e plano aprovado atual.', {
      status: 409,
      code: 'campaign_plan_not_approved',
    });
  }

  const [tripsRes, locationsRes, linksRes] = await Promise.all([
    supabase.from('campaign_planned_trips').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId).order('created_at', { ascending: true }),
    supabase.from('campaign_locations').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_trip_freights').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
  ]);
  throwDb(tripsRes.error);
  throwDb(locationsRes.error);
  throwDb(linksRes.error);

  return {
    campaign,
    plan,
    trips: tripsRes.data || [],
    locations: locationsRes.data || [],
    links: linksRes.data || [],
    campaignUnitIds,
  };
}

async function loadResourceState(supabase, { empresaId, trips }) {
  const driverIds = [...new Set(trips.map((trip) => trip.candidate_driver_id).filter(Boolean))];
  const assetIds = [...new Set(trips.map((trip) => trip.candidate_asset_id).filter(Boolean))];
  const compositionIds = [...new Set(trips.map((trip) => trip.candidate_composition_id).filter(Boolean))];

  const queries = [];
  queries.push(driverIds.length
    ? supabase.from('usuarios').select('id,empresa_id,status').eq('empresa_id', empresaId).in('id', driverIds)
    : Promise.resolve({ data: [], error: null }));
  queries.push(assetIds.length
    ? supabase.from('fleet_assets').select('id,empresa_id,status,unidade_operacional_id,plate').eq('empresa_id', empresaId).in('id', assetIds)
    : Promise.resolve({ data: [], error: null }));
  queries.push(compositionIds.length
    ? supabase.from('vehicle_compositions').select('id,empresa_id,status,unidade_operacional_id').eq('empresa_id', empresaId).in('id', compositionIds)
    : Promise.resolve({ data: [], error: null }));
  queries.push((assetIds.length || compositionIds.length || driverIds.length)
    ? supabase.from('driver_vehicle_assignments').select('*').eq('empresa_id', empresaId).eq('assignment_status', 'active')
    : Promise.resolve({ data: [], error: null }));

  const [driversRes, assetsRes, compositionsRes, assignmentsRes] = await Promise.all(queries);
  for (const result of [driversRes, assetsRes, compositionsRes, assignmentsRes]) throwDb(result.error);

  return {
    driversById: new Map((driversRes.data || []).map((row) => [row.id, row])),
    assetsById: new Map((assetsRes.data || []).map((row) => [row.id, row])),
    compositionsById: new Map((compositionsRes.data || []).map((row) => [row.id, row])),
    assignments: assignmentsRes.data || [],
  };
}

function locationName(locationsById, id) {
  return locationsById.get(id)?.name || 'Local nao informado';
}

function activeAssignmentMatches(assignments, trip) {
  return assignments.some((row) => {
    if (row.driver_id !== trip.candidate_driver_id) return false;
    if (row.valid_until) return false;
    if (trip.candidate_asset_id) return row.asset_id === trip.candidate_asset_id;
    if (trip.candidate_composition_id) return row.composition_id === trip.candidate_composition_id;
    return false;
  });
}

function classifyTrip({ trip, existingLink, resourceState, locationsById, operationalScope }) {
  if (existingLink) {
    return { planned_trip_id: trip.id, status: 'ALREADY_MATERIALIZED', frete_id: existingLink.frete_id };
  }
  if (trip.status !== 'PLANNED') {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: `TRIP_STATUS_${trip.status}` };
  }
  if (!trip.candidate_driver_id) {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'DRIVER_REQUIRED' };
  }
  if (!trip.candidate_asset_id && !trip.candidate_composition_id) {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'RESOURCE_REQUIRED' };
  }

  const driver = resourceState.driversById.get(trip.candidate_driver_id);
  if (!driver || driver.status !== 'ativo') {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'DRIVER_INACTIVE_OR_MISSING' };
  }

  const resource = trip.candidate_asset_id
    ? resourceState.assetsById.get(trip.candidate_asset_id)
    : resourceState.compositionsById.get(trip.candidate_composition_id);
  if (!resource || resource.status !== 'active') {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'RESOURCE_INACTIVE_OR_MISSING' };
  }
  if (!canUseUnit(operationalScope, resource.unidade_operacional_id || null)) {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'RESOURCE_SCOPE_DENIED' };
  }
  if (!activeAssignmentMatches(resourceState.assignments, trip)) {
    return { planned_trip_id: trip.id, status: 'BLOCKED', reason: 'STALE_DRIVER_RESOURCE_ASSIGNMENT' };
  }

  return {
    planned_trip_id: trip.id,
    status: 'READY',
    origem: locationName(locationsById, trip.origin_location_id),
    destino: locationName(locationsById, trip.destination_location_id),
    motorista_id: trip.candidate_driver_id,
    asset_id: trip.candidate_asset_id || null,
    composition_id: trip.candidate_composition_id || null,
    unidade_operacional_id: resource.unidade_operacional_id || null,
    planned_quantity: Number(trip.planned_quantity || 0),
    quantity_unit: trip.quantity_unit,
    deterministic_frete_id: deterministicUuid(`campaign-materialization:${trip.id}`),
  };
}

function summarize(items) {
  const summary = {
    requested: items.length,
    already_materialized: 0,
    ready: 0,
    created: 0,
    blocked: 0,
    failed: 0,
    retryable: 0,
  };
  for (const item of items) {
    if (item.status === 'ALREADY_MATERIALIZED') summary.already_materialized += 1;
    if (item.status === 'READY') summary.ready += 1;
    if (item.status === 'CREATED') summary.created += 1;
    if (item.status === 'BLOCKED') summary.blocked += 1;
    if (item.status === 'FAILED') summary.failed += 1;
    if (item.retryable) summary.retryable += 1;
  }
  return summary;
}

async function previewMaterialization(supabase, { empresaId, campaignId, planId, operationalScope }) {
  const context = await loadApprovedContext(supabase, { empresaId, campaignId, planId, operationalScope });
  const resourceState = await loadResourceState(supabase, { empresaId, trips: context.trips });
  const locationsById = new Map(context.locations.map((row) => [row.id, row]));
  const linksByTrip = new Map(context.links.map((row) => [row.planned_trip_id, row]));
  const items = context.trips.map((trip) => classifyTrip({
    trip,
    existingLink: linksByTrip.get(trip.id),
    resourceState,
    locationsById,
    operationalScope,
  }));
  return { summary: summarize(items), items };
}

function buildFreightBodyFromTrip(item, options = {}) {
  const modalidade = options.modalidade_calculo || 'valor_fixo';
  const body = {
    origem: item.origem,
    destino: item.destino,
    motorista_id: item.motorista_id,
    unidade_operacional_id: item.unidade_operacional_id,
    modalidade_calculo: modalidade,
    odometro_obrigatorio: options.odometro_obrigatorio !== false,
    quem_recebeu: options.quem_recebeu,
  };
  if (modalidade === 'tonelada_km') {
    body.toneladas = quantityToTon(item.planned_quantity, item.quantity_unit);
    body.valor_tonelada_km = options.valor_tonelada_km;
  } else {
    body.valor_frete = options.valor_frete;
  }
  return body;
}

async function insertLink(supabase, row) {
  const { data, error } = await supabase
    .from('campaign_trip_freights')
    .insert(row)
    .select()
    .single();
  if (!error) return { data, replay: false };
  if (error.code !== '23505') throwDb(error);

  const { data: existing, error: existingError } = await supabase
    .from('campaign_trip_freights')
    .select('*')
    .eq('empresa_id', row.empresa_id)
    .eq('planned_trip_id', row.planned_trip_id)
    .maybeSingle();
  throwDb(existingError);
  if (!existing) throw classifyDbError(error);
  return { data: existing, replay: true };
}

async function ensureFreightAssignment(supabase, { empresaId, user, item, freteId, operationalScope }) {
  try {
    return await fleet.createFreightAssignment(supabase, {
      empresaId,
      user,
      operationalScope,
      body: {
        frete_id: freteId,
        asset_id: item.asset_id,
        composition_id: item.composition_id,
        primary_driver_id: item.motorista_id,
        reason: 'campaign_materialization',
        metadata: { planned_trip_id: item.planned_trip_id },
      },
    });
  } catch (error) {
    if (error?.code !== 'fleet_conflict') throw error;
    const { data, error: existingError } = await supabase
      .from('freight_vehicle_assignments')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('frete_id', freteId)
      .eq('assignment_status', 'active')
      .maybeSingle();
    throwDb(existingError);
    if (!data) throw error;
    return data;
  }
}

async function materializeOne(supabase, { item, context, user, options, operationalScope, correlation }) {
  if (item.status !== 'READY') return item;
  const body = buildFreightBodyFromTrip(item, options);
  try {
    const freight = await createFreight(supabase, {
      user: { ...user, role: 'admin' },
      body,
      motoristaId: item.motorista_id,
      forcedId: item.deterministic_frete_id,
      resolveOperationalUnit: async () => item.unidade_operacional_id || null,
    });
    await ensureFreightAssignment(supabase, {
      empresaId: context.campaign.empresa_id,
      user,
      item,
      freteId: freight.data.id,
      operationalScope,
    });
    const link = await insertLink(supabase, {
      empresa_id: context.campaign.empresa_id,
      campaign_id: context.campaign.id,
      plan_version_id: context.plan.id,
      planned_trip_id: item.planned_trip_id,
      frete_id: freight.data.id,
      materialization_status: 'MATERIALIZED',
      source: 'campaign_materialization',
      request_id: correlation?.request_id || null,
      correlation_id: correlation?.correlation_id || null,
      created_by: userId(user),
      metadata: {
        ...normalizeMetadata(options.metadata),
        deterministic_frete_id: item.deterministic_frete_id,
      },
    });
    return {
      ...item,
      status: link.replay || freight.replay ? 'ALREADY_MATERIALIZED' : 'CREATED',
      frete_id: link.data.frete_id,
      replay: link.replay || freight.replay,
    };
  } catch (error) {
    if (error instanceof FreightCreationError) {
      return {
        ...item,
        status: 'FAILED',
        reason: error.code,
        message: error.message,
        retryable: error.status >= 500 || error.code === 'freight_insert_failed',
      };
    }
    if (error?.name === 'FleetError') {
      return {
        ...item,
        status: 'FAILED',
        reason: error.code || 'fleet_assignment_failed',
        message: error.message,
        retryable: error.status >= 500,
      };
    }
    throw error;
  }
}

async function materializePlan(supabase, { empresaId, campaignId, planId, user, operationalScope, body = {}, correlation = {} }) {
  validateMaterializationOptions(body.options || body);
  const context = await loadApprovedContext(supabase, { empresaId, campaignId, planId, operationalScope });
  const preview = await previewMaterialization(supabase, { empresaId, campaignId, planId, operationalScope });
  const items = [];
  const size = batchSize(body.batch_size || body.batchSize);

  for (let index = 0; index < preview.items.length; index += size) {
    const batch = preview.items.slice(index, index + size);
    for (const item of batch) {
      items.push(await materializeOne(supabase, {
        item,
        context,
        user,
        options: body.options || body,
        operationalScope,
        correlation,
      }));
    }
  }

  return { summary: summarize(items), items };
}

module.exports = {
  buildFreightBodyFromTrip,
  deterministicUuid,
  materializePlan,
  previewMaterialization,
  quantityToTon,
};

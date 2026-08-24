'use strict';

// campaignProgressService — PROJEÇÃO read-only do progresso operacional da
// Campaign (Parte A/B/D/E do Campaign-C). Fonte ÚNICA consumida pela API web,
// pela Torre de Controle e pela tool de IA (§12). NÃO cria autoridade nova: o
// progresso é DERIVADO do plano aprovado + campaign_trip_freights + Fretes
// canônicos (§11). Nunca escreve, nunca materializa, nunca despacha.

const { requireCampaign, CampaignError } = require('./campaignService');
const { freightStatusToBucket, EXECUTION_BUCKET } = require('./freightExecutionStatus');
const { evaluateCandidate } = require('./dispatchEligibilityService');

// Materialização ATIVA = link cujo status conta como materialização vigente.
const ACTIVE_MATERIALIZATION = new Set(['MATERIALIZED', 'RECONCILED']);

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Conversão canônica de quantidade para tonelada. Retorna { value, known }.
// Só as unidades de massa do domínio (kg/ton/tonelada) são convertíveis (§23).
function toTon(quantity, unit) {
  const n = finiteNumber(quantity);
  const u = String(unit || '').trim().toLowerCase();
  if (n === null) return { value: 0, known: false, compatible: true };
  if (u === 'kg') return { value: n / 1000, known: true, compatible: true };
  if (u === 'ton' || u === 'tonelada') return { value: n, known: true, compatible: true };
  // Unidade fora do domínio de massa: incompatível, não converte (§14/§23).
  return { value: 0, known: false, compatible: false };
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function throwDb(error) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new CampaignError('Schema operacional ainda nao aplicado.', { status: 503, code: 'campaign_schema_missing' });
  }
  throw new CampaignError('Erro de banco ao projetar progresso.', {
    status: 500,
    code: 'progress_database_error',
    details: { db_code: error.code },
  });
}

function locationName(locationsById, id) {
  return locationsById.get(id)?.name || null;
}

// ---- Saúde determinística (§29/§30) --------------------------------------
function deriveHealth(trips) {
  const {
    planned_total, blocked, not_materialized, materialized,
    in_execution, completed, cancelled, unknown,
  } = trips;
  const evidence = { planned_total, blocked, not_materialized, materialized, in_execution, completed, cancelled, unknown };

  if (planned_total > 0 && completed === planned_total) {
    return { state: 'COMPLETED', reason_code: 'ALL_TRIPS_COMPLETED', reason_text: 'Todas as viagens planejadas foram concluídas.', evidence };
  }
  if (blocked > 0) {
    return { state: 'CRITICAL', reason_code: 'PLANNING_CAPACITY_GAP', reason_text: 'Há viagens bloqueadas por falta de capacidade no plano.', evidence };
  }
  if (unknown > 0) {
    return { state: 'CRITICAL', reason_code: 'FREIGHT_UNKNOWN_STATUS', reason_text: 'Há fretes materializados em estado desconhecido.', evidence };
  }
  if (materialized === 0) {
    return { state: 'NO_EXECUTION_YET', reason_code: 'NOT_MATERIALIZED_YET', reason_text: 'Nenhuma viagem foi materializada em frete ainda.', evidence };
  }
  if (not_materialized > 0 || cancelled > 0) {
    return { state: 'ATTENTION', reason_code: cancelled > 0 ? 'FREIGHT_CANCELLED' : 'MATERIALIZATION_INCOMPLETE', reason_text: cancelled > 0 ? 'Há fretes cancelados que reduzem o atendido.' : 'Ainda há viagens não materializadas.', evidence };
  }
  return { state: 'ON_TRACK', reason_code: 'EXECUTION_HEALTHY', reason_text: 'Execução em dia, sem lacunas de materialização.', evidence };
}

// ---- Janela da campanha (§32) --------------------------------------------
function deriveWindow(campaign) {
  const start = campaign.planned_start ? new Date(campaign.planned_start) : null;
  const end = campaign.planned_end ? new Date(campaign.planned_end) : null;
  if (!start && !end) return null;
  const now = Date.now();
  let state = 'WINDOW_ACTIVE';
  if (start && now < start.getTime()) state = 'WINDOW_NOT_STARTED';
  else if (end && now > end.getTime()) state = 'WINDOW_EXCEEDED';
  return {
    state,
    planned_start: campaign.planned_start || null,
    planned_end: campaign.planned_end || null,
    timezone: campaign.timezone || null,
  };
}

// ---- Recomendação de replanejamento (§68-70) ------------------------------
function deriveReplan({ trips, quantity, window, blockedTripIds, cancelledTripIds, unknownTripIds }) {
  const remaining = quantity.remaining;
  if (trips.blocked > 0) {
    return {
      status: 'REPLAN_REQUIRED_BY_INVARIANT',
      reason_code: 'PLANNING_CAPACITY_GAP',
      affected_trip_ids: blockedTripIds,
      remaining_quantity: remaining,
      quantity_unit: quantity.unit,
      suggested_next_step: 'Revisar capacidade/recursos e gerar um novo plano para cobrir a demanda bloqueada.',
    };
  }
  if (trips.cancelled > 0 && remaining > 0) {
    return {
      status: 'REPLAN_RECOMMENDED',
      reason_code: 'CANCELLED_FREIGHT_REMAINING_DEMAND',
      affected_trip_ids: cancelledTripIds,
      remaining_quantity: remaining,
      quantity_unit: quantity.unit,
      suggested_next_step: 'Reprogramar as viagens canceladas para atender a demanda restante.',
    };
  }
  if (window && window.state === 'WINDOW_EXCEEDED' && remaining > 0) {
    return {
      status: 'REPLAN_RECOMMENDED',
      reason_code: 'WINDOW_EXCEEDED_REMAINING_DEMAND',
      affected_trip_ids: [],
      remaining_quantity: remaining,
      quantity_unit: quantity.unit,
      suggested_next_step: 'A janela planejada foi excedida com demanda em aberto; avaliar replanejamento.',
    };
  }
  if (trips.unknown > 0) {
    return {
      status: 'REPLAN_RECOMMENDED',
      reason_code: 'FREIGHT_UNKNOWN_STATUS',
      affected_trip_ids: unknownTripIds,
      remaining_quantity: remaining,
      quantity_unit: quantity.unit,
      suggested_next_step: 'Investigar os fretes em estado desconhecido antes de decidir replanejamento.',
    };
  }
  return {
    status: 'REPLAN_NOT_NEEDED',
    reason_code: 'NO_SIGNAL',
    affected_trip_ids: [],
    remaining_quantity: remaining,
    quantity_unit: quantity.unit,
    suggested_next_step: null,
  };
}

// Estado vazio (campanha sem plano aprovado): progresso zerado, saúde derivada.
function emptyProgress(campaign) {
  const trips = { planned_total: 0, not_materialized: 0, materialized: 0, in_execution: 0, completed: 0, cancelled: 0, blocked: 0, unknown: 0 };
  return {
    campaign: projectCampaign(campaign),
    approved_plan: null,
    progress: {
      trips,
      quantity: {
        unit: 'ton', target: 0, planned: 0, materialized: 0, completed: 0, cancelled: 0, remaining: 0,
        coverage: { quantity_source: 'PLANNED_FREIGHT_QUANTITY', measured_actual_available: false, trips_with_quantity: 0, trips_total: 0, incompatible_units: false },
        groups: null,
      },
    },
    trips_detail: [],
    readiness: { total_operational_needs: 0, ready_direct: 0, ready_offer: 0, blocked: 0, already_assigned: 0, executing: 0, completed: 0 },
    health: { state: 'NO_EXECUTION_YET', reason_code: 'PLAN_NOT_APPROVED', reason_text: 'A campanha ainda não possui plano aprovado.', evidence: {} },
    exceptions: [],
    link_anomalies: [],
    replan: { status: 'REPLAN_NOT_NEEDED', reason_code: 'NO_APPROVED_PLAN', affected_trip_ids: [], remaining_quantity: 0, quantity_unit: 'ton', suggested_next_step: null },
    window: deriveWindow(campaign),
    updated_at: new Date().toISOString(),
  };
}

function projectCampaign(campaign) {
  return {
    id: campaign.id,
    reference_code: campaign.reference_code,
    name: campaign.name,
    cargo_name: campaign.cargo_name,
    status: campaign.status,
    planning_status: campaign.planning_status,
    approved_plan_version_id: campaign.approved_plan_version_id || null,
    planned_start: campaign.planned_start || null,
    planned_end: campaign.planned_end || null,
    timezone: campaign.timezone || null,
  };
}

// Avalia a elegibilidade do candidato ARMAZENADO de uma viagem não materializada
// (bounded: 1 candidato por viagem, sem cross-product — §108). Usa o estado já
// carregado em lote para não gerar N+1.
function readinessForNotMaterialized(trip, state) {
  const hasCandidate = Boolean(trip.candidate_driver_id) && Boolean(trip.candidate_asset_id || trip.candidate_composition_id);
  if (!hasCandidate) {
    return { readiness: 'READY_FOR_OFFER_DISPATCH', reasons: [], warnings: [] };
  }
  const resourceType = trip.candidate_asset_id ? 'asset' : 'composition';
  const resource = trip.candidate_asset_id
    ? state.assetsById.get(trip.candidate_asset_id) || null
    : state.compositionsById.get(trip.candidate_composition_id) || null;
  const driver = state.driversById.get(trip.candidate_driver_id) || null;
  const resourceKey = trip.candidate_asset_id || trip.candidate_composition_id;
  const activeAssignment = state.assignments.find((a) => {
    if (a.driver_id !== trip.candidate_driver_id) return false;
    if (a.valid_until) return false;
    if (trip.candidate_asset_id) return a.asset_id === trip.candidate_asset_id;
    if (trip.candidate_composition_id) return a.composition_id === trip.candidate_composition_id;
    return false;
  }) || null;
  const evalResult = evaluateCandidate({
    driver,
    driverId: trip.candidate_driver_id,
    resource,
    resourceType,
    activeAssignment,
    requiredCapacityKg: finiteNumber(trip.required_capacity_kg),
    maintenanceActive: resourceKey ? state.maintenanceTargets.has(resourceKey) : false,
    documents: resourceType === 'asset' ? (state.docsByAsset.get(trip.candidate_asset_id) || []) : [],
    operationalScope: state.operationalScope,
  });
  if (evalResult.eligibility === 'INELIGIBLE') {
    return { readiness: 'BLOCKED', reasons: evalResult.reasons, warnings: evalResult.warnings };
  }
  return { readiness: 'READY_FOR_DIRECT_ASSIGNMENT', reasons: [], warnings: evalResult.warnings };
}

async function getCampaignProgress(supabase, { empresaId, campaignId, operationalScope } = {}) {
  const campaign = await requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  const planId = campaign.approved_plan_version_id;
  if (!planId || campaign.status !== 'APPROVED') {
    return emptyProgress(campaign);
  }

  const [planRes, tripsRes, linksRes, demandsRes, locationsRes] = await Promise.all([
    supabase.from('campaign_plan_versions').select('id, version_number, status, approved_at, approved_by').eq('empresa_id', empresaId).eq('campaign_id', campaignId).eq('id', planId).maybeSingle(),
    supabase.from('campaign_planned_trips').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId).order('created_at', { ascending: true }),
    supabase.from('campaign_trip_freights').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
    supabase.from('campaign_demands').select('target_quantity, quantity_unit').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_locations').select('id, name').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
  ]);
  for (const r of [planRes, tripsRes, linksRes, demandsRes, locationsRes]) throwDb(r.error);

  const plan = planRes.data;
  const trips = tripsRes.data || [];
  const links = linksRes.data || [];
  const demands = demandsRes.data || [];
  const locationsById = new Map((locationsRes.data || []).map((l) => [l.id, l]));

  // Link ATIVO por planned_trip (materialization vigente). Detecta anomalias.
  const activeLinkByTrip = new Map();
  const link_anomalies = [];
  for (const link of links) {
    if (ACTIVE_MATERIALIZATION.has(link.materialization_status)) {
      if (activeLinkByTrip.has(link.planned_trip_id)) {
        link_anomalies.push({ type: 'DUPLICATE_ACTIVE_LINK', planned_trip_id: link.planned_trip_id, frete_id: link.frete_id });
      } else {
        activeLinkByTrip.set(link.planned_trip_id, link);
      }
    }
  }

  // Fretes referenciados pelos links ativos (batch, sem N+1 — §105).
  const freteIds = [...new Set([...activeLinkByTrip.values()].map((l) => l.frete_id).filter(Boolean))];
  let fretesById = new Map();
  if (freteIds.length) {
    const { data: fretes, error: fretesError } = await supabase
      .from('fretes')
      .select('id, status')
      .eq('empresa_id', empresaId)
      .in('id', freteIds);
    throwDb(fretesError);
    fretesById = new Map((fretes || []).map((f) => [f.id, f]));
  }

  // Estado de recursos para readiness dos NÃO materializados (batch — §105).
  const candidateDriverIds = [...new Set(trips.map((t) => t.candidate_driver_id).filter(Boolean))];
  const candidateAssetIds = [...new Set(trips.map((t) => t.candidate_asset_id).filter(Boolean))];
  const candidateCompositionIds = [...new Set(trips.map((t) => t.candidate_composition_id).filter(Boolean))];
  const [driversRes, assetsRes, compsRes, assignmentsRes, docsRes, maintRes] = await Promise.all([
    candidateDriverIds.length ? supabase.from('usuarios').select('id, empresa_id, status').eq('empresa_id', empresaId).in('id', candidateDriverIds) : Promise.resolve({ data: [], error: null }),
    candidateAssetIds.length ? supabase.from('fleet_assets').select('id, empresa_id, status, unidade_operacional_id, useful_capacity_kg, metadata').eq('empresa_id', empresaId).in('id', candidateAssetIds) : Promise.resolve({ data: [], error: null }),
    candidateCompositionIds.length ? supabase.from('vehicle_compositions').select('id, empresa_id, status, unidade_operacional_id, metadata').eq('empresa_id', empresaId).in('id', candidateCompositionIds) : Promise.resolve({ data: [], error: null }),
    (candidateDriverIds.length || candidateAssetIds.length || candidateCompositionIds.length) ? supabase.from('driver_vehicle_assignments').select('*').eq('empresa_id', empresaId).eq('assignment_status', 'active').is('valid_until', null) : Promise.resolve({ data: [], error: null }),
    candidateAssetIds.length ? supabase.from('asset_documents').select('asset_id, status, expires_at').eq('empresa_id', empresaId).in('asset_id', candidateAssetIds) : Promise.resolve({ data: [], error: null }),
    (candidateAssetIds.length || candidateCompositionIds.length) ? supabase.from('maintenance_events').select('asset_id, composition_id, status').eq('empresa_id', empresaId).in('status', ['open', 'scheduled']) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [driversRes, assetsRes, compsRes, assignmentsRes, docsRes, maintRes]) throwDb(r.error);
  const docsByAsset = new Map();
  for (const d of docsRes.data || []) {
    if (!docsByAsset.has(d.asset_id)) docsByAsset.set(d.asset_id, []);
    docsByAsset.get(d.asset_id).push(d);
  }
  const state = {
    driversById: new Map((driversRes.data || []).map((d) => [d.id, d])),
    assetsById: new Map((assetsRes.data || []).map((a) => [a.id, a])),
    compositionsById: new Map((compsRes.data || []).map((c) => [c.id, c])),
    assignments: assignmentsRes.data || [],
    docsByAsset,
    maintenanceTargets: new Set((maintRes.data || []).flatMap((m) => [m.asset_id, m.composition_id].filter(Boolean))),
    operationalScope,
  };

  // ---- Classificação por viagem (exatamente 1 bucket cada — §111) ----------
  const tripCounts = { planned_total: trips.length, not_materialized: 0, materialized: 0, in_execution: 0, completed: 0, cancelled: 0, blocked: 0, unknown: 0 };
  const readiness = { total_operational_needs: trips.length, ready_direct: 0, ready_offer: 0, blocked: 0, already_assigned: 0, executing: 0, completed: 0 };
  const exceptions = [];
  const trips_detail = [];
  const blockedTripIds = [];
  const cancelledTripIds = [];
  const unknownTripIds = [];

  let plannedQtyTon = 0; let materializedQtyTon = 0; let completedQtyTon = 0; let cancelledQtyTon = 0;
  let tripsWithQty = 0; let incompatibleUnits = false;

  for (const trip of trips) {
    const q = toTon(trip.planned_quantity, trip.quantity_unit);
    if (!q.compatible) incompatibleUnits = true;
    if (q.known) tripsWithQty += 1;
    plannedQtyTon += q.value;

    const detail = {
      planned_trip_id: trip.id,
      origem: locationName(locationsById, trip.origin_location_id),
      destino: locationName(locationsById, trip.destination_location_id),
      planned_quantity: finiteNumber(trip.planned_quantity),
      quantity_unit: trip.quantity_unit,
      candidate_driver_id: trip.candidate_driver_id || null,
      candidate_asset_id: trip.candidate_asset_id || null,
      candidate_composition_id: trip.candidate_composition_id || null,
      materialization: 'NOT_MATERIALIZED',
      frete_id: null,
      execution_status: null,
      execution_bucket: null,
      readiness: 'BLOCKED',
      attention: [],
    };

    if (trip.status === 'BLOCKED') {
      tripCounts.blocked += 1;
      blockedTripIds.push(trip.id);
      readiness.blocked += 1;
      detail.materialization = 'NOT_APPLICABLE';
      detail.readiness = 'BLOCKED';
      const reason = trip.constraint_metadata?.reason || 'PLANNING_BLOCKED';
      detail.attention = [reason];
      exceptions.push({ type: 'TRIP_BLOCKED', severity: 'HARD_CONSTRAINT', planned_trip_id: trip.id, evidence: { reason } });
      trips_detail.push(detail);
      continue;
    }

    const link = activeLinkByTrip.get(trip.id);
    if (link) {
      tripCounts.materialized += 1;
      detail.materialization = 'MATERIALIZED';
      detail.frete_id = link.frete_id;
      materializedQtyTon += q.value;
      const freight = fretesById.get(link.frete_id) || null;
      const bucket = freight ? freightStatusToBucket(freight.status) : EXECUTION_BUCKET.UNKNOWN;
      detail.execution_status = freight ? freight.status : null;
      detail.execution_bucket = bucket;
      if (bucket === EXECUTION_BUCKET.COMPLETED) {
        tripCounts.completed += 1; completedQtyTon += q.value;
        readiness.completed += 1; detail.readiness = 'COMPLETED';
      } else if (bucket === EXECUTION_BUCKET.CANCELLED) {
        tripCounts.cancelled += 1; cancelledQtyTon += q.value; cancelledTripIds.push(trip.id);
        readiness.blocked += 1; detail.readiness = 'BLOCKED'; detail.attention = ['FREIGHT_CANCELLED'];
        exceptions.push({ type: 'FREIGHT_CANCELLED', severity: 'WARNING', planned_trip_id: trip.id, frete_id: link.frete_id, evidence: { status: freight?.status || null } });
      } else if (bucket === EXECUTION_BUCKET.IN_EXECUTION) {
        tripCounts.in_execution += 1;
        readiness.executing += 1; detail.readiness = 'ALREADY_EXECUTING';
      } else { // UNKNOWN
        tripCounts.unknown += 1; unknownTripIds.push(trip.id);
        readiness.already_assigned += 1; detail.readiness = 'ALREADY_ASSIGNED'; detail.attention = ['FREIGHT_UNKNOWN_STATUS'];
        if (!freight) link_anomalies.push({ type: 'LINK_MISSING_FREIGHT', planned_trip_id: trip.id, frete_id: link.frete_id });
        exceptions.push({ type: 'FREIGHT_UNKNOWN_STATUS', severity: 'WARNING', planned_trip_id: trip.id, frete_id: link.frete_id, evidence: { status: freight?.status || null, missing_freight: !freight } });
      }
      trips_detail.push(detail);
      continue;
    }

    // Não materializado: readiness pelo candidato armazenado (bounded).
    tripCounts.not_materialized += 1;
    const r = readinessForNotMaterialized(trip, state);
    detail.readiness = r.readiness;
    detail.attention = r.reasons.length ? r.reasons : (r.warnings || []);
    if (r.readiness === 'READY_FOR_DIRECT_ASSIGNMENT') readiness.ready_direct += 1;
    else if (r.readiness === 'READY_FOR_OFFER_DISPATCH') readiness.ready_offer += 1;
    else readiness.blocked += 1;
    exceptions.push({ type: 'TRIP_NOT_MATERIALIZED', severity: 'WARNING', planned_trip_id: trip.id, evidence: { readiness: r.readiness, reasons: r.reasons } });
    if (r.reasons.includes('DRIVER_INACTIVE') || r.reasons.includes('DRIVER_MISSING')) {
      exceptions.push({ type: 'DRIVER_INACTIVE', severity: 'WARNING', planned_trip_id: trip.id, evidence: {} });
    }
    if (r.reasons.includes('RESOURCE_INACTIVE') || r.reasons.includes('RESOURCE_MISSING')) {
      exceptions.push({ type: 'RESOURCE_INACTIVE', severity: 'WARNING', planned_trip_id: trip.id, evidence: {} });
    }
    if (r.reasons.includes('ASSIGNMENT_MISSING')) {
      exceptions.push({ type: 'RESOURCE_ASSIGNMENT_MISSING', severity: 'WARNING', planned_trip_id: trip.id, evidence: {} });
    }
    trips_detail.push(detail);
  }

  // ---- Quantidade (§21/§22) — fonte = quantidade planejada do frete ---------
  const targetTon = demands.reduce((sum, d) => sum + toTon(d.target_quantity, d.quantity_unit).value, 0);
  const demandIncompatible = demands.some((d) => !toTon(d.target_quantity, d.quantity_unit).compatible);
  const remainingTon = Math.max(0, targetTon - completedQtyTon);

  const quantity = {
    unit: 'ton',
    target: round3(targetTon),
    planned: round3(plannedQtyTon),
    materialized: round3(materializedQtyTon),
    completed: round3(completedQtyTon),
    cancelled: round3(cancelledQtyTon),
    remaining: round3(remainingTon),
    coverage: {
      quantity_source: 'PLANNED_FREIGHT_QUANTITY',
      measured_actual_available: false,
      trips_with_quantity: tripsWithQty,
      trips_total: trips.length,
      incompatible_units: incompatibleUnits || demandIncompatible,
    },
    groups: null,
  };

  const window = deriveWindow(campaign);
  const health = deriveHealth(tripCounts);
  const replan = deriveReplan({ trips: tripCounts, quantity, window, blockedTripIds, cancelledTripIds, unknownTripIds });

  return {
    campaign: projectCampaign(campaign),
    approved_plan: plan ? { id: plan.id, version_number: plan.version_number, status: plan.status, approved_at: plan.approved_at || null } : null,
    progress: { trips: tripCounts, quantity },
    trips_detail,
    readiness,
    health,
    exceptions,
    link_anomalies,
    replan,
    window,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  getCampaignProgress,
  toTon,
  deriveHealth,
  deriveReplan,
  deriveWindow,
  ACTIVE_MATERIALIZATION,
};

'use strict';

// Motor DETERMINÍSTICO de elegibilidade para Dispatch (Parte C do Campaign-C).
//
// Responde: "Quem/o quê está atualmente elegível para executar esta necessidade
// operacional planejada?" — SEM ofertar, notificar, travar, designar, aceitar,
// recusar, expirar ou despachar (§40). É uma PROJEÇÃO read-only.
//
// Autoridade dos BLOQUEIOS espelha exatamente a materialização canônica
// (campaignMaterializationService.classifyTrip): motorista ativo, recurso ativo,
// escopo do recurso e vínculo temporal motorista↔recurso ativo. Documentos,
// manutenção e capacidade informam AVISOS (nunca inventam bloqueio, §51/§52).
// Compatibilidade de rota é sempre UNKNOWN (§53 — Route V1 não traz restrição de
// caminhão). Sem score mágico (§56): ordenação estável por categoria objetiva.

const { canAccessUnit } = require('../operationalScopeDomainService');
const { CampaignError } = require('./campaignService');

const ELIGIBILITY = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  ELIGIBLE_WITH_WARNINGS: 'ELIGIBLE_WITH_WARNINGS',
  INELIGIBLE: 'INELIGIBLE',
  UNKNOWN: 'UNKNOWN',
});

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function canUseUnit(operationalScope, unidadeId) {
  if (!unidadeId) {
    return operationalScope?.mode === 'LEGACY_COMPANY'
      || operationalScope?.mode === 'SUPER_ADMIN'
      || operationalScope?.mode === 'GLOBAL'
      || operationalScope?.mode === 'GLOBAL_CORPORATE';
  }
  return canAccessUnit(operationalScope, unidadeId);
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function throwDb(error) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new CampaignError('Schema operacional ainda nao aplicado.', { status: 503, code: 'campaign_schema_missing' });
  }
  throw new CampaignError('Erro de banco ao avaliar elegibilidade.', {
    status: 500,
    code: 'eligibility_database_error',
    details: { db_code: error.code },
  });
}

// Capacidade canônica de um recurso (asset: useful_capacity_kg; composição:
// metadata.*_capacity_kg). Retorna null quando desconhecida (nunca 0 fabricado).
function resourceCapacityKg(resource, resourceType) {
  if (!resource) return null;
  if (resourceType === 'asset') {
    const direct = finiteNumber(resource.useful_capacity_kg);
    if (direct && direct > 0) return direct;
  }
  const metadata = resource.metadata && typeof resource.metadata === 'object' ? resource.metadata : {};
  for (const key of ['usable_capacity_kg', 'useful_capacity_kg', 'capacity_kg']) {
    const v = finiteNumber(metadata[key]);
    if (v && v > 0) return v;
  }
  return null;
}

// Avaliação PURA e determinística de um candidato. Não toca banco.
// `candidate` = { driver, resource, resourceType, activeAssignment, requiredCapacityKg,
//   maintenanceActive, documents, operationalScope }.
function evaluateCandidate(candidate) {
  const {
    driver,
    resource,
    resourceType,
    activeAssignment,
    requiredCapacityKg = null,
    maintenanceActive = false,
    documents = [],
    operationalScope = null,
  } = candidate;

  const reasons = [];
  const warnings = [];

  // --- Bloqueios canônicos (espelham a materialização) -> INELIGIBLE ---
  if (!driver) reasons.push('DRIVER_MISSING');
  else if (String(driver.status || '') !== 'ativo') reasons.push('DRIVER_INACTIVE');

  if (!resource) reasons.push('RESOURCE_MISSING');
  else if (String(resource.status || '') !== 'active') reasons.push('RESOURCE_INACTIVE');

  const unidadeId = resource ? (resource.unidade_operacional_id || null) : null;
  if (resource && !canUseUnit(operationalScope, unidadeId)) reasons.push('RESOURCE_SCOPE_DENIED');

  const assignment_status = activeAssignment ? 'ACTIVE' : 'MISSING';
  if (!activeAssignment) reasons.push('ASSIGNMENT_MISSING');

  // --- Capacidade (§49): compara só se ambos conhecidos; nunca infere por tipo ---
  const capacityKg = resourceCapacityKg(resource, resourceType);
  let capacity_match = 'UNKNOWN';
  if (capacityKg !== null && requiredCapacityKg !== null && requiredCapacityKg > 0) {
    if (capacityKg >= requiredCapacityKg) capacity_match = 'MATCH';
    else { capacity_match = 'INSUFFICIENT'; warnings.push('CAPACITY_INSUFFICIENT'); }
  }

  // --- Documentos (§51): status objetivo canônico do asset_documents ---
  let documents_status = 'DOCUMENTS_UNKNOWN';
  if (resourceType === 'asset' && Array.isArray(documents) && documents.length) {
    const hasExpired = documents.some((d) => String(d.status || '') === 'expired');
    if (hasExpired) { documents_status = 'DOCUMENTS_ATTENTION'; warnings.push('DOCUMENTS_ATTENTION'); }
    else documents_status = 'DOCUMENTS_OK';
  }

  // --- Manutenção (§52): evento aberto/agendado sobre o recurso ---
  let maintenance_status = 'MAINTENANCE_UNKNOWN';
  if (maintenanceActive === true) { maintenance_status = 'MAINTENANCE_ATTENTION'; warnings.push('MAINTENANCE_ATTENTION'); }
  else if (maintenanceActive === false) maintenance_status = 'MAINTENANCE_OK';

  // --- Rota (§53): sempre desconhecida (Route V1 sem restrição de caminhão) ---
  const route_compatibility = 'UNKNOWN';

  let eligibility;
  if (reasons.length) eligibility = ELIGIBILITY.INELIGIBLE;
  else if (warnings.length) eligibility = ELIGIBILITY.ELIGIBLE_WITH_WARNINGS;
  else eligibility = ELIGIBILITY.ELIGIBLE;

  return {
    driver_id: driver ? driver.id : (candidate.driverId || null),
    asset_id: resourceType === 'asset' && resource ? resource.id : null,
    composition_id: resourceType === 'composition' && resource ? resource.id : null,
    resource_type: resourceType,
    unit: unidadeId,
    eligibility,
    reasons,
    warnings,
    capacity_kg: capacityKg,
    required_capacity_kg: requiredCapacityKg,
    capacity_match,
    documents_status,
    maintenance_status,
    assignment_status,
    route_compatibility,
  };
}

// Ordenação determinística estável (§56): ELIGIBLE > WITH_WARNINGS > UNKNOWN >
// INELIGIBLE; depois capacidade desc (desconhecida por último); depois id estável.
const ELIGIBILITY_ORDER = { ELIGIBLE: 0, ELIGIBLE_WITH_WARNINGS: 1, UNKNOWN: 2, INELIGIBLE: 3 };
function stableSort(a, b) {
  const oa = ELIGIBILITY_ORDER[a.eligibility] ?? 9;
  const ob = ELIGIBILITY_ORDER[b.eligibility] ?? 9;
  if (oa !== ob) return oa - ob;
  const ca = a.capacity_kg === null ? -1 : a.capacity_kg;
  const cb = b.capacity_kg === null ? -1 : b.capacity_kg;
  if (cb !== ca) return cb - ca;
  const ida = String(a.composition_id || a.asset_id || '');
  const idb = String(b.composition_id || b.asset_id || '');
  if (ida !== idb) return ida.localeCompare(idb);
  return String(a.driver_id || '').localeCompare(String(b.driver_id || ''));
}

// Carrega o estado canônico e lista candidatos elegíveis para UMA viagem
// planejada. O universo de candidatos são os vínculos temporais motorista↔recurso
// ATIVOS da empresa dentro do escopo (objetos reais, §41), limitado (§58).
async function listTripEligibility(supabase, {
  empresaId,
  campaignId,
  planId,
  tripId,
  operationalScope,
  limit,
} = {}) {
  if (!operationalScope || operationalScope.mode === 'NO_ACCESS' || operationalScope.mode === 'NO_COMPANY') {
    throw new CampaignError('Escopo operacional nao autorizado.', { status: 403, code: 'operational_scope_denied' });
  }
  const topN = normalizeLimit(limit);

  // Campanha + escopo por unidades associadas.
  const { data: campaign, error: campaignError } = await supabase
    .from('operation_campaigns')
    .select('id, empresa_id')
    .eq('empresa_id', empresaId)
    .eq('id', campaignId)
    .maybeSingle();
  throwDb(campaignError);
  if (!campaign) throw new CampaignError('Campanha nao encontrada.', { status: 404, code: 'campaign_not_found' });

  const { data: campaignUnits, error: unitsError } = await supabase
    .from('campaign_operational_units')
    .select('unidade_operacional_id')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  throwDb(unitsError);
  const forbidden = (campaignUnits || [])
    .map((r) => r.unidade_operacional_id)
    .filter(Boolean)
    .filter((id) => !canAccessUnit(operationalScope, id));
  if (forbidden.length) {
    throw new CampaignError('Unidade operacional fora do seu escopo.', {
      status: 403,
      code: 'operational_unit_forbidden',
      details: { unidade_operacional_ids: forbidden },
    });
  }

  // Viagem planejada alvo (tenant + plano + campanha).
  const { data: trip, error: tripError } = await supabase
    .from('campaign_planned_trips')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .eq('plan_version_id', planId)
    .eq('id', tripId)
    .maybeSingle();
  throwDb(tripError);
  if (!trip) throw new CampaignError('Viagem planejada nao encontrada.', { status: 404, code: 'planned_trip_not_found' });

  const requiredCapacityKg = finiteNumber(trip.required_capacity_kg);

  // Vínculos temporais ativos (candidatos reais) + recursos + motoristas.
  const { data: assignments, error: assignmentsError } = await supabase
    .from('driver_vehicle_assignments')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('assignment_status', 'active')
    .is('valid_until', null);
  throwDb(assignmentsError);

  const driverIds = [...new Set((assignments || []).map((a) => a.driver_id).filter(Boolean))];
  const assetIds = [...new Set((assignments || []).map((a) => a.asset_id).filter(Boolean))];
  const compositionIds = [...new Set((assignments || []).map((a) => a.composition_id).filter(Boolean))];

  const [driversRes, assetsRes, compositionsRes] = await Promise.all([
    driverIds.length
      ? supabase.from('usuarios').select('id, empresa_id, status').eq('empresa_id', empresaId).in('id', driverIds)
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase.from('fleet_assets').select('id, empresa_id, status, unidade_operacional_id, plate, useful_capacity_kg, metadata').eq('empresa_id', empresaId).in('id', assetIds)
      : Promise.resolve({ data: [], error: null }),
    compositionIds.length
      ? supabase.from('vehicle_compositions').select('id, empresa_id, status, unidade_operacional_id, metadata').eq('empresa_id', empresaId).in('id', compositionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [driversRes, assetsRes, compositionsRes]) throwDb(r.error);

  const driversById = new Map((driversRes.data || []).map((d) => [d.id, d]));
  const assetsById = new Map((assetsRes.data || []).map((a) => [a.id, a]));
  const compositionsById = new Map((compositionsRes.data || []).map((c) => [c.id, c]));

  // Documentos + manutenção dos recursos candidatos (batch, sem N+1).
  const [docsRes, maintenanceRes] = await Promise.all([
    assetIds.length
      ? supabase.from('asset_documents').select('asset_id, status, expires_at').eq('empresa_id', empresaId).in('asset_id', assetIds)
      : Promise.resolve({ data: [], error: null }),
    (assetIds.length || compositionIds.length)
      ? supabase.from('maintenance_events').select('asset_id, composition_id, status').eq('empresa_id', empresaId).in('status', ['open', 'scheduled'])
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [docsRes, maintenanceRes]) throwDb(r.error);

  const docsByAsset = new Map();
  for (const d of docsRes.data || []) {
    if (!docsByAsset.has(d.asset_id)) docsByAsset.set(d.asset_id, []);
    docsByAsset.get(d.asset_id).push(d);
  }
  const maintenanceTargets = new Set((maintenanceRes.data || [])
    .flatMap((m) => [m.asset_id, m.composition_id].filter(Boolean)));

  // Um candidato por vínculo ativo (par motorista↔recurso real).
  const results = (assignments || []).map((assignment) => {
    const resourceType = assignment.asset_id ? 'asset' : 'composition';
    const resource = assignment.asset_id
      ? assetsById.get(assignment.asset_id) || null
      : compositionsById.get(assignment.composition_id) || null;
    const driver = driversById.get(assignment.driver_id) || null;
    const resourceKey = assignment.asset_id || assignment.composition_id;
    return evaluateCandidate({
      driver,
      driverId: assignment.driver_id,
      resource,
      resourceType,
      activeAssignment: assignment,
      requiredCapacityKg,
      maintenanceActive: resourceKey ? maintenanceTargets.has(resourceKey) : false,
      documents: resourceType === 'asset' ? (docsByAsset.get(assignment.asset_id) || []) : [],
      operationalScope,
    });
  });

  const sorted = results.sort(stableSort);
  const eligibleOrWarning = sorted.filter(
    (r) => r.eligibility === ELIGIBILITY.ELIGIBLE || r.eligibility === ELIGIBILITY.ELIGIBLE_WITH_WARNINGS,
  );

  return {
    trip: {
      id: trip.id,
      plan_version_id: trip.plan_version_id,
      status: trip.status,
      required_capacity_kg: requiredCapacityKg,
      planned_quantity: finiteNumber(trip.planned_quantity),
      quantity_unit: trip.quantity_unit,
      candidate_driver_id: trip.candidate_driver_id || null,
      candidate_asset_id: trip.candidate_asset_id || null,
      candidate_composition_id: trip.candidate_composition_id || null,
    },
    summary: {
      total_candidates: results.length,
      eligible: results.filter((r) => r.eligibility === ELIGIBILITY.ELIGIBLE).length,
      eligible_with_warnings: results.filter((r) => r.eligibility === ELIGIBILITY.ELIGIBLE_WITH_WARNINGS).length,
      ineligible: results.filter((r) => r.eligibility === ELIGIBILITY.INELIGIBLE).length,
      has_any_eligible: eligibleOrWarning.length > 0,
    },
    candidates: sorted.slice(0, topN),
    limit: topN,
    truncated: sorted.length > topN,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  ELIGIBILITY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  evaluateCandidate,
  resourceCapacityKg,
  listTripEligibility,
};

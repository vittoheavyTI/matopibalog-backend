'use strict';

// campaignReplanService — Campaign-D Parte A: replan pós-aprovação
// concurrency-safe. NUNCA edita o plano aprovado (imutável). Sempre cria uma
// NOVA versão sobre a demanda RESIDUAL (meta - executado - comprometido),
// reaproveitando o mesmo planejador determinístico e a mesma persistência de
// versão do Campaign-A (campaignService.planCampaign/persistPlanVersion) —
// nenhuma lógica de planejamento é duplicada aqui.
//
// Segurança de concorrência (§30-32, §84-87): reusa integralmente os índices
// únicos já existentes na migration 076 — campaign_plan_versions_campaign_
// version_key (nº de versão), campaign_plan_versions_one_review_key (só 1
// rascunho por vez) e campaign_plan_versions_one_approved_key (só 1 aprovado
// por vez). Nenhuma migration nova é necessária: aprovar o replan (em
// campaignService.approvePlan) supera a versão antiga ANTES de promover a
// nova, respeitando exatamente esses índices — duas versões nunca podem ficar
// simultaneamente "APPROVED" para a mesma campanha.

const campaign = require('./campaignService');
const { freightStatusToBucket, EXECUTION_BUCKET } = require('./freightExecutionStatus');
const { ACTIVE_MATERIALIZATION, toTon } = require('./campaignProgressService');

const { CampaignError } = campaign;

const REASON_CODES = new Set([
  'FREIGHT_CANCELLED', 'RESOURCE_UNAVAILABLE', 'CAPACITY_GAP',
  'WINDOW_CHANGE', 'OBJECTIVE_CHANGE', 'EXECUTION_DIVERGENCE',
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CampaignError(`Campo obrigatório: ${field}.`, { code: 'missing_field', details: { field } });
  return text;
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function userId(user) {
  return user?.uid || user?.id || null;
}

function throwDb(error, fallbackMessage) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new CampaignError('O módulo de despacho/materialização ainda não está disponível nesta instalação.', { status: 503, code: 'campaign_schema_missing' });
  }
  throw new CampaignError(fallbackMessage || 'Não foi possível processar o replanejamento agora. Tente novamente em instantes.', {
    status: 500, code: 'replan_database_error', details: { db_code: error.code },
  });
}

async function loadReplanContext(supabase, { empresaId, campaignId, operationalScope }) {
  const campaignRow = await campaign.requireCampaign(supabase, { empresaId, campaignId, operationalScope });
  if (campaignRow.status !== 'APPROVED' || !campaignRow.approved_plan_version_id) {
    throw new CampaignError('O replanejamento exige uma campanha com plano aprovado vigente.', {
      status: 409, code: 'replan_requires_approved_plan',
    });
  }
  const planId = campaignRow.approved_plan_version_id;
  const [tripsRes, linksRes, demandsRes, locationsRes, roundsRes] = await Promise.all([
    supabase.from('campaign_planned_trips').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
    supabase.from('campaign_trip_freights').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
    supabase.from('campaign_demands').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('campaign_locations').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId),
    supabase.from('dispatch_rounds').select('*').eq('empresa_id', empresaId).eq('plan_version_id', planId),
  ]);
  for (const r of [tripsRes, linksRes, demandsRes, locationsRes, roundsRes]) throwDb(r.error, 'Erro ao carregar contexto de replan.');

  const freteIds = [...new Set((linksRes.data || [])
    .filter((l) => ACTIVE_MATERIALIZATION.has(l.materialization_status))
    .map((l) => l.frete_id).filter(Boolean))];
  let fretesById = new Map();
  if (freteIds.length) {
    const { data: fretes, error: fretesError } = await supabase
      .from('fretes').select('id,status').eq('empresa_id', empresaId).in('id', freteIds);
    throwDb(fretesError, 'Erro ao carregar fretes vinculados.');
    fretesById = new Map((fretes || []).map((f) => [f.id, f]));
  }

  return {
    campaign: campaignRow,
    planId,
    trips: tripsRes.data || [],
    links: linksRes.data || [],
    demands: demandsRes.data || [],
    locations: locationsRes.data || [],
    rounds: roundsRes.data || [],
    fretesById,
  };
}

// Classifica cada viagem planejada da versão aprovada atual em EXATAMENTE uma
// categoria (§9-19 do prompt):
//   EXECUTED    — Frete concluído. Conta como demanda já satisfeita; nunca replanejar.
//   COMMITTED   — protegido: Frete em execução, OU vencedor de Dispatch já
//                 decidido atomicamente (dispatch_rounds.status=ASSIGNED) aguardando
//                 só a materialização (fase 2) convergir (§12 — o "gap" de duas
//                 fases do Dispatch V1 nunca deve gerar duplicação).
//   CANCELLED   — Frete cancelado; a quantidade volta ao residual por OMISSÃO
//                 (não conta em executado nem comprometido — nunca soma dupla).
//   UNCOMMITTED — nunca foi de fato comprometida: viagem bloqueada/cancelada no
//                 nível do plano, ou só tem a sugestão default do planejador
//                 guloso sem nenhuma ação real de Dispatch/materialização.
//                 Pode ser livremente substituída pelo replan.
//   UNKNOWN     — estado inconsistente (Frete com status fora do mapeamento
//                 conhecido, link sem Frete, ou rodada de Dispatch OPEN
//                 aguardando resposta de motoristas). NUNCA decide sozinho —
//                 bloqueia o replan inteiro para revisão humana.
function classifyTrip(trip, { linksByTrip, fretesById, roundsByTrip }) {
  if (trip.status === 'BLOCKED' || trip.status === 'CANCELLED') {
    return { category: 'UNCOMMITTED', reason: `TRIP_STATUS_${trip.status}` };
  }
  const link = linksByTrip.get(trip.id);
  if (link) {
    const freight = fretesById.get(link.frete_id) || null;
    if (!freight) return { category: 'UNKNOWN', reason: 'MATERIALIZED_LINK_MISSING_FREIGHT' };
    const bucket = freightStatusToBucket(freight.status);
    if (bucket === EXECUTION_BUCKET.COMPLETED) return { category: 'EXECUTED', reason: 'FREIGHT_COMPLETED' };
    if (bucket === EXECUTION_BUCKET.IN_EXECUTION) return { category: 'COMMITTED', reason: 'FREIGHT_IN_EXECUTION' };
    if (bucket === EXECUTION_BUCKET.CANCELLED) return { category: 'CANCELLED', reason: 'FREIGHT_CANCELLED' };
    return { category: 'UNKNOWN', reason: 'FREIGHT_UNKNOWN_STATUS' };
  }
  const rounds = roundsByTrip.get(trip.id) || [];
  if (rounds.some((r) => r.status === 'OPEN')) {
    return { category: 'UNKNOWN', reason: 'DISPATCH_ROUND_OPEN_AWAITING_RESOLUTION' };
  }
  if (rounds.some((r) => r.status === 'ASSIGNED')) {
    return { category: 'COMMITTED', reason: 'DISPATCH_WINNER_MATERIALIZATION_PENDING' };
  }
  return { category: 'UNCOMMITTED', reason: 'NEVER_DISPATCHED_OR_MATERIALIZED' };
}

function classifyAllTrips(context) {
  const linksByTrip = new Map();
  for (const link of context.links) {
    if (ACTIVE_MATERIALIZATION.has(link.materialization_status)) linksByTrip.set(link.planned_trip_id, link);
  }
  const roundsByTrip = new Map();
  for (const round of context.rounds) {
    if (!roundsByTrip.has(round.planned_trip_id)) roundsByTrip.set(round.planned_trip_id, []);
    roundsByTrip.get(round.planned_trip_id).push(round);
  }
  const byCategory = { EXECUTED: [], COMMITTED: [], CANCELLED: [], UNCOMMITTED: [], UNKNOWN: [] };
  const detail = [];
  for (const trip of context.trips) {
    const result = classifyTrip(trip, { linksByTrip, fretesById: context.fretesById, roundsByTrip });
    byCategory[result.category].push(trip);
    detail.push({
      planned_trip_id: trip.id,
      demand_id: trip.demand_id,
      category: result.category,
      reason: result.reason,
      planned_quantity: finiteNumber(trip.planned_quantity),
      quantity_unit: trip.quantity_unit,
    });
  }
  return { byCategory, detail };
}

// Demanda residual por linha de campaign_demands (§17): meta - executado -
// comprometido, nunca abaixo de zero. Sem dupla contagem (§18): cada viagem
// entra em exatamente 1 categoria, e só EXECUTED/COMMITTED reduzem o residual.
function computeResidualDemands(demands, classification) {
  const executedByDemand = new Map();
  const committedByDemand = new Map();
  for (const trip of classification.detail) {
    if (!trip.demand_id) continue;
    const q = toTon(trip.planned_quantity, trip.quantity_unit).value;
    if (trip.category === 'EXECUTED') executedByDemand.set(trip.demand_id, (executedByDemand.get(trip.demand_id) || 0) + q);
    if (trip.category === 'COMMITTED') committedByDemand.set(trip.demand_id, (committedByDemand.get(trip.demand_id) || 0) + q);
  }
  const breakdown = [];
  const effectiveDemands = [];
  for (const demand of demands) {
    const targetTon = toTon(demand.target_quantity, demand.quantity_unit).value;
    const executedTon = executedByDemand.get(demand.id) || 0;
    const committedTon = committedByDemand.get(demand.id) || 0;
    const residualTon = Math.max(0, targetTon - executedTon - committedTon);
    breakdown.push({
      demand_id: demand.id,
      origin_location_id: demand.origin_location_id,
      destination_location_id: demand.destination_location_id,
      target_ton: round3(targetTon),
      executed_ton: round3(executedTon),
      committed_ton: round3(committedTon),
      residual_ton: round3(residualTon),
    });
    if (residualTon > 0) {
      effectiveDemands.push({ ...demand, target_quantity: residualTon, quantity_unit: 'ton' });
    }
  }
  return { effectiveDemands, breakdown };
}

// Preview (§36/§37): read-only, nunca escreve. Mostra meta original, já
// concluído, já comprometido, cancelado/liberado e o residual a planejar —
// antes de o manager confirmar a geração do replan.
async function previewReplan(supabase, { empresaId, campaignId, operationalScope }) {
  const context = await loadReplanContext(supabase, { empresaId, campaignId, operationalScope });
  const classification = classifyAllTrips(context);
  const { effectiveDemands, breakdown } = computeResidualDemands(context.demands, classification);
  return {
    blocked: classification.byCategory.UNKNOWN.length > 0,
    blocking_trip_ids: classification.byCategory.UNKNOWN.map((t) => t.id),
    executed_trip_count: classification.byCategory.EXECUTED.length,
    committed_trip_count: classification.byCategory.COMMITTED.length,
    cancelled_trip_count: classification.byCategory.CANCELLED.length,
    uncommitted_trip_count: classification.byCategory.UNCOMMITTED.length,
    demand_breakdown: breakdown,
    residual_total_ton: round3(breakdown.reduce((sum, d) => sum + d.residual_ton, 0)),
    has_residual: effectiveDemands.length > 0,
  };
}

// Geração do replan (§20-22): snapshot imutável de entrada + planejador
// determinístico já existente sobre a demanda residual apenas. NUNCA toca
// campaign.status (permanece APPROVED — a versão antiga continua sendo a
// autoridade corrente até este rascunho ser explicitamente aprovado, §24).
async function generateReplan(supabase, { empresaId, user, campaignId, body = {}, operationalScope = null, correlation = {} }) {
  const reason = requiredText(body.reason, 'reason');
  const reasonCode = optionalText(body.reason_code);
  if (reasonCode && !REASON_CODES.has(reasonCode)) {
    throw new CampaignError('Código de motivo de replanejamento inválido.', { code: 'invalid_reason_code' });
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
    throwDb(existingError, 'Erro ao verificar replan idempotente.');
    if (existing) return campaign.getPlan(supabase, { empresaId, campaignId, planId: existing.id, operationalScope });
  }

  const context = await loadReplanContext(supabase, { empresaId, campaignId, operationalScope });
  const classification = classifyAllTrips(context);
  if (classification.byCategory.UNKNOWN.length > 0) {
    throw new CampaignError('Não foi possível replanejar porque há viagens em estado inconsistente. Revise essas viagens antes de continuar.', {
      status: 409,
      code: 'blocking_replan_exception',
      details: { planned_trip_ids: classification.byCategory.UNKNOWN.map((t) => t.id) },
    });
  }
  const { effectiveDemands, breakdown } = computeResidualDemands(context.demands, classification);
  if (!effectiveDemands.length) {
    throw new CampaignError('Não há demanda restante para replanejar — a meta já está totalmente executada ou comprometida.', {
      status: 409, code: 'replan_not_needed',
    });
  }

  const planningData = await campaign.loadPlanningData(supabase, { empresaId, campaignId });
  const unitIds = planningData.units.map((row) => row.unidade_operacional_id);
  campaign.requireUnitsWithinScope(operationalScope, unitIds, { requireAny: true });
  const resources = campaign.buildResourceCandidates({
    assets: planningData.assets,
    compositions: planningData.compositions,
    assignments: planningData.assignments,
    maintenance: planningData.maintenance,
    documents: planningData.documents,
    unitIds,
  });
  const planned = campaign.planCampaign({
    campaign: context.campaign, locations: context.locations, demands: effectiveDemands, resources,
  });
  planned.resourcesUsed = resources;

  const plan = await campaign.persistPlanVersion(supabase, {
    empresaId, campaignId, planned, unitIds, requestId, user, correlation,
    extraAssumptions: {
      replan_snapshot: {
        previous_plan_version_id: context.planId,
        reason,
        reason_code: reasonCode,
        executed_trip_count: classification.byCategory.EXECUTED.length,
        committed_trip_count: classification.byCategory.COMMITTED.length,
        cancelled_trip_count: classification.byCategory.CANCELLED.length,
        uncommitted_trip_count: classification.byCategory.UNCOMMITTED.length,
        demand_breakdown: breakdown,
        generated_at: new Date().toISOString(),
      },
    },
  });
  return campaign.getPlan(supabase, { empresaId, campaignId, planId: plan.id, operationalScope });
}

module.exports = {
  classifyTrip,
  classifyAllTrips,
  computeResidualDemands,
  loadReplanContext,
  previewReplan,
  generateReplan,
  REASON_CODES,
};

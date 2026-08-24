'use strict';

// operationOrchestratorService — camada FINA de orquestração (E3.1/E3.2).
// NÃO é uma nova autoridade de negócio: compõe campaignService (objetivo/plano/
// aprovação) + campaignProgressService (progresso/saúde/replan advisory) já
// existentes, sem duplicar nenhuma regra. Determinística, sem IA, sem escrita
// automática além do que o usuário confirmou explicitamente (POST /objective
// ainda executa exatamente os mesmos passos que o manager faria manualmente:
// criar campanha -> locais -> demandas -> gerar plano).

const campaign = require('./campaignService');
const { getCampaignProgress } = require('./campaignProgressService');

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---- next_action determinístico (§35) -------------------------------------
// Composto inteiramente de sinais já existentes: campaign.status, status do
// plano mais recente, exceções (severidade/tipo), e progress.health/replan/
// readiness (Campaign-C). Nenhuma regra nova é inventada aqui.
function deriveNextAction({ campaign: camp, locations = [], demands = [], latestPlan = null, planExceptions = [], progress = null }) {
  if (camp.status === 'CANCELLED') {
    return { next_action: 'CAMPAIGN_CANCELLED', reason_code: 'CAMPAIGN_CANCELLED', reason_text: 'Esta campanha foi cancelada.' };
  }

  const hasOrigin = locations.some((l) => l.kind === 'origin');
  const hasDestination = locations.some((l) => l.kind === 'destination');
  if (camp.status !== 'APPROVED' && (!hasOrigin || !hasDestination || demands.length === 0)) {
    return {
      next_action: 'COMPLETE_MISSING_OBJECTIVE',
      reason_code: 'MISSING_OBJECTIVE_DATA',
      reason_text: 'Informe origem, destino e quantidade para o sistema poder planejar.',
    };
  }

  if (camp.status === 'APPROVED' && progress) {
    if (progress.replan?.status === 'REPLAN_REQUIRED_BY_INVARIANT') {
      return {
        next_action: 'REPLAN_REQUIRED',
        reason_code: progress.replan.reason_code,
        reason_text: progress.replan.suggested_next_step || 'Há capacidade insuficiente no plano aprovado.',
      };
    }
    if ((progress.readiness?.blocked || 0) > 0) {
      return {
        next_action: 'REVIEW_BLOCKING_EXCEPTION',
        reason_code: 'TRIP_BLOCKED',
        reason_text: 'Há viagens bloqueadas que precisam de decisão antes de continuar.',
      };
    }
    if ((progress.readiness?.ready_offer || 0) > 0) {
      return {
        next_action: 'READY_FOR_DISPATCH',
        reason_code: 'TRIPS_READY_FOR_DISPATCH',
        reason_text: 'Há viagens prontas para designação ou oferta a motoristas elegíveis.',
      };
    }
    if ((progress.readiness?.ready_direct || 0) > 0) {
      return {
        next_action: 'READY_FOR_MATERIALIZATION',
        reason_code: 'TRIPS_READY_FOR_MATERIALIZATION',
        reason_text: 'Há viagens com executor definido, prontas para virar frete.',
      };
    }
    if (progress.replan?.status === 'REPLAN_RECOMMENDED') {
      return {
        next_action: 'REVIEW_EXECUTION_EXCEPTION',
        reason_code: progress.replan.reason_code,
        reason_text: progress.replan.suggested_next_step || 'Há uma exceção de execução que merece revisão.',
      };
    }
    if (progress.health?.state === 'COMPLETED') {
      return { next_action: 'CAMPAIGN_COMPLETE', reason_code: 'ALL_TRIPS_COMPLETED', reason_text: 'Todas as viagens planejadas foram concluídas.' };
    }
    if ((progress.progress?.trips?.in_execution || 0) > 0) {
      return { next_action: 'EXECUTION_IN_PROGRESS', reason_code: 'TRIPS_IN_EXECUTION', reason_text: 'A operação está em execução, sem pendências no momento.' };
    }
    return { next_action: 'EXECUTION_IN_PROGRESS', reason_code: 'AWAITING_FIRST_MATERIALIZATION', reason_text: 'Plano aprovado, aguardando a primeira materialização ou designação.' };
  }

  if (latestPlan && latestPlan.status === 'READY_FOR_REVIEW') {
    const openHard = (planExceptions || []).filter((e) => e.severity === 'HARD_CONSTRAINT' && e.status === 'OPEN');
    const capacityGap = openHard.filter((e) => e.exception_type === 'INSUFFICIENT_CAPACITY');
    if (capacityGap.length) {
      return {
        next_action: 'REVIEW_CAPACITY_GAP',
        reason_code: 'INSUFFICIENT_CAPACITY',
        reason_text: 'A capacidade própria disponível não cobre toda a demanda declarada.',
      };
    }
    if (openHard.length) {
      return {
        next_action: 'REVIEW_BLOCKING_EXCEPTION',
        reason_code: openHard[0].exception_type,
        reason_text: 'Há um bloqueio objetivo no plano que impede a aprovação.',
      };
    }
    return { next_action: 'APPROVE_PLAN', reason_code: 'PLAN_READY', reason_text: 'O plano está pronto para revisão e aprovação.' };
  }

  return { next_action: 'GENERATE_PLAN', reason_code: 'OBJECTIVE_READY', reason_text: 'Origem, destino e quantidade já informados — gere o plano.' };
}

async function getCampaignOrchestration(supabase, { empresaId, campaignId, operationalScope = null } = {}) {
  const detail = await campaign.getCampaign(supabase, { empresaId, campaignId, operationalScope });
  const latestPlan = detail.plans?.[0] || null;
  let planExceptions = [];
  let planDetail = null;
  if (latestPlan) {
    planDetail = await campaign.getPlan(supabase, { empresaId, campaignId, planId: latestPlan.id, operationalScope });
    planExceptions = planDetail.exceptions || [];
  }
  const progress = detail.campaign.status === 'APPROVED'
    ? await getCampaignProgress(supabase, { empresaId, campaignId, operationalScope })
    : null;

  const action = deriveNextAction({
    campaign: detail.campaign,
    locations: detail.locations,
    demands: detail.demands,
    latestPlan,
    planExceptions,
    progress,
  });

  return {
    campaign: detail.campaign,
    objective: {
      cargo_name: detail.campaign.cargo_name,
      target_quantity: detail.demands.reduce((sum, d) => sum + (finiteNumber(d.target_quantity) || 0), 0),
      quantity_unit: detail.demands[0]?.quantity_unit || null,
      origin: detail.locations.find((l) => l.kind === 'origin')?.name || null,
      destination: detail.locations.find((l) => l.kind === 'destination')?.name || null,
      planned_start: detail.campaign.planned_start,
      planned_end: detail.campaign.planned_end,
    },
    next_action: action.next_action,
    next_action_reason_code: action.reason_code,
    next_action_reason_text: action.reason_text,
    plan_summary: planDetail ? { plan: planDetail.plan, exceptions_open: planExceptions.filter((e) => e.status === 'OPEN').length } : null,
    progress_summary: progress ? { health: progress.health, readiness: progress.readiness, replan: progress.replan, quantity: progress.progress.quantity } : null,
  };
}

// ---- criação guiada (§13/§57-58): um único payload de objetivo ------------
// Reusa createCampaign + replaceLocations + replaceDemands + generatePlan sem
// duplicar NENHUMA regra. Idempotente pelo mesmo client_request_id passado a
// createCampaign/generatePlan (replaceLocations/replaceDemands já são
// delete+insert, naturalmente seguros a repetição do mesmo payload).
function requiredObjectiveText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new campaign.CampaignError(`Campo obrigatorio: ${field}.`, { code: 'missing_field', details: { field } });
  return text;
}

async function createObjective(supabase, { empresaId, user, body = {}, operationalScope = null, correlation = {} } = {}) {
  const clientRequestId = typeof body.client_request_id === 'string' && body.client_request_id.trim() ? body.client_request_id.trim() : `objective-${Date.now()}`;

  const created = await campaign.createCampaign(supabase, {
    empresaId,
    user,
    operationalScope,
    correlation,
    body: {
      reference_code: body.reference_code || clientRequestId,
      name: requiredObjectiveText(body.name, 'name'),
      cargo_name: requiredObjectiveText(body.cargo_name, 'cargo_name'),
      priority: body.priority,
      planned_start: body.planned_start,
      planned_end: body.planned_end,
      operational_unit_ids: body.operational_unit_ids,
      client_request_id: clientRequestId,
    },
  });

  // Replay do mesmo client_request_id: createCampaign já devolveu a campanha
  // existente (idempotente); se ela já saiu de DRAFT/PLANNING, os passos
  // seguintes (locais/demandas/gerar plano) já rodaram numa chamada anterior
  // e replaceLocations rejeitaria por campaign_locked. Devolve o estado atual
  // em vez de tentar reexecutar uma sequência que já terminou.
  if (created.status !== 'DRAFT' && created.status !== 'PLANNING') {
    const existingDetail = await campaign.getCampaign(supabase, { empresaId, campaignId: created.id, operationalScope });
    const latestPlan = existingDetail.plans?.[0] || null;
    const plan = latestPlan ? await campaign.getPlan(supabase, { empresaId, campaignId: created.id, planId: latestPlan.id, operationalScope }) : null;
    return { campaign: created, plan };
  }

  await campaign.replaceLocations(supabase, {
    empresaId,
    user,
    campaignId: created.id,
    operationalScope,
    body: {
      locations: [
        { kind: 'origin', name: requiredObjectiveText(body.origin, 'origin'), unidade_operacional_id: body.origin_unidade_operacional_id || null, location_type: 'operational', priority: 10 },
        { kind: 'destination', name: requiredObjectiveText(body.destination, 'destination'), unidade_operacional_id: body.destination_unidade_operacional_id || null, location_type: 'operational', priority: 20 },
      ],
    },
  });

  const detail = await campaign.getCampaign(supabase, { empresaId, campaignId: created.id, operationalScope });
  const origin = detail.locations.find((l) => l.kind === 'origin');
  const destination = detail.locations.find((l) => l.kind === 'destination');

  await campaign.replaceDemands(supabase, {
    empresaId,
    user,
    campaignId: created.id,
    operationalScope,
    body: {
      demands: [{
        origin_location_id: origin.id,
        destination_location_id: destination.id,
        cargo_name: created.cargo_name,
        target_quantity: finiteNumber(body.target_quantity) ?? 0,
        quantity_unit: body.quantity_unit || 'ton',
      }],
    },
  });

  const plan = await campaign.generatePlan(supabase, {
    empresaId,
    user,
    campaignId: created.id,
    operationalScope,
    correlation,
    body: { client_request_id: `${clientRequestId}-plan` },
  });

  return { campaign: created, plan };
}

module.exports = {
  deriveNextAction,
  getCampaignOrchestration,
  createObjective,
};

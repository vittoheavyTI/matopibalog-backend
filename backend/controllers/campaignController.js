'use strict';

const supabase = require('../config/supabase');
const campaign = require('../services/campaign/campaignService');
const campaignMaterialization = require('../services/campaign/campaignMaterializationService');
const campaignProgress = require('../services/campaign/campaignProgressService');
const dispatchEligibility = require('../services/campaign/dispatchEligibilityService');
const dispatchService = require('../services/campaign/dispatchService');
const orchestrator = require('../services/campaign/operationOrchestratorService');
const replanService = require('../services/campaign/campaignReplanService');
const { buildCorrelationContext } = require('../services/verifiability/correlationContext');

function responderErro(res, error) {
  if (error instanceof campaign.CampaignError) {
    return res.status(error.status).json({ message: error.message, code: error.code, details: error.details || undefined });
  }
  console.error('[campaignController] erro:', error?.message || error);
  return res.status(500).json({ message: 'Erro ao processar campanha operacional.' });
}

function correlation(req) {
  return req.correlation || buildCorrelationContext({ headers: req.headers });
}

const listarCampanhas = async (req, res) => {
  try {
    const itens = await campaign.listCampaigns(supabase, { empresaId: req.empresa_id, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const obterContexto = async (req, res) => {
  try {
    const scope = req.operationalScope || {};
    const ids = scope.mode === 'LEGACY_COMPANY' || scope.mode === 'SUPER_ADMIN'
      ? (scope.all_unit_ids || scope.authorized_unit_ids || [])
      : (scope.allowed_unit_ids || []);
    let unidades = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from('unidades_operacionais')
        .select('id,nome,codigo,status,is_default')
        .eq('empresa_id', req.empresa_id)
        .in('id', ids)
        .eq('status', 'ativo')
        .order('nome', { ascending: true });
      if (error) throw error;
      unidades = data || [];
    }
    return res.json({
      scope: {
        mode: scope.mode,
        authority_level: scope.authority_level,
        has_operational_structure: scope.has_operational_structure,
        allowed_unit_ids: ids,
      },
      unidades,
    });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarCampanha = async (req, res) => {
  try {
    const item = await campaign.createCampaign(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope, correlation: correlation(req) });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const detalharCampanha = async (req, res) => {
  try {
    const item = await campaign.getCampaign(supabase, { empresaId: req.empresa_id, campaignId: req.params.campaignId, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const atualizarRascunho = async (req, res) => {
  try {
    const item = await campaign.updateDraft(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const substituirLocais = async (req, res) => {
  try {
    const itens = await campaign.replaceLocations(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const substituirDemandas = async (req, res) => {
  try {
    const itens = await campaign.replaceDemands(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const gerarPlano = async (req, res) => {
  try {
    const item = await campaign.generatePlan(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, body: req.body || {}, operationalScope: req.operationalScope, correlation: correlation(req) });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const obterPlano = async (req, res) => {
  try {
    const item = await campaign.getPlan(supabase, { empresaId: req.empresa_id, campaignId: req.params.campaignId, planId: req.params.planId, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const aprovarPlano = async (req, res) => {
  try {
    const item = await campaign.approvePlan(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, planId: req.params.planId, body: req.body || {}, operationalScope: req.operationalScope, correlation: correlation(req) });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const rejeitarPlano = async (req, res) => {
  try {
    const item = await campaign.rejectPlan(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, planId: req.params.planId, body: req.body || {}, operationalScope: req.operationalScope, correlation: correlation(req) });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const cancelarCampanha = async (req, res) => {
  try {
    const item = await campaign.cancelCampaign(supabase, { empresaId: req.empresa_id, user: req.user, campaignId: req.params.campaignId, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const verificarPlano = async (req, res) => {
  try {
    const item = await campaign.verifyCampaignPlan(supabase, { empresaId: req.empresa_id, campaignId: req.params.campaignId, planId: req.params.planId, correlation: correlation(req) });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const preverMaterializacao = async (req, res) => {
  try {
    const item = await campaignMaterialization.previewMaterialization(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      operationalScope: req.operationalScope,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const materializarPlano = async (req, res) => {
  try {
    const item = await campaignMaterialization.materializePlan(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      user: req.user,
      operationalScope: req.operationalScope,
      body: req.body || {},
      correlation: correlation(req),
    });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /:campaignId/progress — projeção read-only do progresso operacional
// (trips + quantidade + saúde + exceções + readiness + replan). Autoridade
// única: campaignProgressService (§12). Nunca escreve/despacha.
const obterProgresso = async (req, res) => {
  try {
    const item = await campaignProgress.getCampaignProgress(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      operationalScope: req.operationalScope,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /:campaignId/plans/:planId/trips/:tripId/eligibility — candidatos elegíveis
// determinísticos para UMA viagem planejada. Read-only; não oferta nem designa.
const obterElegibilidade = async (req, res) => {
  try {
    const item = await dispatchEligibility.listTripEligibility(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      tripId: req.params.tripId,
      operationalScope: req.operationalScope,
      limit: req.query?.limit,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /:campaignId/plans/:planId/trips/:tripId/dispatch/candidates — mesma prévia de
// elegibilidade do §eligibility, exposta também sob /dispatch para a UI de designação
// (§51 — preview antes de designar/ofertar).
const previaDispatch = async (req, res) => {
  try {
    const item = await dispatchService.previewCandidates(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      tripId: req.params.tripId,
      operationalScope: req.operationalScope,
      limit: req.query?.limit,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /:campaignId/plans/:planId/trips/:tripId/dispatch/direct-assign — designação
// direta a UM candidato hoje elegível. Revalida no momento da mutação; converge para o
// Frete canônico. Nunca oferta/expira/concorre — decisão do manager é imediata.
const designarDireto = async (req, res) => {
  try {
    const body = req.body || {};
    const item = await dispatchService.directAssign(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      tripId: req.params.tripId,
      driverId: body.driver_id,
      assetId: body.asset_id || null,
      compositionId: body.composition_id || null,
      materializationOptions: body.materialization_options || body,
      user: req.user,
      operationalScope: req.operationalScope,
      correlation: correlation(req),
    });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /:campaignId/plans/:planId/trips/:tripId/dispatch/rounds — cria rodada de oferta
// (mode=OFFER). "recipients" opcional: subconjunto explícito do manager, interceptado
// com quem está REALMENTE elegível agora (§12); vazio = todos os elegíveis.
const criarRodadaOferta = async (req, res) => {
  try {
    const body = req.body || {};
    const item = await dispatchService.createOfferRound(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      planId: req.params.planId,
      tripId: req.params.tripId,
      requestedRecipients: Array.isArray(body.recipients) ? body.recipients : null,
      expiresAt: body.expires_at,
      materializationOptions: body.materialization_options || body,
      user: req.user,
      operationalScope: req.operationalScope,
      correlation: correlation(req),
    });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /:campaignId/plans/:planId/trips/:tripId/dispatch/rounds/:roundId — status da
// rodada (histórico de ofertas, vencedor se houver).
const obterRodada = async (req, res) => {
  try {
    const item = await dispatchService.getRound(supabase, {
      empresaId: req.empresa_id,
      roundId: req.params.roundId,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /:campaignId/plans/:planId/trips/:tripId/dispatch/rounds/:roundId/cancel
const cancelarRodada = async (req, res) => {
  try {
    const item = await dispatchService.cancelRound(supabase, {
      empresaId: req.empresa_id,
      roundId: req.params.roundId,
      actorId: req.user?.uid || req.user?.id || null,
      reason: req.body?.reason || null,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /operation-campaigns/objective — fluxo guiado (§13/§57-58): um único
// payload de objetivo (nome, carga, quantidade, origem, destino, janela) em
// vez de 4 chamadas separadas. Reusa create->locations->demands->generatePlan
// sem duplicar nenhuma regra (operationOrchestratorService).
const criarObjetivo = async (req, res) => {
  try {
    const item = await orchestrator.createObjective(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope, correlation: correlation(req) });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /operation-campaigns/:campaignId/orchestration — resumo do objetivo +
// next_action determinístico (§35/§36): "o que preciso fazer agora?". Read-only,
// composição pura sobre campaignService + campaignProgressService.
const obterOrquestracao = async (req, res) => {
  try {
    const item = await orchestrator.getCampaignOrchestration(supabase, { empresaId: req.empresa_id, campaignId: req.params.campaignId, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// GET /:campaignId/replan/preview — resumo read-only (§36) do que já foi
// executado/comprometido/cancelado e quanto resta a replanejar. Nunca escreve.
const preverReplan = async (req, res) => {
  try {
    const item = await replanService.previewReplan(supabase, {
      empresaId: req.empresa_id,
      campaignId: req.params.campaignId,
      operationalScope: req.operationalScope,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /:campaignId/replan — gera uma NOVA versão de plano sobre a demanda
// residual (§20-22). Nunca toca a versão aprovada atual; campanha continua
// APPROVED até este rascunho ser explicitamente aprovado via o endpoint já
// existente de aprovação de plano.
const criarReplan = async (req, res) => {
  try {
    const item = await replanService.generateReplan(supabase, {
      empresaId: req.empresa_id,
      user: req.user,
      campaignId: req.params.campaignId,
      body: req.body || {},
      operationalScope: req.operationalScope,
      correlation: correlation(req),
    });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

module.exports = {
  obterContexto,
  obterProgresso,
  obterElegibilidade,
  obterOrquestracao,
  criarObjetivo,
  preverReplan,
  criarReplan,
  listarCampanhas,
  criarCampanha,
  detalharCampanha,
  atualizarRascunho,
  substituirLocais,
  substituirDemandas,
  gerarPlano,
  obterPlano,
  aprovarPlano,
  rejeitarPlano,
  cancelarCampanha,
  verificarPlano,
  preverMaterializacao,
  materializarPlano,
  previaDispatch,
  designarDireto,
  criarRodadaOferta,
  obterRodada,
  cancelarRodada,
};

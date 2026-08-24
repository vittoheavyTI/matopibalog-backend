'use strict';

const supabase = require('../config/supabase');
const campaign = require('../services/campaign/campaignService');
const campaignMaterialization = require('../services/campaign/campaignMaterializationService');
const campaignProgress = require('../services/campaign/campaignProgressService');
const dispatchEligibility = require('../services/campaign/dispatchEligibilityService');
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

module.exports = {
  obterContexto,
  obterProgresso,
  obterElegibilidade,
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
};

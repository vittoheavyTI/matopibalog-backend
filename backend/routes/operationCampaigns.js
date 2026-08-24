'use strict';

const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { ensureEffective } = require('../middlewares/requirePermission');
const {
  resolverEscopoOperacional,
  escopoTemSelecaoInvalida,
} = require('../services/operationalScopeService');
const controller = require('../controllers/campaignController');

const router = express.Router();

async function resolverEscopoCampaign(req, res, next) {
  try {
    const scope = await resolverEscopoOperacional(req, { empresaId: req.empresa_id });
    if (scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.', denial: 'scope_denied' });
    }
    if (escopoTemSelecaoInvalida(scope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.', denial: 'scope_denied' });
    }
    req.operationalScope = scope;
    return next();
  } catch (err) {
    console.error('[campaign:operational-scope]', err?.message || err);
    return res.status(500).json({ message: 'Erro ao validar escopo operacional.' });
  }
}

function requireCampaignPermission(permissionKey) {
  return async function (req, res, next) {
    try {
      if (req.user && req.user.is_super_admin === true) return next();
      const eff = await ensureEffective(req);
      if (eff?.permissions?.[permissionKey] === true) return next();
      const source = eff?.source?.[permissionKey] || 'default_deny';
      const entitlementDenied = source === 'entitlement_denied';
      return res.status(403).json({
        message: entitlementDenied
          ? 'Campanhas de escoamento nao estao habilitadas para esta empresa.'
          : 'Permissao insuficiente para campanhas de escoamento.',
        permission: permissionKey,
        denial: entitlementDenied ? 'entitlement_denied' : 'permission_denied',
        entitlement: 'operation_campaign',
      });
    } catch (err) {
      console.error('[campaign:permission]', err?.message || err);
      return res.status(500).json({ message: 'Erro ao verificar permissao.' });
    }
  };
}

router.use(verifyToken, verificarEmpresa, verificarPlano, resolverEscopoCampaign);

router.get('/context', requireCampaignPermission('campaign.view'), controller.obterContexto);
router.get('/', requireCampaignPermission('campaign.view'), controller.listarCampanhas);
router.post('/', requireCampaignPermission('campaign.create'), controller.criarCampanha);
// Fluxo guiado (Operation Orchestrator V1 — §13): objetivo único em vez de
// criar+locais+demandas+plano separados. Gate = campaign.manage (é a permissão
// mais restritiva dentre os passos que compõe; nunca concede mais do que o
// fluxo granular já permitiria a quem tem create+manage+plan).
router.post('/objective', requireCampaignPermission('campaign.manage'), controller.criarObjetivo);
router.get('/:campaignId', requireCampaignPermission('campaign.view'), controller.detalharCampanha);
router.get('/:campaignId/progress', requireCampaignPermission('campaign.view'), controller.obterProgresso);
router.get('/:campaignId/orchestration', requireCampaignPermission('campaign.view'), controller.obterOrquestracao);
// Replan pós-aprovação (Campaign-D §78): mesmas permissões de gerar/aprovar um
// plano normal (campaign.plan) — nenhuma permissão nova. A aprovação em si
// reusa o endpoint já existente /plans/:planId/approve (campaign.approve).
router.get('/:campaignId/replan/preview', requireCampaignPermission('campaign.plan'), controller.preverReplan);
router.post('/:campaignId/replan', requireCampaignPermission('campaign.plan'), controller.criarReplan);
router.get('/:campaignId/plans/:planId/trips/:tripId/eligibility', requireCampaignPermission('campaign.manage'), controller.obterElegibilidade);
router.patch('/:campaignId', requireCampaignPermission('campaign.manage'), controller.atualizarRascunho);
router.put('/:campaignId/locations', requireCampaignPermission('campaign.manage'), controller.substituirLocais);
router.put('/:campaignId/demands', requireCampaignPermission('campaign.manage'), controller.substituirDemandas);
router.post('/:campaignId/plans', requireCampaignPermission('campaign.plan'), controller.gerarPlano);
router.get('/:campaignId/plans/:planId', requireCampaignPermission('campaign.view'), controller.obterPlano);
router.post('/:campaignId/plans/:planId/approve', requireCampaignPermission('campaign.approve'), controller.aprovarPlano);
router.post('/:campaignId/plans/:planId/reject', requireCampaignPermission('campaign.approve'), controller.rejeitarPlano);
router.post('/:campaignId/plans/:planId/verify', requireCampaignPermission('campaign.view'), controller.verificarPlano);
router.get('/:campaignId/plans/:planId/materialization-preview', requireCampaignPermission('campaign.manage'), controller.preverMaterializacao);
router.post('/:campaignId/plans/:planId/materialize', requireCampaignPermission('campaign.manage'), controller.materializarPlano);
router.post('/:campaignId/cancel', requireCampaignPermission('campaign.manage'), controller.cancelarCampanha);

// Dispatch V1 (§43): campaign.dispatch é mais restritiva que campaign.manage — decide
// quem executa a operação (designação/oferta real), não só planeja. Leitura de status da
// rodada usa campaign.view (mesmo nível de /progress).
router.get('/:campaignId/plans/:planId/trips/:tripId/dispatch/candidates', requireCampaignPermission('campaign.manage'), controller.previaDispatch);
router.post('/:campaignId/plans/:planId/trips/:tripId/dispatch/direct-assign', requireCampaignPermission('campaign.dispatch'), controller.designarDireto);
router.post('/:campaignId/plans/:planId/trips/:tripId/dispatch/rounds', requireCampaignPermission('campaign.dispatch'), controller.criarRodadaOferta);
router.get('/:campaignId/plans/:planId/trips/:tripId/dispatch/rounds/:roundId', requireCampaignPermission('campaign.view'), controller.obterRodada);
router.post('/:campaignId/plans/:planId/trips/:tripId/dispatch/rounds/:roundId/cancel', requireCampaignPermission('campaign.dispatch'), controller.cancelarRodada);

module.exports = router;

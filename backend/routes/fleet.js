'use strict';

const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
const {
  resolverEscopoOperacional,
  escopoTemSelecaoInvalida,
} = require('../services/operationalScopeService');
const controller = require('../controllers/fleetController');

const router = express.Router();

async function resolverEscopoFleet(req, res, next) {
  try {
    const scope = await resolverEscopoOperacional(req, { empresaId: req.empresa_id });
    if (scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (escopoTemSelecaoInvalida(scope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }
    req.operationalScope = scope;
    return next();
  } catch (err) {
    console.error('[fleet:operational-scope]', err?.message || err);
    return res.status(500).json({ message: 'Erro ao validar escopo operacional.' });
  }
}

router.use(verifyToken, verificarEmpresa, verificarPlano, resolverEscopoFleet);

router.get('/overview', requirePermission('fleet.view'), controller.visaoOperacional);

router.get('/assets', requirePermission('fleet.view'), controller.listarAtivos);
router.get('/assets/:id', requirePermission('fleet.view'), controller.detalharAtivo);
router.post('/assets', requirePermission('fleet.manage'), controller.criarAtivo);
router.patch('/assets/:id', requirePermission('fleet.manage'), controller.atualizarAtivo);
router.get('/assets/:id/documents', requirePermission('fleet.view'), controller.listarDocumentosAtivo);
router.post('/assets/:id/documents', requirePermission('fleet.manage'), controller.criarDocumentoAtivo);

router.get('/compositions', requirePermission('fleet.view'), controller.listarComposicoes);
router.post('/compositions', requirePermission('fleet.manage'), controller.criarComposicao);
router.post('/compositions/:id/members', requirePermission('fleet.manage'), controller.adicionarMembroComposicao);
router.patch('/compositions/:id/members/:memberId/end', requirePermission('fleet.manage'), controller.encerrarMembroComposicao);

router.post('/driver-assignments', requirePermission('fleet.manage'), controller.criarVinculoMotorista);
router.patch('/driver-assignments/:id/end', requirePermission('fleet.manage'), controller.encerrarVinculoMotorista);

router.post('/freight-assignments', requirePermission('fleet.manage'), controller.criarVinculoFrete);

router.get('/tires', requirePermission('fleet.view'), controller.listarPneus);
router.post('/tires', requirePermission('fleet.manage'), controller.criarPneu);
router.post('/tires/:id/installations', requirePermission('fleet.manage'), controller.instalarPneu);
router.patch('/tire-installations/:id/remove', requirePermission('fleet.manage'), controller.removerInstalacaoPneu);
router.post('/tires/:id/events', requirePermission('fleet.manage'), controller.criarEventoPneu);

router.get('/maintenance', requirePermission('fleet.view'), controller.listarManutencoes);
router.post('/maintenance', requirePermission('fleet.manage'), controller.criarManutencao);

router.get('/odometer-events', requirePermission('fleet.view'), controller.listarOdometros);
router.post('/odometer-events', requirePermission('fleet.manage'), controller.criarOdometro);

module.exports = router;

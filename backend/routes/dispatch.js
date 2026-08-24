'use strict';

// Rotas do MOTORISTA para o Dispatch V1 (§49). Identidade sempre do token; nunca
// driver_id do corpo/query. Escopo operacional resolvido do mesmo jeito que
// operationCampaigns.js (mesmo serviço canônico) -- necessário porque aceitar uma oferta
// converge para a materialização (Fase 2), que revalida escopo como qualquer outra
// materialização de campanha.

const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
const { resolverEscopoOperacional, escopoTemSelecaoInvalida } = require('../services/operationalScopeService');
const controller = require('../controllers/dispatchController');

const router = express.Router();

async function resolverEscopoDispatch(req, res, next) {
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
    console.error('[dispatch:operational-scope]', err?.message || err);
    return res.status(500).json({ message: 'Erro ao validar escopo operacional.' });
  }
}

router.use(verifyToken, verificarEmpresa, verificarPlano, resolverEscopoDispatch);

router.get('/my-offers', requirePermission('campaign.dispatch_respond'), controller.minhasOfertas);
router.post('/offers/:offerId/accept', requirePermission('campaign.dispatch_respond'), controller.aceitarOferta);
router.post('/offers/:offerId/decline', requirePermission('campaign.dispatch_respond'), controller.recusarOferta);

module.exports = router;

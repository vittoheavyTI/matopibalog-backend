const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');

// P2.10 — CONFIGURAÇÃO DA EMPRESA por PERMISSÃO EFETIVA (não mais isAdmin):
//   leitura → company.settings.view ; alteração → company.settings.manage.
// PUT / (aparência GLOBAL) permanece isSuperAdmin: é INVARIANTE DE PLATAFORMA
// (a aparência do login é controlada pela plataforma, não pelo tenant).
router.get('/public', configController.getPublic);
router.get('/portal-governanca', verifyToken, verificarEmpresa, configController.getPortalGovernanca);
router.get('/', verifyToken, requirePermission('company.settings.view'), configController.get);
router.put('/', verifyToken, isSuperAdmin, configController.update);
router.get('/empresa', verifyToken, verificarEmpresa, requirePermission('company.settings.view'), configController.getEmpresaConfig);
router.put('/empresa', verifyToken, verificarEmpresa, verificarPlano, requirePermission('company.settings.manage'), configController.updateEmpresaConfig);
router.get('/codigo-convite', verifyToken, verificarEmpresa, requirePermission('company.settings.view'), configController.getCodigoConvite);
router.post('/codigo-convite/regenerar', verifyToken, verificarEmpresa, verificarPlano, requirePermission('company.settings.manage'), configController.regenerarCodigoConvite);

module.exports = router;

// routes/permissions.js — API admin de Perfis e Permissões V9 (P2).
// Tenant-scoped + enforcement permissions.manage. Só admin da empresa (isAdmin) e,
// dentro disso, quem tem a capability permissions.manage efetiva.

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const ctrl = require('../controllers/permissionsController');

router.use(verifyToken, isAdmin, verificarEmpresa, requirePermission('permissions.manage'));

router.get('/registry', ctrl.getRegistry);
router.get('/templates', ctrl.listTemplates);
router.put('/templates/:id', ctrl.updateTemplate);
router.get('/usuarios/:id', ctrl.getUserPermissions);
router.put('/usuarios/:id/template', ctrl.assignTemplate);
router.put('/usuarios/:id/override', ctrl.setOverride);
router.put('/motoristas/:id', ctrl.updateMotorista);

module.exports = router;

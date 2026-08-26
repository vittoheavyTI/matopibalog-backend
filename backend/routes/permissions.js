// routes/permissions.js — API admin de Perfis e Permissões V9 (P2).
// Tenant-scoped + enforcement permissions.manage. A autoridade é a capability
// efetiva, não a classe de conta: o coarse isAdmin foi removido em RBV9-INV-110
// porque não distinguia ninguém interno. Editar o que um perfil concede continua
// exigindo permissions.manage — atribuir perfil é users.manage, em /admin (D-067).

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const ctrl = require('../controllers/permissionsController');

router.use(verifyToken, verificarEmpresa, requirePermission('permissions.manage'));

router.get('/registry', ctrl.getRegistry);
router.get('/templates', ctrl.listTemplates);
// P2.9 — repair/recovery idempotente dos templates baseline (NÃO via GET).
router.post('/templates/ensure', ctrl.ensureTemplates);
router.put('/templates/:id', ctrl.updateTemplate);
router.get('/usuarios/:id', ctrl.getUserPermissions);
router.put('/usuarios/:id/template', ctrl.assignTemplate);
router.put('/usuarios/:id/override', ctrl.setOverride);
router.put('/motoristas/:id', ctrl.updateMotorista);

module.exports = router;

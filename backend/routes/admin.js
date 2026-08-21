const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
const validate = require('../middlewares/validate');
const { resetSenhaSchema } = require('../schemas/auth');

// Todas as rotas deste arquivo exigem privilégios de Administrador
router.use(verifyToken, isAdmin);

router.get('/motoristas/pendentes', verificarEmpresa, adminController.getPendentes);
router.patch('/motoristas/:id/approve', verificarEmpresa, verificarPlano, adminController.approveMotorista);
router.get('/motoristas', verificarEmpresa, adminController.getAllMotoristas);
router.post('/motoristas', verificarEmpresa, verificarPlano, adminController.createMotorista);
router.put('/motoristas/:id/comissao', verificarEmpresa, verificarPlano, adminController.updateComissao);
router.patch('/motoristas/:id/block', verificarEmpresa, verificarPlano, adminController.blockMotorista);
router.get('/motoristas/em-viagem', verificarEmpresa, adminController.getEmViagem);
router.delete('/motoristas/:id', verificarEmpresa, verificarPlano, adminController.deleteMotorista);

// Uso do plano (limite de motoristas) para o painel — read-only, escopado pela empresa.
router.get('/plano-uso', verificarEmpresa, adminController.getPlanoUso);

// P2 (Review 11) — ADMINISTRAÇÃO DE USUÁRIOS exige users.manage (distinto de
// permissions.manage, que gere templates/overrides em routes/permissions.js). Assim,
// um usuário com permissions.manage=true e users.manage=false pode editar perfis mas
// NÃO criar/editar/remover usuários. Admin tem ambos via template; super-admin passa.
// P2.9 — LEITURA exige users.view (feature existente; legacyMenuKey 'usuarios'). A
// migration 6a reproduz o menu legado desligado como override DENY users.view → a API
// passa a refletir a intenção do menu (admin tem por padrão; super-admin passa).
router.get('/usuarios', verificarEmpresa, requirePermission('users.view'), adminController.getUsuarios);
router.post('/usuarios', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.createUsuario);
router.put('/usuarios/:id', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.updateUsuario);
router.delete('/usuarios/:id', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.deleteUsuario);
router.post('/usuarios/:id/reset-senha', verificarEmpresa, verificarPlano, requirePermission('users.manage'), validate(resetSenhaSchema), adminController.resetSenhaUsuario);

module.exports = router;

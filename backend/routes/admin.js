const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
const validate = require('../middlewares/validate');
const { resetSenhaSchema } = require('../schemas/auth');

// P2.10 — este router NÃO usa mais o coarse isAdmin como substituto de capability.
// Cada rota é gated pela PERMISSÃO EFETIVA correspondente (super-admin passa; regras de
// tenant/scope/plano preservadas). Assim a empresa pode delegar gestão de motoristas
// (drivers.*) e usuários (users.*) sem depender de tipo='admin'.
router.use(verifyToken);

// MOTORISTAS — leitura=drivers.view ; gestão=drivers.manage.
router.get('/motoristas/pendentes', verificarEmpresa, requirePermission('drivers.view'), adminController.getPendentes);
router.patch('/motoristas/:id/approve', verificarEmpresa, verificarPlano, requirePermission('drivers.manage'), adminController.approveMotorista);
router.get('/motoristas', verificarEmpresa, requirePermission('drivers.view'), adminController.getAllMotoristas);
router.post('/motoristas', verificarEmpresa, verificarPlano, requirePermission('drivers.manage'), adminController.createMotorista);
router.put('/motoristas/:id/comissao', verificarEmpresa, verificarPlano, requirePermission('drivers.manage'), adminController.updateComissao);
router.patch('/motoristas/:id/block', verificarEmpresa, verificarPlano, requirePermission('drivers.manage'), adminController.blockMotorista);
router.get('/motoristas/em-viagem', verificarEmpresa, requirePermission('drivers.view'), adminController.getEmViagem);
router.delete('/motoristas/:id', verificarEmpresa, verificarPlano, requirePermission('drivers.manage'), adminController.deleteMotorista);

// Uso do plano (limite de motoristas) para o painel — read-only, escopado pela empresa.
router.get('/plano-uso', verificarEmpresa, requirePermission('drivers.view'), adminController.getPlanoUso);

// P2 (Review 11) — ADMINISTRAÇÃO DE USUÁRIOS exige users.manage (distinto de
// permissions.manage, que gere templates/overrides em routes/permissions.js). Assim,
// um usuário com permissions.manage=true e users.manage=false pode editar perfis mas
// NÃO criar/editar/remover usuários. Admin tem ambos via template; super-admin passa.
// P2.9 — LEITURA exige users.view (feature existente; legacyMenuKey 'usuarios'). A
// migration 6a reproduz o menu legado desligado como override DENY users.view → a API
// passa a refletir a intenção do menu (admin tem por padrão; super-admin passa).
// PERFIS DE ACESSO ATRIBUÍVEIS — leitura sob `users.manage`, não `permissions.manage`.
//
// Ler um perfil para ATRIBUIR e editar o que ele SIGNIFICA são autoridades
// diferentes. Enquanto a única listagem era `GET /permissions/templates` (protegida
// por `permissions.manage`), quem tinha só `users.manage` não conseguia sequer ver
// os perfis para escolher um — e criar usuário virou criar administrador (USR-001).
//
// A lista vem FILTRADA pelo servidor: o cliente nunca recebe perfis que não pode
// atribuir, e a decisão é reconferida na gravação. Editar templates continua
// exigindo `permissions.manage`, em routes/permissions.js, intocado.
router.get('/perfis-acesso', verificarEmpresa, requirePermission('users.manage'), adminController.getPerfisAtribuiveis);

router.get('/usuarios', verificarEmpresa, requirePermission('users.view'), adminController.getUsuarios);
router.post('/usuarios', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.createUsuario);
router.put('/usuarios/:id', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.updateUsuario);
router.delete('/usuarios/:id', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.deleteUsuario);
router.post('/usuarios/:id/reset-senha', verificarEmpresa, verificarPlano, requirePermission('users.manage'), validate(resetSenhaSchema), adminController.resetSenhaUsuario);
// Trocar o perfil de acesso é gestão de equipe (`users.manage`), com a mesma
// política de não-escalação da criação e a RPC guardada do último administrador.
router.put('/usuarios/:id/perfil-acesso', verificarEmpresa, verificarPlano, requirePermission('users.manage'), adminController.alterarPerfilDeAcesso);

module.exports = router;

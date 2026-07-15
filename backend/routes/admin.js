const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
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

router.get('/usuarios', verificarEmpresa, adminController.getUsuarios);
router.post('/usuarios', verificarEmpresa, verificarPlano, adminController.createUsuario);
router.put('/usuarios/:id', verificarEmpresa, verificarPlano, adminController.updateUsuario);
router.delete('/usuarios/:id', verificarEmpresa, verificarPlano, adminController.deleteUsuario);
router.post('/usuarios/:id/reset-senha', verificarEmpresa, verificarPlano, validate(resetSenhaSchema), adminController.resetSenhaUsuario);

module.exports = router;

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const validate = require('../middlewares/validate');
const { resetSenhaSchema } = require('../schemas/auth');

// Todas as rotas deste arquivo exigem privilégios de Administrador
router.use(verifyToken, isAdmin);

router.get('/motoristas/pendentes', verificarEmpresa, adminController.getPendentes);
router.patch('/motoristas/:id/approve', verificarEmpresa, adminController.approveMotorista);
router.get('/motoristas', verificarEmpresa, adminController.getAllMotoristas);
router.post('/motoristas', verificarEmpresa, adminController.createMotorista);
router.put('/motoristas/:id/comissao', verificarEmpresa, adminController.updateComissao);
router.patch('/motoristas/:id/block', verificarEmpresa, adminController.blockMotorista);
router.get('/motoristas/em-viagem', verificarEmpresa, adminController.getEmViagem);
router.delete('/motoristas/:id', verificarEmpresa, adminController.deleteMotorista);

router.get('/usuarios', verificarEmpresa, adminController.getUsuarios);
router.post('/usuarios', verificarEmpresa, adminController.createUsuario);
router.put('/usuarios/:id', verificarEmpresa, adminController.updateUsuario);
router.delete('/usuarios/:id', verificarEmpresa, adminController.deleteUsuario);
router.post('/usuarios/:id/reset-senha', isSuperAdmin, validate(resetSenhaSchema), adminController.resetSenhaUsuario);

module.exports = router;

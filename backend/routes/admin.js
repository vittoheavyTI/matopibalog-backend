const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

// Todas as rotas deste arquivo exigem privilégios de Administrador
router.use(verifyToken, isAdmin);

router.get('/motoristas/pendentes', adminController.getPendentes);
router.patch('/motoristas/:id/approve', adminController.approveMotorista);
router.get('/motoristas', verificarEmpresa, adminController.getAllMotoristas);
router.put('/motoristas/:id/comissao', adminController.updateComissao);
router.patch('/motoristas/:id/block', adminController.blockMotorista);
router.get('/motoristas/em-viagem', adminController.getEmViagem);
router.delete('/motoristas/:id', adminController.deleteMotorista);

router.get('/usuarios', adminController.getUsuarios);
router.post('/usuarios', adminController.createUsuario);
router.put('/usuarios/:id', adminController.updateUsuario);
router.delete('/usuarios/:id', adminController.deleteUsuario);

module.exports = router;

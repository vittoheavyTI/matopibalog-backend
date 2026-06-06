const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.get('/public', configController.getPublic);
router.get('/', verifyToken, isAdmin, configController.get);
router.put('/', verifyToken, isSuperAdmin, configController.update);
router.get('/empresa', verifyToken, isAdmin, verificarEmpresa, configController.getEmpresaConfig);
router.put('/empresa', verifyToken, isAdmin, verificarEmpresa, configController.updateEmpresaConfig);
router.get('/codigo-convite', verifyToken, isAdmin, configController.getCodigoConvite);
router.post('/codigo-convite/regenerar', verifyToken, isAdmin, configController.regenerarCodigoConvite);

module.exports = router;

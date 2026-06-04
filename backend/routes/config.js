const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

router.get('/public', configController.getPublic);
router.get('/', verifyToken, isAdmin, configController.get);
router.put('/', verifyToken, isAdmin, configController.update);
router.get('/codigo-convite', verifyToken, isAdmin, configController.getCodigoConvite);
router.post('/codigo-convite/regenerar', verifyToken, isAdmin, configController.regenerarCodigoConvite);

module.exports = router;

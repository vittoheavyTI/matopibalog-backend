const express = require('express');
const router = express.Router();
const notificacoesController = require('../controllers/notificacoesController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

router.get('/', notificacoesController.getAll);
router.patch('/:id/lida', notificacoesController.marcarLida);
router.patch('/todas/lida', notificacoesController.marcarTodasLidas);

module.exports = router;

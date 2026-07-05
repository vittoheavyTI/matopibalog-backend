const express = require('express');
const router = express.Router();
const notificacoesController = require('../controllers/notificacoesController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.use(verifyToken, verificarEmpresa);

router.get('/', notificacoesController.getAll);
router.get('/nao-lidas/count', notificacoesController.contarNaoLidas);
router.patch('/lidas', notificacoesController.marcarTodasLidas);
// Compatibilidade com o endpoint legado. Rotas estaticas ficam antes de /:id.
router.patch('/todas/lida', notificacoesController.marcarTodasLidas);
router.patch('/:id/lida', notificacoesController.marcarLida);

module.exports = router;

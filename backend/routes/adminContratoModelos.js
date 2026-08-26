const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminContratoModelosController');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { criarContratoModeloSchema, atualizarContratoModeloSchema } = require('../schemas/contratoModelo');

// Modelos de contrato por plano — só super-admin (documento comercial de plataforma).
router.use(verifyToken, isSuperAdmin);

// Rotas específicas ANTES de /:id para não colidir.
router.get('/overview', ctrl.overview);
router.get('/', ctrl.listar);
router.post('/', validate(criarContratoModeloSchema), ctrl.criar);
router.get('/:id', ctrl.obter);
router.patch('/:id/publicar', ctrl.publicar);
router.patch('/:id/arquivar', ctrl.arquivar);
router.patch('/:id', validate(atualizarContratoModeloSchema), ctrl.atualizar);

module.exports = router;

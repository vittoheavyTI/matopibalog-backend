const express = require('express');
const router = express.Router();
const termosController = require('../controllers/termosController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const validate = require('../middlewares/validate');
const { aceitarTermoSchema } = require('../schemas/termos');

// Todas as rotas exigem usuário autenticado.
router.use(verifyToken);

// Termos ativos que o usuário precisa aceitar e ainda não aceitou.
router.get('/pendentes', termosController.getPendentes);

// Registra o aceite de um termo ativo (verificarEmpresa carimba empresa_id).
router.post('/:id/aceitar', verificarEmpresa, validate(aceitarTermoSchema), termosController.aceitarTermo);

module.exports = router;

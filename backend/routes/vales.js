const express = require('express');
const router = express.Router();
const valesController = require('../controllers/valesController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createValeSchema } = require('../schemas/vales');
const { criarAcoesLancamento } = require('../controllers/lancamentoAcoesController');
const acoes = criarAcoesLancamento('vale');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', valesController.getAll);
router.post('/', upload.single('foto'), validate(createValeSchema), valesController.create);
router.get('/:id', valesController.getById);
router.patch('/:id', valesController.update);

// Onda 1 — transições audit-safe (admin/super-admin; motivo obrigatório em rejeitar/
// cancelar; CAS opcional). Cancelar NUNCA deleta.
router.post('/:id/aprovar', acoes.aprovar);
router.post('/:id/rejeitar', acoes.rejeitar);
router.post('/:id/cancelar', acoes.cancelar);
router.get('/:id/eventos', acoes.historico);

module.exports = router;

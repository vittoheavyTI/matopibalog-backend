const express = require('express');
const router = express.Router();
const abastecimentosController = require('../controllers/abastecimentosController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createAbastecimentoSchema } = require('../schemas/abastecimentos');
const { criarAcoesLancamento } = require('../controllers/lancamentoAcoesController');
const acoes = criarAcoesLancamento('abastecimento');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', abastecimentosController.getAll);
router.post('/', upload.single('foto'), validate(createAbastecimentoSchema), abastecimentosController.create);
router.get('/:id', abastecimentosController.getById);
router.patch('/:id', abastecimentosController.update);

// Onda 1 — transições audit-safe (admin/super-admin; motivo obrigatório em rejeitar/
// cancelar; CAS opcional). Cancelar NUNCA deleta.
router.post('/:id/aprovar', acoes.aprovar);
router.post('/:id/rejeitar', acoes.rejeitar);
router.post('/:id/cancelar', acoes.cancelar);
router.get('/:id/eventos', acoes.historico);

module.exports = router;

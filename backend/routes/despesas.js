const express = require('express');
const router = express.Router();
const despesasController = require('../controllers/despesasController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createDespesaSchema } = require('../schemas/despesas');
const { criarAcoesLancamento } = require('../controllers/lancamentoAcoesController');
const acoes = criarAcoesLancamento('despesa');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', despesasController.getAll);
router.post('/', upload.single('foto'), validate(createDespesaSchema), despesasController.create);
router.get('/:id', despesasController.getById);
router.patch('/:id', despesasController.update);

// Onda 1 — transições audit-safe (admin/super-admin; motivo obrigatório em rejeitar/
// cancelar; CAS opcional via expected_version/expected_status). Cancelar NUNCA deleta.
router.post('/:id/aprovar', acoes.aprovar);
router.post('/:id/rejeitar', acoes.rejeitar);
router.post('/:id/cancelar', acoes.cancelar);
router.get('/:id/eventos', acoes.historico);

module.exports = router;

const express = require('express');
const router = express.Router();
const abastecimentosController = require('../controllers/abastecimentosController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
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
// P2 (Review 9/P2.9) — transições exigem launch.approve/reject/cancel efetivos.
router.post('/:id/aprovar', requirePermission('launch.approve'), acoes.aprovar);
router.post('/:id/rejeitar', requirePermission('launch.reject'), acoes.rejeitar);
router.post('/:id/cancelar', requirePermission('launch.cancel'), acoes.cancelar);
router.get('/:id/eventos', acoes.historico);

module.exports = router;

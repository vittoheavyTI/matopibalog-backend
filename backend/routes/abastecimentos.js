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

// P2.10 — lançamentos por permissão efetiva (motorista contextual via template + controller).
router.get('/', requirePermission('launch.view'), abastecimentosController.getAll);
router.post('/', requirePermission('launch.create'), upload.single('foto'), validate(createAbastecimentoSchema), abastecimentosController.create);
router.get('/:id', requirePermission('launch.view'), abastecimentosController.getById);
router.patch('/:id', requirePermission('launch.create'), abastecimentosController.update);

// Onda 1 — transições audit-safe (admin/super-admin; motivo obrigatório em rejeitar/
// cancelar; CAS opcional). Cancelar NUNCA deleta.
// P2 (Review 9/P2.9) — transições exigem launch.approve/reject/cancel efetivos.
router.post('/:id/aprovar', requirePermission('launch.approve'), acoes.aprovar);
router.post('/:id/rejeitar', requirePermission('launch.reject'), acoes.rejeitar);
router.post('/:id/cancelar', requirePermission('launch.cancel'), acoes.cancelar);
router.get('/:id/eventos', requirePermission('launch.view'), acoes.historico);

module.exports = router;

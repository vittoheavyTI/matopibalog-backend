const express = require('express');
const router = express.Router();
const despesasController = require('../controllers/despesasController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { requirePermission } = require('../middlewares/requirePermission');
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
// P2 (Review 9/P2.9) — transições de lançamento são features EXISTENTES: exigem
// launch.approve/reject/cancel efetivos. Admin/gerentes têm por template; super-admin
// passa; motorista/operador NÃO aprovam. O controller mantém a checagem coarse por dentro.
router.post('/:id/aprovar', requirePermission('launch.approve'), acoes.aprovar);
router.post('/:id/rejeitar', requirePermission('launch.reject'), acoes.rejeitar);
router.post('/:id/cancelar', requirePermission('launch.cancel'), acoes.cancelar);
router.get('/:id/eventos', acoes.historico);

module.exports = router;

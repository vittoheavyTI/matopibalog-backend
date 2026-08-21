const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { verificarPlano } = require('../middlewares/verificarPlano');

// P2 — /dashboard/summary é o RESUMO FINANCEIRO (faturamento/comissão/despesas/
// saldo). Passa a exigir finance.operational.view: o dashboard operacional não
// expõe financeiro a quem não tem a permission. Admin tem via template; super-admin
// é authority separada.
router.get('/summary', verifyToken, isAdmin, verificarEmpresa, verificarPlano, requirePermission('finance.operational.view'), dashboardController.getSummary);

module.exports = router;

const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { verificarPlano } = require('../middlewares/verificarPlano');

// P2 — relatórios FINANCEIROS operacionais exigem finance.operational.view (além do
// tenant/plano). Admin tem por padrão via template; super-admin é authority separada.
router.get('/ficha-viagem', verifyToken, isAdmin, verificarEmpresa, verificarPlano, requirePermission('finance.operational.view'), relatoriosController.getFichaViagem);

// Rentabilidade operacional direta por viagem (read-only, tenant-safe).
router.get('/rentabilidade', verifyToken, isAdmin, verificarEmpresa, verificarPlano, requirePermission('finance.operational.view'), relatoriosController.getRentabilidade);

// Acerto financeiro consolidado de motoristas (read-only, tenant-safe).
router.get('/acerto-motoristas', verifyToken, isAdmin, verificarEmpresa, verificarPlano, requirePermission('finance.operational.view'), relatoriosController.getAcertoMotoristas);

// Torre de controle operacional simples (read-only, tenant-safe).
router.get('/torre-controle', verifyToken, isAdmin, verificarEmpresa, verificarPlano, relatoriosController.getTorreControle);

module.exports = router;

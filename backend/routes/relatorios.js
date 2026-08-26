const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { verificarPlano } = require('../middlewares/verificarPlano');

// P2.9 — estes são RELATÓRIOS FINANCEIROS → exigem reports.financial.view (a key
// precisa de sua feature existente; antes usavam finance.operational.view, cuja
// consumidora canônica é o /dashboard/summary). Efetivo idêntico para os baselines
// (administrador e financeiro têm ambas as keys; demais perfis não têm nenhuma).
// Admin tem por padrão via template; super-admin é authority separada.
router.get('/ficha-viagem', verifyToken, verificarEmpresa, verificarPlano, requirePermission('reports.financial.view'), relatoriosController.getFichaViagem);

// Rentabilidade operacional direta por viagem (read-only, tenant-safe).
router.get('/rentabilidade', verifyToken, verificarEmpresa, verificarPlano, requirePermission('reports.financial.view'), relatoriosController.getRentabilidade);

// Acerto financeiro consolidado de motoristas (read-only, tenant-safe).
router.get('/acerto-motoristas', verifyToken, verificarEmpresa, verificarPlano, requirePermission('reports.financial.view'), relatoriosController.getAcertoMotoristas);

// P2.9 — Torre de controle é RELATÓRIO OPERACIONAL → exige reports.operational.view.
router.get('/torre-controle', verifyToken, verificarEmpresa, verificarPlano, requirePermission('reports.operational.view'), relatoriosController.getTorreControle);

module.exports = router;

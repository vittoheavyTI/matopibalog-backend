const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');

router.get('/ficha-viagem', verifyToken, isAdmin, verificarEmpresa, verificarPlano, relatoriosController.getFichaViagem);

// Rentabilidade operacional direta por viagem (read-only, tenant-safe).
router.get('/rentabilidade', verifyToken, isAdmin, verificarEmpresa, verificarPlano, relatoriosController.getRentabilidade);

// Acerto financeiro consolidado de motoristas (read-only, tenant-safe).
router.get('/acerto-motoristas', verifyToken, isAdmin, verificarEmpresa, verificarPlano, relatoriosController.getAcertoMotoristas);

module.exports = router;

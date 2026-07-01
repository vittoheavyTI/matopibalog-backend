const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');

router.get('/ficha-viagem', verifyToken, isAdmin, verificarEmpresa, verificarPlano, relatoriosController.getFichaViagem);

module.exports = router;

const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.get('/ficha-viagem', verifyToken, isAdmin, verificarEmpresa, relatoriosController.getFichaViagem);

module.exports = router;

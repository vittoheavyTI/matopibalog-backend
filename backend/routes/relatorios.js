const express = require('express');
const router = express.Router();
const relatoriosController = require('../controllers/relatoriosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

router.get('/ficha-viagem', verifyToken, isAdmin, relatoriosController.getFichaViagem);

module.exports = router;

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.get('/summary', verifyToken, isAdmin, verificarEmpresa, dashboardController.getSummary);

module.exports = router;

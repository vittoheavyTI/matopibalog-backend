'use strict';

const express = require('express');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const { listarDiagnosticos } = require('../controllers/diagnosticsController');

const router = express.Router();

router.get('/', verifyToken, isSuperAdmin, listarDiagnosticos);

module.exports = router;

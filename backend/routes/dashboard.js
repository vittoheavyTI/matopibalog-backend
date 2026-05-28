const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

router.get('/summary', verifyToken, isAdmin, dashboardController.getSummary);

module.exports = router;

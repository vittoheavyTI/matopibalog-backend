const express = require('express');
const router = express.Router();
const realtimeController = require('../controllers/realtimeController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

// GET /realtime/stream — SSE autenticado, tenant-scoped. Sem verificarPlano de
// propósito: mesmo empresa com plano suspenso pode observar o estado (read-only push);
// as mutations continuam gated nos routers dos lançamentos.
router.get('/stream', verifyToken, verificarEmpresa, realtimeController.stream);

module.exports = router;

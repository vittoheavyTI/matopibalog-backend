const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', verifyToken, authController.getMe);
router.post('/esqueceu-senha', authController.esqueceuSenha);
router.post('/register-empresa', authController.registerEmpresa);

module.exports = router;

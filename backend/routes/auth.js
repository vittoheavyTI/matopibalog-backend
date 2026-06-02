const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { loginSchema, registerSchema, esqueceuSenhaSchema, registerEmpresaSchema } = require('../schemas/auth');

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);
router.post('/esqueceu-senha', validate(esqueceuSenhaSchema), authController.esqueceuSenha);
router.post('/register-empresa', validate(registerEmpresaSchema), authController.registerEmpresa);

module.exports = router;

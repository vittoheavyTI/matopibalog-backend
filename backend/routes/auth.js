const express = require('express');
const router = express.Router();
const multer = require('multer');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { loginSchema, registerSchema, esqueceuSenhaSchema, resetSenhaSchema, registerEmpresaSchema } = require('../schemas/auth');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);
router.patch('/me', verifyToken, authController.updateMe);
router.post('/me/foto', verifyToken, upload.single('foto'), authController.uploadFotoPerfil);
router.post('/esqueceu-senha', validate(esqueceuSenhaSchema), authController.esqueceuSenha);
router.post('/trocar-senha', verifyToken, validate(resetSenhaSchema), authController.trocarSenha);
router.post('/register-empresa', validate(registerEmpresaSchema), authController.registerEmpresa);

module.exports = router;

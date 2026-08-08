const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { loginSchema, registerSchema, esqueceuSenhaSchema, resetSenhaSchema, registerEmpresaSchema } = require('../schemas/auth');
const { getAuthRuntime } = require('../services/auth/authRuntime');
const { criarAuthSessionController } = require('../controllers/authSessionController');

let authSessionControllerMemo = null;

function sec1Controller() {
  const { cfg, sessionService } = getAuthRuntime();
  if (!cfg.sessionsEnabled || !sessionService) return null;
  if (!authSessionControllerMemo) {
    authSessionControllerMemo = criarAuthSessionController({ sessionService, cfg });
  }
  return authSessionControllerMemo;
}

function exigirSec1(req, res, next) {
  const ctrl = sec1Controller();
  if (!ctrl) return res.status(404).json({ message: 'Sessões SEC-1 não habilitadas.' });
  req.authSessionController = ctrl;
  return next();
}

function temToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  return !!((req.cookies && req.cookies.token) || (typeof auth === 'string' && auth.startsWith('Bearer ')));
}

function logoutSec1OuLegado(req, res, next) {
  const ctrl = sec1Controller();
  if (!ctrl) return authController.logout(req, res);
  if (!temToken(req)) return ctrl.logout(req, res);
  return verifyToken(req, res, () => ctrl.logout(req, res));
}

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', exigirSec1, (req, res) => req.authSessionController.refreshWeb(req, res));
router.post('/mobile/refresh', exigirSec1, (req, res) => req.authSessionController.refreshMobile(req, res));
router.post('/logout', logoutSec1OuLegado);
router.post('/logout-all', exigirSec1, verifyToken, (req, res) => req.authSessionController.logoutAll(req, res));
router.get('/sessions', exigirSec1, verifyToken, (req, res) => req.authSessionController.listSessions(req, res));
router.delete('/sessions/:id', exigirSec1, verifyToken, (req, res) => req.authSessionController.revokeSession(req, res));
router.get('/me', verifyToken, authController.getMe);
router.patch('/me', verifyToken, authController.updateMe);
router.post('/me/foto', verifyToken, upload.single('foto'), authController.uploadFotoPerfil);
router.post('/esqueceu-senha', validate(esqueceuSenhaSchema), authController.esqueceuSenha);
router.post('/reenviar-confirmacao', validate(esqueceuSenhaSchema), authController.reenviarConfirmacao);
router.post('/trocar-senha', verifyToken, validate(resetSenhaSchema), authController.trocarSenha);
router.post('/register-empresa', validate(registerEmpresaSchema), authController.registerEmpresa);

module.exports = router;

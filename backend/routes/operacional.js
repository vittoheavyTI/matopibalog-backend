const express = require('express');
const router = express.Router();
const operacionalController = require('../controllers/operacionalController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.use(verifyToken, isAdmin, verificarEmpresa);

router.get('/contexto', operacionalController.getContexto);

router.get('/grupos', operacionalController.listarGrupos);
router.post('/grupos', operacionalController.criarGrupo);
router.post('/grupos/:id/empresas', operacionalController.vincularEmpresaGrupo);

router.get('/unidades', operacionalController.listarUnidades);
router.post('/unidades', operacionalController.criarUnidade);

router.get('/regioes', operacionalController.listarRegioes);
router.post('/regioes', operacionalController.criarRegiao);
router.put('/regioes/:id/unidades', operacionalController.definirUnidadesRegiao);

router.get('/memberships', operacionalController.listarMemberships);
router.post('/memberships', operacionalController.criarMembership);
router.patch('/memberships/:id/revogar', operacionalController.revogarMembership);

module.exports = router;

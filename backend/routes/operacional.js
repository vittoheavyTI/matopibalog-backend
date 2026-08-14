const express = require('express');
const router = express.Router();
const operacionalController = require('../controllers/operacionalController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

router.use(verifyToken, isAdmin, verificarEmpresa);

router.get('/contexto', operacionalController.getContexto);

router.get('/grupos', operacionalController.listarGrupos);
router.post('/grupos', operacionalController.criarGrupo);
router.patch('/grupos/:id', operacionalController.atualizarGrupo);
router.post('/grupos/:id/empresas', operacionalController.vincularEmpresaGrupo);

router.get('/unidades', operacionalController.listarUnidades);
router.post('/unidades', operacionalController.criarUnidade);
router.patch('/unidades/:id', operacionalController.atualizarUnidade);

router.get('/regioes', operacionalController.listarRegioes);
router.post('/regioes', operacionalController.criarRegiao);
router.patch('/regioes/:id', operacionalController.atualizarRegiao);
router.put('/regioes/:id/unidades', operacionalController.definirUnidadesRegiao);

router.get('/memberships', operacionalController.listarMemberships);
router.post('/memberships', operacionalController.criarMembership);
router.patch('/memberships/:id', operacionalController.atualizarMembership);
router.patch('/memberships/:id/revogar', operacionalController.revogarMembership);

router.post('/enforcement', operacionalController.ativarEnforcement);

module.exports = router;

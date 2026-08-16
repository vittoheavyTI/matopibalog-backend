const express = require('express');
const router = express.Router();
const operacionalController = require('../controllers/operacionalController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const supabase = require('../config/supabase');
const { carregarPortalGovernanca } = require('../services/portalGovernanceService');

router.use(verifyToken, isAdmin, verificarEmpresa);

router.use(async (req, res, next) => {
  if (req.user?.is_super_admin === true) return next();
  try {
    const governanca = await carregarPortalGovernanca(supabase, {
      empresaId: req.empresa_id,
      usuarioId: req.user?.uid,
      user: req.user,
    });
    const estrutura = governanca.entitlements?.estrutura_operacional;
    if (estrutura?.permitido === true) {
      req.portalGovernanca = governanca;
      return next();
    }
    return res.status(403).json({
      message: 'Estrutura Operacional não está liberada para o plano ou perfil atual.',
      entitlement: estrutura || null,
    });
  } catch (err) {
    console.error('[operacional:portal-governanca]', err.message || err);
    return res.status(500).json({ message: 'Erro ao validar acesso à Estrutura Operacional.' });
  }
});

router.get('/contexto', operacionalController.getContexto);

router.get('/grupos', operacionalController.listarGrupos);
router.post('/grupos', operacionalController.criarGrupo);
router.patch('/grupos/:id', operacionalController.atualizarGrupo);
router.post('/grupos/:id/empresas', operacionalController.vincularEmpresaGrupo);
router.get('/grupos/:id/memberships', operacionalController.listarGrupoMemberships);
router.post('/grupos/:id/memberships', operacionalController.criarGrupoMembership);

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

'use strict';

// Rotas EXTERNAS do Portal do Embarcador. Namespace próprio (§13):
// `/portal/embarcador` — deliberadamente fora de qualquer prefixo usado pelo
// sistema interno, para que nenhum middleware de tenant interno seja alcançado
// por engano.
//
// Autorização aqui NÃO usa `verifyToken`/`verificarEmpresa`. Usa
// `verifyPortalToken` (que recusa token interno) + a fronteira do
// `shipperBoundaryService` (que recusa qualquer objeto fora do relacionamento
// ativo). Tenant sozinho nunca autoriza nada neste arquivo.

const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const { verifyPortalToken } = require('../middlewares/shipperPortalAuth');
const uploadDocumento = require('../middlewares/uploadDocumento');
const onboarding = require('../services/shipperPortal/shipperOnboardingService');
const requests = require('../services/shipperPortal/shipperRequestService');
const tracking = require('../services/shipperPortal/shipperTrackingService');
const documentos = require('../services/shipperPortal/shipperDocumentService');

const router = express.Router();

// Tratamento único de erro do domínio: o serviço decide status/código/mensagem
// em pt-BR acionável; a rota só transporta. Erro inesperado nunca vaza detalhe.
function responder(res, promessa) {
  return promessa.then(
    (payload) => res.json(payload),
    (err) => {
      const status = err?.status || 500;
      if (status >= 500) {
        console.error('[shipperPortal]', err?.code || 'erro', err?.message || err);
      }
      return res.status(status).json({
        message: status >= 500
          ? 'Não foi possível concluir a operação agora. Tente novamente em instantes.'
          : (err?.message || 'Não foi possível concluir a operação.'),
        code: err?.code || 'shipper_portal_error',
      });
    },
  );
}

// Limite nas superfícies não autenticadas (§102): login, ativação e leitura de
// convite são os pontos onde um token/senha pode ser adivinhado por força bruta.
const limiteSensivel = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

// ---- público (sem sessão de portal) --------------------------------------

router.get('/convite', limiteSensivel, (req, res) =>
  responder(res, onboarding.previewConvite(supabase, { token: req.query.token })));

router.post('/convite/ativar', limiteSensivel, (req, res) =>
  responder(res, onboarding.ativarConvite(supabase, {
    token: req.body?.token, senha: req.body?.senha, nome: req.body?.nome,
  })));

router.post('/login', limiteSensivel, (req, res) =>
  responder(res, onboarding.login(supabase, { email: req.body?.email, senha: req.body?.senha })));

// ---- autenticado ---------------------------------------------------------

router.use(verifyPortalToken);

router.get('/contexto', (req, res) =>
  responder(res, onboarding.contextoAtual(supabase, { portalUserId: req.portalUser.id })));

router.get('/inicio', (req, res) =>
  responder(res, tracking.resumoInicio(supabase, { portalUserId: req.portalUser.id })));

// Solicitações
router.get('/solicitacoes', (req, res) =>
  responder(res, requests.listarMinhasSolicitacoes(supabase, { portalUserId: req.portalUser.id })));

router.post('/solicitacoes', (req, res) =>
  responder(res, requests.criarSolicitacao(supabase, { portalUserId: req.portalUser.id, body: req.body })));

router.get('/solicitacoes/:id', (req, res) =>
  responder(res, requests.obterMinhaSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id,
  })));

router.get('/solicitacoes/:id/historico', (req, res) =>
  responder(res, requests.historicoDaSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id,
  })));

// Correção após pedido de ajustes.
router.post('/solicitacoes/:id/revisar', (req, res) =>
  responder(res, requests.revisarSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id, body: req.body,
  })));

router.post('/solicitacoes/:id/cancelar', (req, res) =>
  responder(res, requests.cancelarSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id, motivo: req.body?.motivo,
  })));

// Acompanhamento
router.get('/operacoes', (req, res) =>
  responder(res, tracking.listarMinhasOperacoes(supabase, { portalUserId: req.portalUser.id })));

router.get('/operacoes/:id', (req, res) =>
  responder(res, tracking.obterMinhaOperacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id,
  })));

// Documentos
router.get('/solicitacoes/:id/documentos', (req, res) =>
  responder(res, documentos.listarDocumentosDaSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id,
  })));

router.post('/solicitacoes/:id/documentos', uploadDocumento.single('arquivo'), (req, res) =>
  responder(res, documentos.enviarDocumentoDaSolicitacao(supabase, {
    portalUserId: req.portalUser.id, requestId: req.params.id, arquivo: req.file, body: req.body,
  })));

// URL assinada. `tipo=MEU` para documento enviado pelo próprio embarcador;
// qualquer outro valor trata como compartilhamento da transportadora. A
// verificação de fronteira acontece dentro do serviço, antes de assinar.
router.get('/documentos/:id/url', (req, res) =>
  responder(res, documentos.urlAssinadaParaEmbarcador(supabase, {
    portalUserId: req.portalUser.id, documentoId: req.params.id, tipo: req.query.tipo,
  })));

module.exports = router;

'use strict';

// Rotas INTERNAS do Portal do Embarcador: a caixa de entrada de solicitações e
// a gestão de quem, lá fora, tem acesso.
//
// Autorização aqui é a canônica interna (§93): sessão interna + tenant +
// entitlement/permissão efetiva + escopo operacional. Nada disso é substituído
// por conhecimento de id.
//
// INVARIANTE CONGELADA NO OWNER REVIEW DO PORTAL-A (§40): aceitar uma
// solicitação não é só "decidir sobre uma solicitação" — ela cria uma operação
// real via Operation Orchestrator. Por isso aceitar exige, ALÉM de
// `shipper_portal.requests.review`, a MESMA autoridade que a pessoa precisaria
// para criar aquele objetivo manualmente (`campaign.create`). Sem isso, o portal
// viraria um caminho lateral para criar campanhas sem a permissão de campanha.

const express = require('express');
const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { ensureEffective } = require('../middlewares/requirePermission');
const {
  resolverEscopoOperacional,
  escopoTemSelecaoInvalida,
} = require('../services/operationalScopeService');
const review = require('../services/shipperPortal/shipperRequestReviewService');
const management = require('../services/shipperPortal/shipperManagementService');
const documentos = require('../services/shipperPortal/shipperDocumentService');

const router = express.Router();

function responder(res, promessa) {
  return promessa.then(
    (payload) => res.json(payload),
    (err) => {
      const status = err?.status || 500;
      if (status >= 500) {
        console.error('[shipperInbox]', err?.code || 'erro', err?.message || err);
      }
      return res.status(status).json({
        message: status >= 500
          ? 'Não foi possível concluir a operação agora. Tente novamente em instantes.'
          : (err?.message || 'Não foi possível concluir a operação.'),
        code: err?.code || 'shipper_inbox_error',
      });
    },
  );
}

async function resolverEscopo(req, res, next) {
  try {
    const scope = await resolverEscopoOperacional(req, { empresaId: req.empresa_id });
    if (scope.mode === 'NO_ACCESS' || scope.mode === 'NO_COMPANY') {
      return res.status(403).json({ message: 'Escopo operacional não autorizado.', denial: 'scope_denied' });
    }
    if (escopoTemSelecaoInvalida(scope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.', denial: 'scope_denied' });
    }
    req.operationalScope = scope;
    return next();
  } catch (err) {
    console.error('[shipperInbox:escopo]', err?.message || err);
    return res.status(500).json({ message: 'Erro ao validar escopo operacional.' });
  }
}

// Exige TODAS as permissões da lista. Usado para materializar a invariante do
// aceite (review + create), em vez de deixá-la implícita no serviço.
function exigirPermissoes(...chaves) {
  return async function (req, res, next) {
    try {
      if (req.user && req.user.is_super_admin === true) return next();
      const eff = await ensureEffective(req);
      const faltando = chaves.filter((k) => eff?.permissions?.[k] !== true);
      if (!faltando.length) return next();

      const source = eff?.source?.[faltando[0]] || 'default_deny';
      const entitlementDenied = source === 'entitlement_denied';
      return res.status(403).json({
        message: entitlementDenied
          ? 'O Portal do Embarcador não está habilitado para esta empresa.'
          : 'Permissão insuficiente para esta ação no Portal do Embarcador.',
        permission: faltando[0],
        denial: entitlementDenied ? 'entitlement_denied' : 'permission_denied',
      });
    } catch (err) {
      console.error('[shipperInbox:permissao]', err?.message || err);
      return res.status(500).json({ message: 'Erro ao verificar permissão.' });
    }
  };
}

const REVIEW = 'shipper_portal.requests.review';
const MANAGE = 'shipper_portal.manage';
const SHARE = 'shipper_portal.documents.share';
// Autoridade canônica do Operation Orchestrator, exigida junto do aceite.
const CAMPAIGN_CREATE = 'campaign.create';

router.use(verifyToken, verificarEmpresa, verificarPlano);

// ---- caixa de entrada ----------------------------------------------------

router.get('/solicitacoes', exigirPermissoes(REVIEW), (req, res) =>
  responder(res, review.listarCaixaDeEntrada(supabase, {
    empresaId: req.empresa_id, status: req.query.status || null,
  })));

router.get('/solicitacoes/:id', exigirPermissoes(REVIEW), (req, res) =>
  responder(res, review.obterSolicitacao(supabase, {
    empresaId: req.empresa_id, requestId: req.params.id,
  })));

router.get('/solicitacoes/:id/historico', exigirPermissoes(REVIEW), (req, res) =>
  responder(res, review.historicoDaSolicitacao(supabase, {
    empresaId: req.empresa_id, requestId: req.params.id,
  })));

// Aceitar: review + campaign.create (§40). O escopo operacional é resolvido
// porque o objetivo criado nasce dentro dele.
router.post('/solicitacoes/:id/aceitar', exigirPermissoes(REVIEW, CAMPAIGN_CREATE), resolverEscopo, (req, res) =>
  responder(res, review.aceitarSolicitacao(supabase, {
    empresaId: req.empresa_id,
    requestId: req.params.id,
    user: req.user,
    operationalScope: req.operationalScope,
    correlation: { origem: 'shipper_portal_inbox' },
  })));

// Retentativa da conversão quando o aceite passou mas a operação não foi criada.
router.post('/solicitacoes/:id/reconverter', exigirPermissoes(REVIEW, CAMPAIGN_CREATE), resolverEscopo, (req, res) =>
  responder(res, review.reconverterSolicitacao(supabase, {
    empresaId: req.empresa_id,
    requestId: req.params.id,
    user: req.user,
    operationalScope: req.operationalScope,
    correlation: { origem: 'shipper_portal_inbox_retry' },
  })));

// Pedir ajustes / recusar: motivo obrigatório, e ele é visível ao embarcador.
router.post('/solicitacoes/:id/ajustes', exigirPermissoes(REVIEW), (req, res) =>
  responder(res, review.decidirSemAceite(supabase, {
    empresaId: req.empresa_id, requestId: req.params.id, user: req.user,
    novoStatus: 'CHANGES_REQUESTED', motivo: req.body?.motivo,
  })));

router.post('/solicitacoes/:id/recusar', exigirPermissoes(REVIEW), (req, res) =>
  responder(res, review.decidirSemAceite(supabase, {
    empresaId: req.empresa_id, requestId: req.params.id, user: req.user,
    novoStatus: 'REJECTED', motivo: req.body?.motivo,
  })));

// ---- documentos compartilhados -------------------------------------------

router.get('/solicitacoes/:id/compartilhaveis', exigirPermissoes(SHARE), (req, res) =>
  responder(res, documentos.listarCompartilhaveis(supabase, {
    empresaId: req.empresa_id, requestId: req.params.id,
  })));

router.post('/solicitacoes/:id/compartilhar', exigirPermissoes(SHARE), (req, res) =>
  responder(res, documentos.compartilhar(supabase, {
    empresaId: req.empresa_id, user: req.user, requestId: req.params.id, body: req.body,
  })));

router.post('/compartilhamentos/:id/revogar', exigirPermissoes(SHARE), (req, res) =>
  responder(res, documentos.revogarCompartilhamento(supabase, {
    empresaId: req.empresa_id, user: req.user, shareId: req.params.id,
  })));

// ---- gestão de embarcadores e convites -----------------------------------

router.get('/embarcadores', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.listarEmbarcadores(supabase, { empresaId: req.empresa_id })));

router.post('/embarcadores', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.cadastrarEmbarcador(supabase, {
    empresaId: req.empresa_id, user: req.user, body: req.body,
  })));

router.post('/embarcadores/:id/revogar', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.revogarAcesso(supabase, {
    empresaId: req.empresa_id, user: req.user, relationshipId: req.params.id, motivo: req.body?.motivo,
  })));

router.post('/embarcadores/:id/reativar', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.reativarAcesso(supabase, {
    empresaId: req.empresa_id, relationshipId: req.params.id,
  })));

router.get('/convites', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.listarConvites(supabase, {
    empresaId: req.empresa_id, relationshipId: req.query.relationship_id || null,
  })));

// A resposta contém o token em claro UMA vez (§18): é o instante da entrega.
// Não é logado em lugar nenhum.
router.post('/convites', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.convidarContato(supabase, {
    empresaId: req.empresa_id, user: req.user, body: req.body,
  })));

router.post('/convites/:id/revogar', exigirPermissoes(MANAGE), (req, res) =>
  responder(res, management.revogarConvite(supabase, {
    empresaId: req.empresa_id, conviteId: req.params.id,
  })));

module.exports = router;

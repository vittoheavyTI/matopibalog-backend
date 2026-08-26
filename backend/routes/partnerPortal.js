'use strict';

// routes/partnerPortal.js — superfície EXTERNA do parceiro (E3.6A).
//
// Este router nunca usa `verificarEmpresa`. É deliberado: o parceiro não tem
// tenant do solicitante, e a autorização dele é
//
//   identidade externa ∧ relacionamento ativo ∧ share explícito ∧ estado do share
//
// Nenhuma rota aqui aceita `empresa_id` do cliente. A empresa é sempre lida da
// linha de share encontrada a partir da organização do próprio token.

const express = require('express');

const router = express.Router();
const supabase = require('../config/supabase');
const { verifyPartnerToken, emitirTokenParceiro } = require('../middlewares/partnerPortalAuth');
const rede = require('../services/partnerNetwork/partnerNetworkService');
const oportunidades = require('../services/partnerNetwork/partnerOpportunityService');

function responderErro(res, err, contexto) {
  if (err instanceof rede.PartnerNetworkError) {
    const corpo = { message: err.message, code: err.code };
    if (err.details) corpo.details = err.details;
    return res.status(err.status).json(corpo);
  }
  console.error(`[partnerPortal:${contexto}]`, err?.message || err);
  return res.status(500).json({ message: 'Erro na área do parceiro.' });
}

// ── Ativação do convite (pública, protegida pelo token do convite) ─────────────

router.post('/ativar', async (req, res) => {
  try {
    const { token, nome } = req.body || {};
    const identidade = await rede.ativarConvite(supabase, { token, nome });
    const sessao = emitirTokenParceiro({
      partnerUserId: identidade.partner_user_id,
      partnerOrganizationId: identidade.partner_organization_id,
      email: identidade.email,
    });
    // O token do CONVITE é de uso único e morre aqui; o que segue é a sessão.
    res.status(200).json({ token: sessao, email: identidade.email });
  } catch (err) { responderErro(res, err, 'ativar'); }
});

// ── Daqui para baixo, tudo exige a sessão externa ──────────────────────────────

router.use(verifyPartnerToken);

router.get('/eu', (req, res) => {
  // Repare no que NÃO volta: nada do solicitante. Nem nome de empresa, nem id.
  res.json({
    partner_user_id: req.partnerUser.id,
    email: req.partnerUser.email,
  });
});

router.get('/oportunidades', async (req, res) => {
  try {
    res.json(await oportunidades.listarOportunidadesDoParceiro(supabase, {
      partnerOrganizationId: req.partnerUser.partner_organization_id,
    }));
  } catch (err) { responderErro(res, err, 'listarOportunidades'); }
});

router.get('/oportunidades/:recipientId', async (req, res) => {
  try {
    const { destinatario, oportunidade } = await oportunidades.resolverDestinatarioDoParceiro(supabase, {
      partnerOrganizationId: req.partnerUser.partner_organization_id,
      recipientId: req.params.recipientId,
    });

    if (!destinatario.visualizado_em) {
      await supabase.from('partner_opportunity_recipients')
        .update({ visualizado_em: new Date().toISOString() })
        .eq('id', destinatario.id);
    }

    // Histórico das PRÓPRIAS revisões — o parceiro vê o que ele mesmo respondeu,
    // nunca o que os outros responderam.
    const { data: revisoes } = await supabase
      .from('partner_opportunity_responses')
      .select('revisao, situacao, capacidade_quantidade, capacidade_unidade, disponivel_de, disponivel_ate, nota, criado_em')
      .eq('recipient_id', destinatario.id)
      .order('revisao', { ascending: false });

    return res.json({
      recipient_id: destinatario.id,
      oportunidade: oportunidades.projetarParaParceiro(oportunidade),
      minhas_respostas: revisoes || [],
    });
  } catch (err) { return responderErro(res, err, 'detalhe'); }
});

router.post('/oportunidades/:recipientId/responder', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await oportunidades.responder(supabase, {
      partnerOrganizationId: req.partnerUser.partner_organization_id,
      partnerUserId: req.partnerUser.id,
      origem: 'partner_portal',
      recipientId: req.params.recipientId,
      situacao: b.situacao,
      capacidadeQuantidade: b.capacidade_quantidade,
      capacidadeUnidade: b.capacidade_unidade,
      disponivelDe: b.disponivel_de,
      disponivelAte: b.disponivel_ate,
      nota: b.nota,
      clientRequestId: b.client_request_id,
    });
    return res.status(r.idempotent ? 200 : 201).json({
      revisao: r.resposta.revisao,
      situacao: r.resposta.situacao,
      idempotent: r.idempotent,
    });
  } catch (err) { return responderErro(res, err, 'responder'); }
});

module.exports = router;

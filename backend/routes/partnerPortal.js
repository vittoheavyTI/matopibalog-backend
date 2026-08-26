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
//
// HIGH-01: o acesso é DURÁVEL. O convite serve uma vez, para provar quem é; a
// partir daí a pessoa entra com e-mail e senha, como em qualquer produto. A
// versão anterior emitia uma sessão de 8h e mandava "abrir o link de novo" — um
// link já consumido —, o que não é um portal utilizável.

const express = require('express');

const router = express.Router();
const supabase = require('../config/supabase');
const { verifyPartnerToken, emitirTokenParceiro } = require('../middlewares/partnerPortalAuth');
const rede = require('../services/partnerNetwork/partnerNetworkService');
const identidade = require('../services/partnerNetwork/partnerIdentityService');
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

// ── Ativação do convite ───────────────────────────────────────────────────────
//
// A ORDEM É A SEGURANÇA. Primeiro prova-se a posse da identidade no Auth;
// só depois o convite é consumido. Assim uma senha errada não queima o convite —
// erro de digitação não pode custar o acesso.
//
// Conta que já existe (interna, de outro portal, qualquer uma): exige-se a senha
// ATUAL dela. Nunca redefinimos a senha de ninguém para "facilitar" a ativação.
router.post('/ativar', async (req, res) => {
  try {
    const { token, nome, senha, email } = req.body || {};
    if (!token) {
      throw new rede.PartnerNetworkError('Convite inválido.', { status: 400, code: 'convite_invalido' });
    }

    // O e-mail do convite é a autoridade: quem ativa é quem foi convidado.
    const alvo = await rede.emailDoConvite(supabase, { token });

    // 1. Prova de identidade — ANTES de tocar no convite.
    const auth = await identidade.resolverOuCriarIdentidade(supabase, {
      email: email ? String(email) : alvo,
      senha,
      nome,
    });

    // 2. Só agora o convite é consumido, atomicamente.
    const ativado = await rede.ativarConvite(supabase, {
      token, authUserId: auth.id, nome,
    });

    const sessao = emitirTokenParceiro({
      partnerUserId: ativado.partner_user_id,
      partnerOrganizationId: ativado.partner_organization_id,
      email: ativado.email,
    });
    return res.status(200).json({ token: sessao, email: ativado.email });
  } catch (err) { return responderErro(res, err, 'ativar'); }
});

// ── Login recorrente ──────────────────────────────────────────────────────────
//
// É isto que torna o acesso durável. Estar no Auth não autoriza nada: quem
// decide é o registro de parceiro ATIVO, conferido a seguir.
router.post('/entrar', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    const auth = await identidade.autenticarPorSenha({ email, senha });
    const contexto = await identidade.carregarContextoDoParceiro(supabase, { authUserId: auth.id });

    const sessao = emitirTokenParceiro({
      partnerUserId: contexto.id,
      partnerOrganizationId: contexto.partner_organization_id,
      email: contexto.email,
    });
    return res.status(200).json({ token: sessao, email: contexto.email, nome: contexto.nome });
  } catch (err) { return responderErro(res, err, 'entrar'); }
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

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

    // 1. PREFLIGHT (HIGH-09). Resolve o convite SEM consumi-lo e recusa aqui o
    //    que a ativação recusaria: token desconhecido, expirado, já usado,
    //    relacionamento revogado ou suspenso.
    //
    //    Antes, essa checagem só existia dentro da RPC de consumo — depois da
    //    criação da identidade no Auth. Um convite morto chegava a produzir uma
    //    conta nova em produção antes de a recusa acontecer. A conta não
    //    autorizava nada, mas era efeito colateral externo disparado por uma
    //    credencial inválida, e nenhum retorno desfazia isso.
    const convite = await rede.preflightDoConvite(supabase, { token });

    // 2. O E-MAIL DO CONVITE É A AUTORIDADE (HIGH-09).
    //
    //    O código anterior era `email: email ? String(email) : alvo` — ou seja,
    //    qualquer e-mail no corpo SUBSTITUÍA o e-mail para o qual o convite foi
    //    emitido. Quem tivesse o link (uma credencial ao portador, entregue à
    //    mão) informava a PRÓPRIA conta e provava posse dela, não da conta
    //    convidada. A prova de senha continuava intacta e completamente inútil:
    //    ela provava a identidade errada. O convite endereçado a
    //    contato@parceiro virava acesso para quem quisesse.
    //
    //    `body.email` permanece aceito só por compatibilidade de cliente, e
    //    apenas para CONFIRMAR. Divergir é negar — nunca reescrever o alvo.
    const informado = String(email || '').trim().toLowerCase();
    if (informado && informado !== convite.email) {
      throw new rede.PartnerNetworkError(
        'Este convite foi enviado para outro e-mail. Use o endereço que recebeu o convite.',
        { status: 403, code: 'convite_email_divergente' },
      );
    }

    // 3. Prova de identidade — do e-mail DO CONVITE, e antes de tocar no convite.
    const auth = await identidade.resolverOuCriarIdentidade(supabase, {
      email: convite.email,
      senha,
      nome,
    });

    // 4. Só agora o convite é consumido, atomicamente. A RPC revalida tudo de
    //    novo com a linha travada: o preflight acelera a recusa, não decide.
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
//
// HIGH-15 — UMA IDENTIDADE, VÁRIAS REDES.
// `PARTNER_MULTI_NETWORK_LOGIN_V1=EXPLICIT_CONTEXT_SELECTION`.
//
// A mesma pessoa pode ser parceira de duas transportadoras com o mesmo e-mail —
// a rede é privada de cada solicitante, e ninguém lá fora mantém uma caixa de
// entrada por cliente. A versão anterior resolvia o login com `maybeSingle()`,
// que FALHA com mais de uma linha: aceitar o segundo convite quebrava o login do
// primeiro, com erro 500 e sem explicação.
//
// As duas saídas fáceis estão descartadas por decisão: tornar `auth_user_id`
// único proibiria o segundo convite legítimo, e escolher uma linha em silêncio
// colocaria a pessoa na rede errada sem ela saber. A escolha é EXPLÍCITA, e só
// entre os contextos aos quais aquela identidade já está vinculada.
async function resolverSessao(res, { email, senha, partnerUserId = null }) {
  // A senha é provada em TODA entrada, inclusive na escolha de contexto. Não
  // existe token intermediário "quase autenticado" circulando entre as duas
  // telas: um artefato desses seria uma credencial nova para guardar, revogar e
  // errar.
  const auth = await identidade.autenticarPorSenha({ email, senha });
  const contextos = await identidade.listarContextosDoParceiro(supabase, { authUserId: auth.id });

  if (contextos.length === 0) {
    throw new rede.PartnerNetworkError(
      'Você ainda não tem acesso de parceiro. Use o convite recebido.',
      { status: 403, code: 'sem_acesso_de_parceiro' },
    );
  }

  let escolhido;
  if (partnerUserId) {
    // A PROVA que fecha o isolamento: o vínculo escolhido tem que estar na lista
    // DESTA identidade. Sem isso, `partner_user_id` no corpo seria um seletor
    // livre de organização — a rede de qualquer um, com a senha de qualquer um.
    escolhido = contextos.find((c) => c.id === partnerUserId);
    if (!escolhido) {
      throw new rede.PartnerNetworkError('Contexto de parceiro inválido.', {
        status: 403, code: 'contexto_invalido',
      });
    }
  } else if (contextos.length > 1) {
    return res.status(200).json({
      requires_context_selection: true,
      // Apenas os contextos desta identidade, e sem nada da transportadora
      // solicitante: o portal inteiro é construído sobre "nada do solicitante sai
      // daqui", e uma tela que aparece ANTES de haver sessão não é lugar para
      // abrir exceção.
      contextos: contextos.map((c) => ({
        partner_user_id: c.id,
        organizacao: c.organizacao,
        vinculado_em: c.vinculado_em,
      })),
    });
  } else {
    [escolhido] = contextos;
  }

  const sessao = emitirTokenParceiro({
    partnerUserId: escolhido.id,
    partnerOrganizationId: escolhido.partner_organization_id,
    email: escolhido.email,
  });
  // Um token, um contexto. O token de A não alcança B, e vice-versa — o
  // `verifyPartnerToken` relê a organização a cada requisição.
  return res.status(200).json({
    token: sessao,
    email: escolhido.email,
    nome: escolhido.nome,
    organizacao: escolhido.organizacao,
  });
}

router.post('/entrar', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    return await resolverSessao(res, { email, senha });
  } catch (err) { return responderErro(res, err, 'entrar'); }
});

// Escolha explícita de contexto, depois de `requires_context_selection`.
router.post('/contexto', async (req, res) => {
  try {
    const { email, senha, partner_user_id: partnerUserId } = req.body || {};
    if (!partnerUserId) {
      throw new rede.PartnerNetworkError('Escolha uma das redes para entrar.', {
        status: 400, code: 'contexto_obrigatorio',
      });
    }
    return await resolverSessao(res, { email, senha, partnerUserId });
  } catch (err) { return responderErro(res, err, 'contexto'); }
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

'use strict';

// routes/partnerNetwork.js — superfície INTERNA da rede de parceiros (E3.6A).
//
// Autoridade em camadas, sem atalho por nome de papel (D-072):
//   verifyToken → verificarEmpresa → requirePermission('partner_network.*')
//
// O entitlement `partner_network` é exigido pelo próprio resolver: as chaves
// declaram `entitlementCodigo`, então uma empresa que não contratou a rede tem
// as permissões negadas na origem — não é preciso um gate separado aqui.

const express = require('express');

const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const rede = require('../services/partnerNetwork/partnerNetworkService');
const oportunidades = require('../services/partnerNetwork/partnerOpportunityService');
const { getCampaignProgress } = require('../services/campaign/campaignProgressService');
const { resumirRotaDaCampanha } = require('../services/partnerNetwork/partnerRouteSummary');

router.use(verifyToken, verificarEmpresa);

function responderErro(res, err, contexto) {
  if (err instanceof rede.PartnerNetworkError) {
    const corpo = { message: err.message, code: err.code };
    if (err.details) corpo.details = err.details;
    return res.status(err.status).json(corpo);
  }
  console.error(`[partnerNetwork:${contexto}]`, err?.message || err);
  return res.status(500).json({ message: 'Erro na rede de parceiros.' });
}

// ── Parceiros ──────────────────────────────────────────────────────────────────

router.get('/parceiros', requirePermission('partner_network.view'), async (req, res) => {
  try {
    res.json(await rede.listarParceiros(supabase, { empresaId: req.empresa_id }));
  } catch (err) { responderErro(res, err, 'listarParceiros'); }
});

router.post('/parceiros', requirePermission('partner_network.manage'), async (req, res) => {
  try {
    const { nome, email, documento, apelido } = req.body || {};
    const r = await rede.convidarParceiro(supabase, {
      empresaId: req.empresa_id, actorUserId: req.user?.uid,
      nome, email, documento, apelido,
    });
    res.status(201).json(r);
  } catch (err) { responderErro(res, err, 'convidarParceiro'); }
});

router.patch('/parceiros/:id/situacao', requirePermission('partner_network.manage'), async (req, res) => {
  try {
    const { status, motivo } = req.body || {};
    res.json(await rede.alterarStatusDoParceiro(supabase, {
      empresaId: req.empresa_id, actorUserId: req.user?.uid,
      relationshipId: req.params.id, novoStatus: status, motivo,
    }));
  } catch (err) { responderErro(res, err, 'alterarStatus'); }
});

// ── Lacuna de capacidade da campanha ───────────────────────────────────────────

// Prévia do que seria compartilhado. Existe para a tela não precisar recalcular
// nada nem pedir ao operador que redigite o que já existe (§23).
router.get('/campanhas/:campaignId/lacuna', requirePermission('partner_network.share'), async (req, res) => {
  try {
    const lacuna = await carregarLacuna(req);
    res.json(lacuna);
  } catch (err) { responderErro(res, err, 'lacuna'); }
});

router.post('/campanhas/:campaignId/compartilhar', requirePermission('partner_network.share'), async (req, res) => {
  try {
    const { relationship_ids: relationshipIds, prazo_resposta: prazoResposta,
      mensagem, client_request_id: clientRequestId } = req.body || {};

    const lacuna = await carregarLacuna(req);
    if (!lacuna.pode_compartilhar) {
      return res.status(409).json({ message: lacuna.motivo, code: 'lacuna_indisponivel' });
    }

    const r = await oportunidades.compartilharLacuna(supabase, {
      empresaId: req.empresa_id,
      actorUserId: req.user?.uid,
      campanha: lacuna.campanha,
      residual: lacuna.residual,
      relationshipIds,
      prazoResposta,
      mensagem,
      clientRequestId,
    });
    return res.status(r.idempotent ? 200 : 201).json({
      oportunidade_id: r.oportunidade.id,
      destinatarios: r.destinatarios,
      idempotent: r.idempotent,
    });
  } catch (err) { return responderErro(res, err, 'compartilhar'); }
});

// Resolve a campanha DENTRO do tenant e projeta o residual canônico.
//
// A campanha é buscada com `empresa_id` no WHERE: uma campanha de outra empresa
// simplesmente não existe para este pedido, então não há como compartilhar
// carga alheia (§45).
async function carregarLacuna(req) {
  const { data: campanha, error } = await supabase
    .from('operation_campaigns')
    .select('id, reference_code, name, cargo_name, status, planning_status, approved_plan_version_id, planned_start, planned_end, timezone')
    .eq('id', req.params.campaignId)
    .eq('empresa_id', req.empresa_id)
    .maybeSingle();
  if (error) {
    throw new rede.PartnerNetworkError('Erro ao carregar a campanha.', { status: 500, code: 'campanha_erro' });
  }
  if (!campanha) {
    throw new rede.PartnerNetworkError('Campanha não encontrada.', { status: 404, code: 'campanha_nao_encontrada' });
  }

  // A lacuna vem do progresso canônico — nunca do `capacity_gap_quantity` do
  // cenário do planejador, que devolve a soma de TODAS as demandas quando existe
  // exceção hard e soma unidades diferentes sem converter.
  // `getCampaignProgress` já aplica o escopo operacional: um usuário não pode
  // compartilhar campanha fora do escopo dele (§45).
  const progresso = await getCampaignProgress(supabase, {
    empresaId: req.empresa_id,
    campaignId: campanha.id,
    operationalScope: req.operationalScope || null,
  });

  // HIGH-08: rota derivada da autoridade canônica. O operador não redigita
  // origem nem destino — eles já existem em `campaign_demands`/`campaign_locations`.
  const rota = await resumirRotaDaCampanha(supabase, {
    empresaId: req.empresa_id, campaignId: campanha.id,
  });

  const quantidade = progresso?.progress?.quantity || {};
  const restante = Number(quantidade.remaining || 0);
  const incompativel = quantidade?.coverage?.incompatible_units === true;

  let motivo = null;
  if (!campanha.approved_plan_version_id) {
    // `SHARE_REQUIRES_APPROVED_PLAN_VERSION`: sem plano aprovado não existe
    // residual canônico, e sem versão de plano não há como provar depois qual
    // fonte gerou o número — nem detectar que ela foi superada.
    motivo = 'Esta campanha ainda não tem plano aprovado. Aprove o plano antes de pedir capacidade.';
  } else if (incompativel) {
    motivo = 'As demandas desta campanha usam unidades que não podem ser somadas.';
  } else if (!(restante > 0)) {
    motivo = 'Esta campanha não tem quantidade restante para pedir capacidade.';
  }

  return {
    campanha,
    pode_compartilhar: !motivo,
    motivo,
    rota,
    residual: {
      remaining: restante,
      unit: quantidade.unit || null,
      known: !incompativel,
      compatible: !incompativel,
      origem_resumo: rota.origem_resumo,
      destino_resumo: rota.destino_resumo,
    },
    replan: progresso?.replan || null,
  };
}
// ── Oportunidades compartilhadas ───────────────────────────────────────────────

router.get('/oportunidades', requirePermission('partner_network.view'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('partner_opportunities')
      .select('id, campaign_id, cargo_descricao, quantidade, quantidade_unidade, estado, prazo_resposta, criado_em')
      .eq('empresa_id', req.empresa_id)
      .order('criado_em', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ itens: data || [] });
  } catch (err) { responderErro(res, err, 'listarOportunidades'); }
});

router.get('/oportunidades/:id', requirePermission('partner_network.view'), async (req, res) => {
  try {
    const { data: oport, error } = await supabase
      .from('partner_opportunities')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .maybeSingle();
    if (error) throw error;
    if (!oport) return res.status(404).json({ message: 'Oportunidade não encontrada.' });

    const destinatarios = await oportunidades.listarDestinatarios(supabase, {
      empresaId: req.empresa_id, opportunityId: oport.id,
    });
    return res.json({ oportunidade: oport, destinatarios });
  } catch (err) { return responderErro(res, err, 'detalheOportunidade'); }
});

router.post('/oportunidades/:id/retirar', requirePermission('partner_network.share'), async (req, res) => {
  try {
    res.json(await oportunidades.retirarOportunidade(supabase, {
      empresaId: req.empresa_id, actorUserId: req.user?.uid,
      opportunityId: req.params.id, motivo: req.body?.motivo || null,
    }));
  } catch (err) { responderErro(res, err, 'retirar'); }
});

module.exports = router;

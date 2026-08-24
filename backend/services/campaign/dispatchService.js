'use strict';

// dispatchService — camada de aplicacao do Dispatch V1 (designacao direta + oferta com
// primeiro aceite valido vencendo). A decisao atomica do vencedor vive inteiramente nas
// RPCs Postgres da migration 079 (dispatch_round_create/dispatch_offer_accept/decline/
// cancel, SECURITY DEFINER, service_role-only) -- este servico so: (1) faz o preview de
// elegibilidade reusando dispatchEligibilityService, sem duplicar scoring; (2) chama a
// RPC correta; (3) converge o vencedor para o Frete canonico via
// campaignMaterializationService.materializeSingleTrip (fase 2 -- reusa o mesmo criador
// de fretes do Campaign-B, idempotente/retryable); (4) notifica/publica o sinal realtime,
// best-effort, sem nunca falhar a mutacao principal por causa disso.

const { CampaignError } = require('./campaignService');
const { listTripEligibility } = require('./dispatchEligibilityService');
const { materializeSingleTrip } = require('./campaignMaterializationService');
const { publicarDispatchAtualizado } = require('./dispatchRealtimeSignal');
const notificacaoService = require('../notificacaoService');

const RPC_ERROR_MAP = {
  planned_trip_not_found: { status: 404, code: 'planned_trip_not_found', message: 'Viagem planejada não encontrada.' },
  planned_trip_not_dispatchable: { status: 409, code: 'planned_trip_not_dispatchable', message: 'Esta viagem não está disponível para despacho (já tem candidato, não está mais planejada, ou pertence a outro plano).' },
  planned_trip_already_materialized: { status: 409, code: 'planned_trip_already_materialized', message: 'Esta viagem já foi materializada em frete.' },
  planned_trip_has_active_round: { status: 409, code: 'planned_trip_has_active_round', message: 'Já existe uma rodada de despacho ativa para esta viagem.' },
  driver_not_eligible: { status: 422, code: 'driver_not_eligible', message: 'Motorista não está elegível no momento.' },
  resource_not_eligible: { status: 422, code: 'resource_not_eligible', message: 'Recurso (ativo/composição) não está elegível no momento.' },
  stale_driver_resource_assignment: { status: 409, code: 'stale_driver_resource_assignment', message: 'O vínculo entre motorista e recurso mudou; peça uma nova prévia de elegibilidade.' },
  exactly_one_resource_required: { status: 422, code: 'invalid_recipient', message: 'Informe exatamente um recurso (ativo ou composição) por destinatário.' },
  recipients_required: { status: 422, code: 'recipients_required', message: 'Informe ao menos um destinatário elegível.' },
  direct_assignment_requires_exactly_one_recipient: { status: 422, code: 'invalid_recipients_count', message: 'Designação direta exige exatamente um destinatário.' },
  offer_round_requires_expiration: { status: 422, code: 'expiration_required', message: 'Informe o prazo de expiração da oferta.' },
  invalid_mode: { status: 422, code: 'invalid_mode', message: 'Modo de despacho inválido.' },
  created_by_required: { status: 422, code: 'created_by_required', message: 'Ator obrigatório para criar a rodada.' },
  offer_not_found: { status: 404, code: 'offer_not_found', message: 'Oferta não encontrada.' },
  offer_not_owned_by_driver: { status: 403, code: 'offer_not_owned_by_driver', message: 'Esta oferta não pertence a você.' },
  offer_no_longer_available: { status: 409, code: 'offer_no_longer_available', message: 'Esta oferta não está mais disponível.' },
  round_not_open: { status: 409, code: 'round_not_open', message: 'Esta rodada não está mais aberta.' },
  round_expired: { status: 409, code: 'round_expired', message: 'O prazo desta oferta expirou.' },
  round_not_found: { status: 404, code: 'round_not_found', message: 'Rodada de despacho não encontrada.' },
  round_not_cancellable: { status: 409, code: 'round_not_cancellable', message: 'Esta rodada não pode mais ser cancelada.' },
};

function mapRpcError(error) {
  const raw = String(error?.message || '');
  const code = raw.split(':')[0].trim();
  const known = RPC_ERROR_MAP[code];
  if (known) return new CampaignError(known.message, { status: known.status, code: known.code });
  if (error?.code === '42P01') {
    return new CampaignError('Schema de dispatch ainda não aplicado.', { status: 503, code: 'dispatch_schema_missing' });
  }
  return new CampaignError('Erro de banco ao processar despacho.', {
    status: 500, code: 'dispatch_database_error', details: { db_message: raw || undefined, db_code: error?.code },
  });
}

function userId(user) {
  return user?.uid || user?.id || null;
}

async function callRpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw mapRpcError(error);
  return Array.isArray(data) ? data[0] : data;
}

// Candidatos elegíveis AGORA para uma viagem planejada (preview antes de designar/ofertar
// — §51/§52). Reusa 100% o motor de elegibilidade do Campaign-C; não recalcula nada aqui.
async function previewCandidates(supabase, { empresaId, campaignId, planId, tripId, operationalScope, limit }) {
  return listTripEligibility(supabase, { empresaId, campaignId, planId, tripId, operationalScope, limit });
}

// Intersecta os destinatários pedidos pelo manager com quem está REALMENTE elegível agora
// (§12). Nunca amplia silenciosamente a lista; ineligíveis/estranhos ao pedido são
// excluídos e reportados, nunca incluídos.
function intersectRecipients(requested, eligibility) {
  const eligibleByKey = new Map();
  for (const c of eligibility.candidates) {
    if (c.eligibility !== 'ELIGIBLE' && c.eligibility !== 'ELIGIBLE_WITH_WARNINGS') continue;
    const key = `${c.driver_id}:${c.asset_id || ''}:${c.composition_id || ''}`;
    eligibleByKey.set(key, c);
  }
  if (!requested || !requested.length) {
    // Sem seleção explícita do manager: usa TODOS os elegíveis (útil para "ofertar a todos").
    return { recipients: [...eligibleByKey.values()], excluded: [] };
  }
  const recipients = [];
  const excluded = [];
  for (const r of requested) {
    const key = `${r.driver_id}:${r.asset_id || ''}:${r.composition_id || ''}`;
    const match = eligibleByKey.get(key);
    if (match) recipients.push(match);
    else excluded.push(r);
  }
  return { recipients, excluded };
}

function toRpcRecipients(recipients) {
  return recipients.map((r) => ({
    driver_id: r.driver_id,
    asset_id: r.asset_id || null,
    composition_id: r.composition_id || null,
  }));
}

async function fetchOffers(supabase, empresaId, roundId) {
  const { data, error } = await supabase
    .from('dispatch_offers')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('round_id', roundId)
    .order('created_at', { ascending: true });
  if (error) throw mapRpcError(error);
  return data || [];
}

// Fase 2 (§29): converge o vencedor ja decidido atomicamente pela RPC para o Frete
// canonico. Best-effort do ponto de vista da CHAMADA (nao desfaz o round/offer se
// falhar — a materializacao e idempotente/retryable, ver materializeSingleTrip),
// mas o ERRO e propagado para o chamador decidir como informar o usuario.
async function materializeWinner(supabase, { empresaId, campaignId, planId, plannedTripId, user, materializationOptions, operationalScope, correlation }) {
  return materializeSingleTrip(supabase, {
    empresaId, campaignId, planId, plannedTripId, user,
    options: materializationOptions || {}, operationalScope, correlation,
  });
}

function notifyOfferCreated(offer, { campaignName, origem, destino } = {}) {
  try {
    notificacaoService.criarParaUsuario(offer.driver_id, {
      empresa_id: offer.empresa_id,
      tipo: 'dispatch_offer_criada',
      titulo: 'Nova oferta de viagem',
      mensagem: `Você recebeu uma oferta de viagem${origem && destino ? ` de ${origem} para ${destino}` : ''}${campaignName ? ` (${campaignName})` : ''}.`,
      entidade_id: offer.id,
      entidade_tipo: 'dispatch_offer',
      dedupe_key: `dispatch_offer_criada:${offer.id}`,
    });
  } catch { /* best-effort */ }
}

function notifyOfferResolved(offer, { titulo, mensagem }) {
  try {
    notificacaoService.criarParaUsuario(offer.driver_id, {
      empresa_id: offer.empresa_id,
      tipo: 'dispatch_offer_resolvida',
      titulo,
      mensagem,
      entidade_id: offer.id,
      entidade_tipo: 'dispatch_offer',
      dedupe_key: `dispatch_offer_resolvida:${offer.id}:${offer.status}`,
    });
  } catch { /* best-effort */ }
}

function notifyManagerOutcome(round, { titulo, mensagem }) {
  try {
    notificacaoService.criarParaUsuario(round.created_by, {
      empresa_id: round.empresa_id,
      tipo: 'dispatch_round_resolvida',
      titulo,
      mensagem,
      entidade_id: round.id,
      entidade_tipo: 'dispatch_round',
      dedupe_key: `dispatch_round_resolvida:${round.id}:${round.status}`,
    });
  } catch { /* best-effort */ }
}

// Designação direta (§10/§30): manager escolhe UM candidato hoje elegível. Revalida a
// elegibilidade no momento da mutação (não confia no preview anterior), reusa a MESMA
// RPC de decisão atômica (mode=DIRECT resolve na hora) e converge para o Frete.
async function directAssign(supabase, {
  empresaId, campaignId, planId, tripId, driverId, assetId, compositionId,
  materializationOptions, user, operationalScope, correlation,
}) {
  const eligibility = await listTripEligibility(supabase, { empresaId, campaignId, planId, tripId, operationalScope });
  const { recipients } = intersectRecipients(
    [{ driver_id: driverId, asset_id: assetId || null, composition_id: compositionId || null }],
    eligibility,
  );
  if (!recipients.length) {
    throw new CampaignError('O candidato indicado não está mais elegível para esta viagem.', {
      status: 409, code: 'candidate_no_longer_eligible',
    });
  }

  const round = await callRpc(supabase, 'dispatch_round_create', {
    p_empresa_id: empresaId,
    p_campaign_id: campaignId,
    p_plan_version_id: planId,
    p_planned_trip_id: tripId,
    p_mode: 'DIRECT',
    p_recipients: toRpcRecipients(recipients),
    p_expires_at: null,
    p_materialization_options: materializationOptions || {},
    p_created_by: userId(user),
    p_request_id: correlation?.request_id || null,
    p_correlation_id: correlation?.correlation_id || null,
  });

  const offers = await fetchOffers(supabase, empresaId, round.id);
  publicarDispatchAtualizado(round);

  let materialization = null;
  let materializationError = null;
  try {
    materialization = await materializeWinner(supabase, {
      empresaId, campaignId, planId, plannedTripId: tripId, user, materializationOptions, operationalScope, correlation,
    });
  } catch (err) {
    materializationError = err instanceof CampaignError ? { code: err.code, message: err.message } : { code: 'materialization_failed', message: 'Falha ao materializar; tente novamente em instantes.' };
  }

  if (offers[0]) notifyOfferResolved(offers[0], { titulo: 'Viagem designada a você', mensagem: 'Uma viagem foi designada diretamente a você.' });

  return { round, offers, materialization, materialization_error: materializationError };
}

// Rodada de oferta (§11/§13): cria N ofertas pendentes; nenhum vencedor ainda. O vencedor
// só é decidido depois, atomicamente, quando um motorista aceitar (acceptOffer).
async function createOfferRound(supabase, {
  empresaId, campaignId, planId, tripId, requestedRecipients, expiresAt, materializationOptions,
  user, operationalScope, correlation,
}) {
  const eligibility = await listTripEligibility(supabase, { empresaId, campaignId, planId, tripId, operationalScope });
  const { recipients, excluded } = intersectRecipients(requestedRecipients, eligibility);
  if (!recipients.length) {
    throw new CampaignError('Nenhum destinatário elegível para esta viagem no momento.', {
      status: 409, code: 'no_eligible_recipients',
    });
  }

  const round = await callRpc(supabase, 'dispatch_round_create', {
    p_empresa_id: empresaId,
    p_campaign_id: campaignId,
    p_plan_version_id: planId,
    p_planned_trip_id: tripId,
    p_mode: 'OFFER',
    p_recipients: toRpcRecipients(recipients),
    p_expires_at: expiresAt,
    p_materialization_options: materializationOptions || {},
    p_created_by: userId(user),
    p_request_id: correlation?.request_id || null,
    p_correlation_id: correlation?.correlation_id || null,
  });

  const offers = await fetchOffers(supabase, empresaId, round.id);
  publicarDispatchAtualizado(round);
  for (const offer of offers) notifyOfferCreated(offer, {});

  return { round, offers, excluded_requested_recipients: excluded };
}

// Aceite atômico (§13/§26/§29): a decisão do vencedor é inteiramente da RPC; aqui só
// convergimos o resultado já decidido para o Frete canônico e avisamos os demais.
async function acceptOffer(supabase, { empresaId, campaignId, planId, offerId, driverId, user, operationalScope, correlation }) {
  const offer = await callRpc(supabase, 'dispatch_offer_accept', {
    p_empresa_id: empresaId,
    p_offer_id: offerId,
    p_driver_id: driverId,
    p_request_id: correlation?.request_id || null,
    p_correlation_id: correlation?.correlation_id || null,
  });

  const { data: round, error: roundError } = await supabase
    .from('dispatch_rounds')
    .select('*')
    .eq('id', offer.round_id)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (roundError) throw mapRpcError(roundError);

  publicarDispatchAtualizado(round);

  let materialization = null;
  let materializationError = null;
  try {
    materialization = await materializeWinner(supabase, {
      empresaId,
      campaignId: campaignId || round.campaign_id,
      planId: planId || round.plan_version_id,
      plannedTripId: round.planned_trip_id,
      user,
      materializationOptions: round.materialization_options,
      operationalScope,
      correlation,
    });
  } catch (err) {
    materializationError = err instanceof CampaignError ? { code: err.code, message: err.message } : { code: 'materialization_failed', message: 'Falha ao materializar; tente novamente em instantes.' };
  }

  notifyManagerOutcome(round, {
    titulo: 'Oferta de despacho aceita',
    mensagem: 'Um motorista aceitou a oferta de viagem.',
  });

  const losers = await fetchOffers(supabase, empresaId, round.id);
  for (const o of losers) {
    if (o.status === 'LOST') notifyOfferResolved(o, { titulo: 'Oferta encerrada', mensagem: 'Outro motorista aceitou esta oferta antes de você.' });
  }

  return { offer, round, materialization, materialization_error: materializationError };
}

async function declineOffer(supabase, { empresaId, offerId, driverId, reason, correlation }) {
  const offer = await callRpc(supabase, 'dispatch_offer_decline', {
    p_empresa_id: empresaId,
    p_offer_id: offerId,
    p_driver_id: driverId,
    p_reason: reason || null,
    p_request_id: correlation?.request_id || null,
  });
  return { offer };
}

async function cancelRound(supabase, { empresaId, roundId, actorId, reason }) {
  const round = await callRpc(supabase, 'dispatch_round_cancel', {
    p_empresa_id: empresaId,
    p_round_id: roundId,
    p_actor_id: actorId,
    p_reason: reason || null,
  });
  publicarDispatchAtualizado(round);
  const offers = await fetchOffers(supabase, empresaId, roundId);
  for (const o of offers) {
    if (o.status === 'CANCELLED') notifyOfferResolved(o, { titulo: 'Oferta cancelada', mensagem: 'O gestor cancelou esta oferta de viagem.' });
  }
  return { round, offers };
}

async function getRound(supabase, { empresaId, roundId }) {
  const { data: round, error } = await supabase
    .from('dispatch_rounds')
    .select('*')
    .eq('id', roundId)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (error) throw mapRpcError(error);
  if (!round) throw new CampaignError('Rodada de despacho não encontrada.', { status: 404, code: 'round_not_found' });
  const offers = await fetchOffers(supabase, empresaId, roundId);
  return { round, offers };
}

// Ofertas do PRÓPRIO motorista (identidade do token — nunca de parâmetro do cliente).
async function listMyOffers(supabase, { empresaId, driverId, status }) {
  let query = supabase
    .from('dispatch_offers')
    .select('*, dispatch_rounds!inner(id, status, expires_at, planned_trip_id, campaign_id, mode)')
    .eq('empresa_id', empresaId)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw mapRpcError(error);
  return data || [];
}

// Resumo read-only por campanha, para a tool de IA (§65) e para UI de apoio: quantas
// rodadas estão abertas/atribuídas/expiradas/canceladas agora. Nunca despacha nada.
async function getCampaignDispatchSummary(supabase, { empresaId, campaignId }) {
  const { data, error } = await supabase
    .from('dispatch_rounds')
    .select('status, mode, expires_at')
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId);
  if (error) throw mapRpcError(error);
  const rows = data || [];
  const now = Date.now();
  const summary = { open: 0, open_expired_pending_selfheal: 0, assigned: 0, cancelled: 0, expired: 0, closed_no_acceptance: 0, direct: 0, offer: 0 };
  for (const r of rows) {
    if (r.mode === 'DIRECT') summary.direct += 1; else if (r.mode === 'OFFER') summary.offer += 1;
    if (r.status === 'OPEN') {
      if (r.expires_at && new Date(r.expires_at).getTime() <= now) summary.open_expired_pending_selfheal += 1;
      else summary.open += 1;
    } else if (r.status === 'ASSIGNED') summary.assigned += 1;
    else if (r.status === 'CANCELLED') summary.cancelled += 1;
    else if (r.status === 'EXPIRED') summary.expired += 1;
    else if (r.status === 'CLOSED_NO_ACCEPTANCE') summary.closed_no_acceptance += 1;
  }
  return { total_rounds: rows.length, ...summary };
}

module.exports = {
  previewCandidates,
  directAssign,
  createOfferRound,
  acceptOffer,
  declineOffer,
  cancelRound,
  getRound,
  listMyOffers,
  getCampaignDispatchSummary,
  mapRpcError,
  intersectRecipients,
};

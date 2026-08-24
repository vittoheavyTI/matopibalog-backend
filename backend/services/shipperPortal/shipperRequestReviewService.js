'use strict';

// shipperRequestReviewService — o lado da TRANSPORTADORA: caixa de entrada,
// revisão e decisão sobre solicitações recebidas do portal.
//
// O ponto central desta camada (§35/§97): aceitar uma solicitação NÃO faz o
// operador redigitar nada. O snapshot aceito é convertido diretamente no
// objetivo canônico do Operation Orchestrator (createObjective) — o mesmo que
// a transportadora usaria manualmente. Nenhum planejador paralelo, nenhuma
// transformação duplicada (§36/§98/§120).
//
// Duas fases, mesmo modelo já provado no Dispatch V1:
//   Fase 1 (atômica, no banco): RPC shipper_request_accept decide o aceite.
//   Fase 2 (idempotente, aplicação): cria a Campanha e vincula via RPC
//   shipper_request_link_campaign, protegida por índice único.

const orchestrator = require('../campaign/operationOrchestratorService');
const { ShipperPortalError, throwDb } = require('./shipperBoundaryService');

function userId(user) {
  return user?.uid || user?.id || null;
}

function mapRpcError(error) {
  const raw = String(error?.message || '');
  const code = raw.split(':')[0].trim();
  const mapa = {
    request_not_found: { status: 404, code: 'request_not_found', message: 'Solicitação não encontrada.' },
    request_not_acceptable: { status: 409, code: 'request_not_acceptable', message: 'Esta solicitação não está mais aguardando decisão.' },
    relationship_not_active: { status: 409, code: 'relationship_not_active', message: 'O acesso deste embarcador foi revogado. Reative o acesso antes de aceitar a solicitação.' },
    request_not_accepted: { status: 409, code: 'request_not_accepted', message: 'A solicitação precisa ser aceita antes de virar operação.' },
    request_already_linked_to_another_campaign: { status: 409, code: 'request_already_linked', message: 'Esta solicitação já está vinculada a outra operação.' },
  };
  const known = mapa[code];
  if (known) return new ShipperPortalError(known.message, { status: known.status, code: known.code });
  if (error?.code === '42P01') {
    return new ShipperPortalError('O Portal do Embarcador ainda não está disponível nesta instalação.', {
      status: 503, code: 'shipper_portal_schema_missing',
    });
  }
  if (error?.code === '23505') {
    return new ShipperPortalError('Esta operação já foi criada para outra solicitação.', {
      status: 409, code: 'campaign_already_claimed',
    });
  }
  return new ShipperPortalError('Não foi possível concluir a decisão agora. Tente novamente em instantes.', {
    status: 500, code: 'shipper_review_database_error', details: { db_code: error?.code },
  });
}

// Projeção para o operador interno: aqui SIM pode ver dados da solicitação, mas
// continua sendo uma projeção explícita (nunca `select *` cru para a resposta).
function projetarParaTransportadora(row, origens = []) {
  return {
    id: row.id,
    reference_code: row.reference_code,
    status: row.status,
    shipper_org_id: row.shipper_org_id,
    cargo_name: row.cargo_name,
    destination_name: row.destination_name,
    quantity_unit: row.quantity_unit,
    window_start: row.window_start,
    window_end: row.window_end,
    notes: row.notes,
    origins: origens.map((o) => ({ nome: o.nome, quantidade: Number(o.quantidade), quantity_unit: o.quantity_unit })),
    total_quantidade: origens.reduce((s, o) => s + Number(o.quantidade || 0), 0),
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    decision_reason: row.decision_reason,
    campaign_id: row.campaign_id,
    created_at: row.created_at,
  };
}

// Caixa de entrada (§33): prioriza o que exige ação, não um dashboard passivo.
async function listarCaixaDeEntrada(supabase, { empresaId, status = null }) {
  let query = supabase
    .from('shipper_transport_requests')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  throwDb(error, 'Não foi possível carregar as solicitações recebidas.');

  const rows = data || [];
  if (!rows.length) return { itens: [], resumo: { aguardando_decisao: 0, total: 0 } };

  const { data: origens, error: origensError } = await supabase
    .from('shipper_transport_request_origins')
    .select('request_id, nome, quantidade, quantity_unit, ordem')
    .in('request_id', rows.map((r) => r.id));
  throwDb(origensError, 'Não foi possível carregar os locais de coleta.');
  const porRequest = new Map();
  for (const o of origens || []) {
    if (!porRequest.has(o.request_id)) porRequest.set(o.request_id, []);
    porRequest.get(o.request_id).push(o);
  }

  const itens = rows.map((r) => projetarParaTransportadora(r, porRequest.get(r.id) || []));
  return {
    itens,
    resumo: {
      aguardando_decisao: itens.filter((i) => i.status === 'SUBMITTED').length,
      total: itens.length,
    },
  };
}

async function obterSolicitacao(supabase, { empresaId, requestId }) {
  const { data, error } = await supabase
    .from('shipper_transport_requests').select('*')
    .eq('empresa_id', empresaId).eq('id', requestId).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!data) throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  const { data: origens, error: origensError } = await supabase
    .from('shipper_transport_request_origins')
    .select('nome, quantidade, quantity_unit, ordem')
    .eq('request_id', requestId).order('ordem', { ascending: true });
  throwDb(origensError, 'Não foi possível carregar os locais de coleta.');
  return projetarParaTransportadora(data, origens || []);
}

// Converte o snapshot aceito no payload do objetivo canônico. É AQUI que a
// promessa "o operador não redigita nada" se materializa — e é deliberadamente
// uma tradução 1:1, sem regra de negócio nova.
function snapshotParaObjetivo(snapshot, { referenceCode }) {
  return {
    name: `Solicitação ${referenceCode}`,
    reference_code: referenceCode,
    cargo_name: snapshot.cargo_name,
    destination: snapshot.destination_name,
    origins: (snapshot.origins || []).map((o) => ({
      name: o.nome,
      target_quantity: o.quantidade,
      quantity_unit: o.quantity_unit,
    })),
    planned_start: snapshot.window_start || undefined,
    planned_end: snapshot.window_end || undefined,
  };
}

// Aceite + handoff. Fase 1 é atômica na RPC; fase 2 (criar Campanha + vincular)
// é idempotente e retryable — se falhar, o aceite permanece válido e a
// conversão pode ser tentada de novo sem duplicar operação (§37).
async function aceitarSolicitacao(supabase, { empresaId, requestId, user, operationalScope, correlation = {} }) {
  const atual = await supabase
    .from('shipper_transport_requests').select('*')
    .eq('empresa_id', empresaId).eq('id', requestId).maybeSingle();
  throwDb(atual.error, 'Não foi possível carregar a solicitação.');
  if (!atual.data) throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });

  // Fase 1: decisão atômica (dois operadores clicando juntos → só um vence).
  const { data: aceitaRaw, error: acceptError } = await supabase.rpc('shipper_request_accept', {
    p_empresa_id: empresaId,
    p_request_id: requestId,
    p_actor_id: userId(user),
    p_accepted_snapshot: atual.data.submitted_snapshot,
  });
  if (acceptError) throw mapRpcError(acceptError);
  const aceita = Array.isArray(aceitaRaw) ? aceitaRaw[0] : aceitaRaw;

  // Replay: já convertida — devolve sem criar nada de novo.
  if (aceita.campaign_id) {
    return { request: projetarParaTransportadora(aceita), campaign_id: aceita.campaign_id, criada_agora: false };
  }

  // Fase 2: objetivo canônico via Operation Orchestrator. Nenhuma lógica de
  // planejamento vive aqui (§100).
  const snapshot = aceita.accepted_snapshot || atual.data.submitted_snapshot;
  let campaignId = null;
  let handoffError = null;
  try {
    const objetivo = await orchestrator.createObjective(supabase, {
      empresaId,
      user,
      operationalScope,
      correlation,
      body: {
        ...snapshotParaObjetivo(snapshot, { referenceCode: aceita.reference_code }),
        client_request_id: `shipper-request:${aceita.id}`,
      },
    });
    campaignId = objetivo.campaign.id;
    const { error: linkError } = await supabase.rpc('shipper_request_link_campaign', {
      p_empresa_id: empresaId, p_request_id: requestId, p_campaign_id: campaignId,
    });
    if (linkError) throw mapRpcError(linkError);
  } catch (err) {
    // O aceite (fase 1) permanece válido: a conversão é retryable.
    handoffError = err instanceof ShipperPortalError
      ? { code: err.code, message: err.message }
      : { code: 'handoff_failed', message: 'A solicitação foi aceita, mas a operação ainda não pôde ser criada. Tente converter novamente.' };
  }

  return {
    request: projetarParaTransportadora({ ...aceita, campaign_id: campaignId }),
    campaign_id: campaignId,
    criada_agora: Boolean(campaignId),
    handoff_error: handoffError,
  };
}

async function decidirSemAceite(supabase, { empresaId, requestId, user, novoStatus, motivo }) {
  const permitidos = { REJECTED: 'rejeitar', CHANGES_REQUESTED: 'solicitar ajustes' };
  if (!permitidos[novoStatus]) {
    throw new ShipperPortalError('Decisão inválida.', { status: 400, code: 'invalid_decision' });
  }
  const razao = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
  if (!razao) {
    throw new ShipperPortalError('Informe o motivo para o embarcador entender a decisão.', {
      status: 400, code: 'decision_reason_required',
    });
  }
  const { data: atual, error: readError } = await supabase
    .from('shipper_transport_requests').select('status')
    .eq('empresa_id', empresaId).eq('id', requestId).maybeSingle();
  throwDb(readError, 'Não foi possível carregar a solicitação.');
  if (!atual) throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  if (atual.status !== 'SUBMITTED') {
    throw new ShipperPortalError('Esta solicitação não está mais aguardando decisão.', {
      status: 409, code: 'request_not_acceptable',
    });
  }

  const { data, error } = await supabase
    .from('shipper_transport_requests')
    .update({
      status: novoStatus, decided_at: new Date().toISOString(), decided_by: userId(user),
      decision_reason: razao, updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', empresaId).eq('id', requestId).eq('status', 'SUBMITTED')
    .select('*').maybeSingle();
  throwDb(error, 'Não foi possível registrar a decisão.');
  if (!data) {
    throw new ShipperPortalError('Esta solicitação acabou de ser decidida por outra pessoa.', {
      status: 409, code: 'request_not_acceptable',
    });
  }
  return projetarParaTransportadora(data);
}

module.exports = {
  listarCaixaDeEntrada,
  obterSolicitacao,
  aceitarSolicitacao,
  decidirSemAceite,
  snapshotParaObjetivo,
  projetarParaTransportadora,
  mapRpcError,
};

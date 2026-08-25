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
    decision_reason_required: { status: 400, code: 'decision_reason_required', message: 'Informe o motivo para o embarcador entender a decisão.' },
    invalid_decision: { status: 400, code: 'invalid_decision', message: 'Decisão inválida.' },
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

  const itens = rows.map((r) => ({
    ...projetarParaTransportadora(r, porRequest.get(r.id) || []),
    versao_atual: r.current_submission_version ?? null,
    revisoes: r.revision_count ?? 0,
    // Aceita mas sem operação criada: a conversão falhou e alguém precisa
    // reprocessar. É trabalho interno, e a caixa de entrada precisa mostrá-lo —
    // caso contrário fica invisível e o embarcador espera para sempre (§44).
    conversao_pendente: r.status === 'ACCEPTED' && !r.campaign_id,
  }));

  // Agrupamento por AÇÃO, não por status cru (§39/§87). A caixa de entrada
  // responde "o que preciso fazer", não "quantos registros existem".
  const novas = itens.filter((i) => i.status === 'SUBMITTED' && (i.revisoes || 0) === 0);
  const reenviadas = itens.filter((i) => i.status === 'SUBMITTED' && (i.revisoes || 0) > 0);
  const conversaoPendente = itens.filter((i) => i.conversao_pendente);
  const convertidas = itens.filter((i) => i.status === 'ACCEPTED' && i.campaign_id);
  const aguardandoEmbarcador = itens.filter((i) => i.status === 'CHANGES_REQUESTED');
  const encerradas = itens.filter((i) => ['REJECTED', 'CANCELLED'].includes(i.status));

  return {
    itens,
    grupos: {
      novas_solicitacoes: novas,
      ajustes_reenviados: reenviadas,
      conversao_pendente: conversaoPendente,
      aguardando_embarcador: aguardandoEmbarcador,
      convertidas_em_operacao: convertidas,
      encerradas,
    },
    resumo: {
      aguardando_decisao: novas.length + reenviadas.length,
      novas_solicitacoes: novas.length,
      ajustes_reenviados: reenviadas.length,
      conversao_pendente: conversaoPendente.length,
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

// Rejeitar ou pedir ajustes. Passou a ser ATÔMICO na RPC (PORTAL-B).
//
// Antes isto era um UPDATE condicional na aplicação: lia o status, e depois
// atualizava com `.eq('status','SUBMITTED')`. Isso protegia contra outra
// rejeição simultânea, mas NÃO travava a linha — o aceite e o cancelamento
// podiam ler o mesmo 'SUBMITTED' e seguir caminhos concorrentes. Agora todas as
// decisões disputam o MESMO `FOR UPDATE`, então existe uma ordem serial única.
//
// A decisão também é carimbada na VERSÃO avaliada, e não só na solicitação —
// é isso que permite, depois de um reenvio, saber que o pedido de ajuste se
// referia à v1 e não à v2.
async function decidirSemAceite(supabase, { empresaId, requestId, user, novoStatus, motivo }) {
  const permitidos = ['REJECTED', 'CHANGES_REQUESTED'];
  if (!permitidos.includes(novoStatus)) {
    throw new ShipperPortalError('Decisão inválida.', { status: 400, code: 'invalid_decision' });
  }
  const razao = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
  if (!razao) {
    throw new ShipperPortalError('Informe o motivo para o embarcador entender a decisão.', {
      status: 400, code: 'decision_reason_required',
    });
  }

  const { data, error } = await supabase.rpc('shipper_request_decide', {
    p_empresa_id: empresaId,
    p_request_id: requestId,
    p_actor_id: userId(user),
    p_new_status: novoStatus,
    p_reason: razao,
  });
  if (error) throw mapRpcError(error);
  const decidida = Array.isArray(data) ? data[0] : data;
  return projetarParaTransportadora(decidida);
}

// Histórico completo de envios, para o operador ver o que mudou entre a versão
// que ele devolveu e a que chegou agora — sem precisar comparar de cabeça.
async function historicoDaSolicitacao(supabase, { empresaId, requestId }) {
  const { data: request, error: reqError } = await supabase
    .from('shipper_transport_requests').select('id')
    .eq('id', requestId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(reqError, 'Não foi possível carregar a solicitação.');
  if (!request) {
    throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  }

  const { data, error } = await supabase
    .from('shipper_transport_request_submissions')
    .select('version, snapshot, submitted_at, decision, decision_reason, decided_at')
    .eq('request_id', requestId)
    .order('version', { ascending: false });
  throwDb(error, 'Não foi possível carregar o histórico da solicitação.');

  return {
    itens: (data || []).map((s) => ({
      versao: s.version,
      enviada_em: s.submitted_at,
      cargo_name: s.snapshot?.cargo_name || null,
      destination_name: s.snapshot?.destination_name || null,
      quantity_unit: s.snapshot?.quantity_unit || null,
      total_quantidade: s.snapshot?.total_quantidade ?? null,
      origens: (s.snapshot?.origins || []).map((o) => ({ nome: o.nome, quantidade: Number(o.quantidade) })),
      decisao: s.decision,
      motivo: s.decision_reason,
      decidida_em: s.decided_at,
    })),
  };
}

// Retentativa da conversão quando a fase 1 (aceite) passou mas a fase 2
// (criar/vincular a Campanha) falhou (§44/§91). Reusa `aceitarSolicitacao`, que
// é idempotente: a RPC de aceite devolve a solicitação já aceita sem reescrever
// nada, e a criação do objetivo usa o mesmo `client_request_id` — então não há
// como duplicar Campanha.
async function reconverterSolicitacao(supabase, opcoes) {
  const { empresaId, requestId } = opcoes;
  const { data, error } = await supabase
    .from('shipper_transport_requests').select('status, campaign_id')
    .eq('id', requestId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!data) throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  if (data.status !== 'ACCEPTED') {
    throw new ShipperPortalError('Só é possível criar a operação de uma solicitação aceita.', {
      status: 409, code: 'request_not_accepted',
    });
  }
  if (data.campaign_id) {
    return { campaign_id: data.campaign_id, criada_agora: false, ja_existia: true };
  }
  return aceitarSolicitacao(supabase, opcoes);
}

module.exports = {
  listarCaixaDeEntrada,
  obterSolicitacao,
  aceitarSolicitacao,
  decidirSemAceite,
  historicoDaSolicitacao,
  reconverterSolicitacao,
  snapshotParaObjetivo,
  projetarParaTransportadora,
  mapRpcError,
};

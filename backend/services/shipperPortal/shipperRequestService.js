'use strict';

// shipperRequestService — ciclo de vida da solicitação de transporte e o handoff
// para o Operation Orchestrator.
//
// A solicitação NÃO é um Frete e NÃO é uma Campaign (§24): é a declaração de
// necessidade do embarcador. Vira operação real somente quando a transportadora
// aceita — e, quando aceita, o objetivo é montado a partir do SNAPSHOT aceito,
// nunca redigitado pelo operador (§35/§97).

const {
  ShipperPortalError, loadPortalContext, requireRelationship,
  scopeRequestsQuery, requireOwnedRequest, throwDb,
} = require('./shipperBoundaryService');

const UNITS = new Set(['kg', 'ton', 'tonelada']);

function texto(value, field, { obrigatorio = true, max = 200 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (!obrigatorio) return null;
    throw new ShipperPortalError(`Informe ${field}.`, { status: 400, code: 'missing_field', details: { field } });
  }
  return s.slice(0, max);
}

function numero(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ShipperPortalError(`Informe uma quantidade válida para ${field}.`, {
      status: 400, code: 'invalid_quantity', details: { field },
    });
  }
  return n;
}

function unidade(value) {
  const u = String(value || 'ton').trim().toLowerCase();
  if (!UNITS.has(u)) {
    throw new ShipperPortalError('Unidade de quantidade inválida.', { status: 400, code: 'invalid_unit' });
  }
  return u;
}

// Normaliza as origens do payload (multi-origem, §26): cada origem carrega a
// própria quantidade; o total é sempre DERIVADO, nunca pedido ao usuário.
function normalizarOrigens(input) {
  const lista = Array.isArray(input) && input.length ? input : null;
  if (!lista) {
    throw new ShipperPortalError('Informe ao menos um local de coleta.', {
      status: 400, code: 'missing_origins',
    });
  }
  const vistos = new Set();
  return lista.map((o, idx) => {
    const nome = texto(o?.nome ?? o?.name, `o nome do local de coleta ${idx + 1}`);
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) {
      throw new ShipperPortalError(`O local de coleta "${nome}" está repetido.`, {
        status: 400, code: 'duplicate_origin', details: { nome },
      });
    }
    vistos.add(chave);
    return {
      nome,
      quantidade: numero(o?.quantidade ?? o?.target_quantity, `o local ${nome}`),
      quantity_unit: unidade(o?.quantity_unit ?? o?.unidade),
      ordem: idx,
    };
  });
}

// Snapshot imutável (§31/§88): congela exatamente o que foi declarado. Se o
// embarcador editar o cadastro depois, a operação histórica não muda.
function montarSnapshot(request, origens) {
  return {
    reference_code: request.reference_code,
    cargo_name: request.cargo_name,
    destination_name: request.destination_name,
    quantity_unit: request.quantity_unit,
    window_start: request.window_start,
    window_end: request.window_end,
    notes: request.notes,
    origins: origens.map((o) => ({
      nome: o.nome, quantidade: Number(o.quantidade), quantity_unit: o.quantity_unit, ordem: o.ordem,
    })),
    total_quantidade: origens.reduce((s, o) => s + Number(o.quantidade || 0), 0),
    snapshot_at: new Date().toISOString(),
  };
}

// Projeção segura para o embarcador (§106): whitelist explícita. Nunca
// devolvemos a linha inteira "menos campos sensíveis" — montamos só o que é
// externamente seguro.
function projetarRequestParaPortal(row, origens = []) {
  return {
    id: row.id,
    reference_code: row.reference_code,
    status: row.status,
    cargo_name: row.cargo_name,
    destination_name: row.destination_name,
    quantity_unit: row.quantity_unit,
    window_start: row.window_start,
    window_end: row.window_end,
    notes: row.notes,
    origins: origens.map((o) => ({ nome: o.nome, quantidade: Number(o.quantidade), quantity_unit: o.quantity_unit })),
    total_quantidade: origens.reduce((s, o) => s + Number(o.quantidade || 0), 0),
    created_at: row.created_at,
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    decision_reason: row.decision_reason,
    // campaign_id/decided_by/snapshots NÃO são expostos: são autoridade interna.
    operacao_criada: Boolean(row.campaign_id),
  };
}

async function carregarOrigens(supabase, requestId) {
  const { data, error } = await supabase
    .from('shipper_transport_request_origins')
    .select('nome, quantidade, quantity_unit, ordem')
    .eq('request_id', requestId)
    .order('ordem', { ascending: true });
  throwDb(error, 'Não foi possível carregar os locais de coleta.');
  return data || [];
}

// ---- Portal (embarcador) --------------------------------------------------

async function listarMinhasSolicitacoes(supabase, { portalUserId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const { data, error } = await scopeRequestsQuery(
    supabase.from('shipper_transport_requests').select('*').order('created_at', { ascending: false }).limit(100),
    context,
  );
  throwDb(error, 'Não foi possível carregar suas solicitações.');
  const rows = data || [];
  if (!rows.length) return { itens: [] };
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
  return { itens: rows.map((r) => projetarRequestParaPortal(r, porRequest.get(r.id) || [])) };
}

async function obterMinhaSolicitacao(supabase, { portalUserId, requestId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const row = await requireOwnedRequest(supabase, context, requestId);
  return projetarRequestParaPortal(row, await carregarOrigens(supabase, row.id));
}

// Criação + envio numa única ação guiada (§69): o embarcador declara a
// necessidade e ela já entra na caixa da transportadora. Idempotente por
// client_request_id (§115).
async function criarSolicitacao(supabase, { portalUserId, body = {} }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const relationship = requireRelationship(context, body.relationship_id || null);
  const clientRequestId = texto(body.client_request_id, 'a identificação da solicitação', { obrigatorio: false, max: 120 });

  if (clientRequestId) {
    const { data: existente, error } = await supabase
      .from('shipper_transport_requests')
      .select('*')
      .eq('shipper_org_id', context.shipperOrgId)
      .eq('created_by', portalUserId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    throwDb(error, 'Não foi possível verificar a solicitação.');
    if (existente) {
      return projetarRequestParaPortal(existente, await carregarOrigens(supabase, existente.id));
    }
  }

  const origens = normalizarOrigens(body.origins);
  const payload = {
    empresa_id: relationship.empresa_id,
    shipper_org_id: context.shipperOrgId,
    relationship_id: relationship.id,
    reference_code: texto(body.reference_code, 'a referência', { obrigatorio: false, max: 60 })
      || `SOL-${Date.now().toString(36).toUpperCase()}`,
    status: 'DRAFT',
    cargo_name: texto(body.cargo_name, 'o que será transportado'),
    destination_name: texto(body.destination_name, 'o destino'),
    quantity_unit: unidade(body.quantity_unit),
    window_start: body.window_start || null,
    window_end: body.window_end || null,
    notes: texto(body.notes, 'as observações', { obrigatorio: false, max: 2000 }),
    created_by: portalUserId,
    client_request_id: clientRequestId,
  };

  const { data: criada, error: insertError } = await supabase
    .from('shipper_transport_requests').insert(payload).select('*').single();
  throwDb(insertError, 'Não foi possível registrar a solicitação.');

  const { error: origensError } = await supabase
    .from('shipper_transport_request_origins')
    .insert(origens.map((o) => ({ ...o, request_id: criada.id, empresa_id: relationship.empresa_id })));
  throwDb(origensError, 'Não foi possível registrar os locais de coleta.');

  // Envia imediatamente: congela o snapshot do que foi declarado.
  const snapshot = montarSnapshot(criada, origens);
  const { data: enviada, error: submitError } = await supabase
    .from('shipper_transport_requests')
    .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString(), submitted_snapshot: snapshot, updated_at: new Date().toISOString() })
    .eq('id', criada.id)
    .select('*')
    .single();
  throwDb(submitError, 'Não foi possível enviar a solicitação.');

  return projetarRequestParaPortal(enviada, origens);
}

// Cancelamento pelo embarcador só ANTES da decisão (§41). Depois que virou
// operação, cancelar é decisão da transportadora — o portal nunca cancela
// Campaign/Frete diretamente.
async function cancelarSolicitacao(supabase, { portalUserId, requestId, motivo }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const row = await requireOwnedRequest(supabase, context, requestId);
  if (!['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'].includes(row.status)) {
    throw new ShipperPortalError(
      'Esta solicitação já foi decidida pela transportadora e não pode mais ser cancelada por aqui. Fale com a transportadora.',
      { status: 409, code: 'request_not_cancellable' });
  }
  const { data, error } = await supabase
    .from('shipper_transport_requests')
    .update({
      status: 'CANCELLED', cancelled_at: new Date().toISOString(),
      decision_reason: texto(motivo, 'o motivo', { obrigatorio: false, max: 500 }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select('*')
    .single();
  throwDb(error, 'Não foi possível cancelar a solicitação.');
  return projetarRequestParaPortal(data, await carregarOrigens(supabase, row.id));
}

module.exports = {
  ShipperPortalError,
  criarSolicitacao,
  listarMinhasSolicitacoes,
  obterMinhaSolicitacao,
  cancelarSolicitacao,
  normalizarOrigens,
  montarSnapshot,
  projetarRequestParaPortal,
};

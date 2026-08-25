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

// Quantidade precisa ser > 0: uma origem com zero não representa necessidade de
// transporte nenhuma (HIGH-04).
function numero(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ShipperPortalError(`Informe uma quantidade maior que zero para ${field}.`, {
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

// Normaliza as origens (multi-origem, §26). Cada origem carrega a própria
// QUANTIDADE, mas não a própria UNIDADE: a solicitação tem UMA unidade canônica
// e todas as origens usam ela (ONE_REQUEST_LEVEL_UNIT, HIGH-04). Sem isso,
// somar 1000 kg + 1 ton produziria "1001" — um número sem significado.
// Se a origem trouxer unidade explícita divergente, recusamos em vez de
// reinterpretar silenciosamente.
function normalizarOrigens(input, unidadeSolicitacao = 'ton') {
  const lista = Array.isArray(input) && input.length ? input : null;
  if (!lista) {
    throw new ShipperPortalError('Informe ao menos um local de coleta.', {
      status: 400, code: 'missing_origins',
    });
  }
  const canonica = unidade(unidadeSolicitacao);
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

    const unidadeInformada = o?.quantity_unit ?? o?.unidade;
    if (unidadeInformada && unidade(unidadeInformada) !== canonica) {
      throw new ShipperPortalError(
        'As quantidades da solicitação precisam usar a mesma unidade. Escolha uma unidade para toda a solicitação.',
        { status: 400, code: 'origin_unit_mismatch', details: { nome } },
      );
    }

    return {
      nome,
      quantidade: numero(o?.quantidade ?? o?.target_quantity, `o local ${nome}`),
      quantity_unit: canonica,
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
    // Versão corrente: o portal devolve no reenvio como `expected_version`, o
    // que impede sobrescrever uma correção feita por outra pessoa da empresa.
    versao_atual: row.current_submission_version ?? null,
    revisoes: row.revision_count ?? 0,
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

// Traduz erros das RPCs do portal em mensagens acionáveis em pt-BR.
function mapRpcError(error) {
  const raw = String(error?.message || '');
  const code = raw.split(':')[0].trim();
  const mapa = {
    relationship_not_found: { status: 404, code: 'relationship_not_found', message: 'Transportadora não encontrada para o seu acesso.' },
    relationship_not_active: { status: 403, code: 'relationship_not_active', message: 'Seu acesso a esta transportadora foi revogado.' },
    portal_user_not_in_org: { status: 403, code: 'portal_user_not_in_org', message: 'Seu usuário não pertence a esta empresa embarcadora.' },
    origins_required: { status: 400, code: 'missing_origins', message: 'Informe ao menos um local de coleta.' },
    invalid_quantity_unit: { status: 400, code: 'invalid_unit', message: 'Unidade de quantidade inválida. Use kg ou toneladas.' },
    origin_unit_mismatch: {
      status: 400,
      code: 'origin_unit_mismatch',
      message: 'As quantidades da solicitação precisam usar a mesma unidade. Escolha uma unidade para toda a solicitação.',
    },
    origin_quantity_must_be_positive: {
      status: 400,
      code: 'invalid_quantity',
      message: 'Cada local de coleta precisa ter uma quantidade maior que zero.',
    },
    request_not_found: { status: 404, code: 'request_not_found', message: 'Solicitação não encontrada.' },
    request_not_cancellable: {
      status: 409,
      code: 'request_not_cancellable',
      message: 'Esta solicitação já foi decidida pela transportadora e não pode mais ser cancelada por aqui. Fale com a transportadora.',
    },
    request_not_revisable: {
      status: 409,
      code: 'request_not_revisable',
      message: 'Esta solicitação não está aguardando correção. Atualize a página para ver a situação atual.',
    },
    request_version_conflict: {
      status: 409,
      code: 'request_version_conflict',
      message: 'Esta solicitação foi alterada enquanto você editava. Atualize a página e refaça a correção.',
    },
  };
  const known = mapa[code];
  if (known) return new ShipperPortalError(known.message, { status: known.status, code: known.code });
  if (error?.code === '42P01') {
    return new ShipperPortalError('O Portal do Embarcador ainda não está disponível nesta instalação.', {
      status: 503, code: 'shipper_portal_schema_missing',
    });
  }
  return new ShipperPortalError('Não foi possível concluir a operação agora. Tente novamente em instantes.', {
    status: 500, code: 'shipper_portal_database_error', details: { db_code: error?.code },
  });
}

// Criação + envio numa única ação guiada (§69) e — depois do owner review —
// numa única TRANSAÇÃO (HIGH-02). Antes eram 3 escritas independentes: se a
// segunda ou a terceira falhasse, sobrava um DRAFT parcial commitado, e um
// retry com o mesmo client_request_id devolvia essa solicitação incompleta como
// se estivesse pronta. Agora a RPC faz tudo atomicamente e monta o snapshot a
// partir das MESMAS origens gravadas.
async function criarSolicitacao(supabase, { portalUserId, body = {} }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const relationship = requireRelationship(context, body.relationship_id || null);
  const clientRequestId = texto(body.client_request_id, 'a identificação da solicitação', { obrigatorio: false, max: 120 });

  // Validação/normalização continua aqui (mensagens em pt-BR acionáveis); a
  // ATOMICIDADE é responsabilidade da RPC. A unidade da SOLICITAÇÃO é a
  // autoridade — as origens herdam dela (HIGH-04).
  const unidadeCanonica = unidade(body.quantity_unit);
  const origens = normalizarOrigens(body.origins, unidadeCanonica);

  const { data, error } = await supabase.rpc('shipper_request_create_and_submit', {
    p_shipper_org_id: context.shipperOrgId,
    p_relationship_id: relationship.id,
    p_portal_user_id: portalUserId,
    p_reference_code: texto(body.reference_code, 'a referência', { obrigatorio: false, max: 60 })
      || `SOL-${Date.now().toString(36).toUpperCase()}`,
    p_cargo_name: texto(body.cargo_name, 'o que será transportado'),
    p_destination_name: texto(body.destination_name, 'o destino'),
    p_quantity_unit: unidadeCanonica,
    p_window_start: body.window_start || null,
    p_window_end: body.window_end || null,
    p_notes: texto(body.notes, 'as observações', { obrigatorio: false, max: 2000 }),
    // Sem quantity_unit por origem: a RPC grava a unidade canônica da
    // solicitação em todas elas (ONE_REQUEST_LEVEL_UNIT).
    p_origins: origens.map((o) => ({ nome: o.nome, quantidade: o.quantidade })),
    p_client_request_id: clientRequestId,
  });
  if (error) throw mapRpcError(error);
  const criada = Array.isArray(data) ? data[0] : data;
  return projetarRequestParaPortal(criada, await carregarOrigens(supabase, criada.id));
}

// Cancelamento pelo embarcador só ANTES da decisão (§41) — e, depois do owner
// review (HIGH-03), de forma ATÔMICA. Antes lia o status e depois atualizava
// por id sem condição de estado: entre a leitura e a escrita a transportadora
// podia ACEITAR, e o cancelamento sobrescrevia uma decisão já tomada. A RPC usa
// FOR UPDATE na mesma linha que shipper_request_accept disputa, então existe
// exatamente um desfecho terminal.
async function cancelarSolicitacao(supabase, { portalUserId, requestId, motivo }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  // Mantém a checagem de fronteira ANTES da RPC: garante 404 consistente para
  // recurso fora do escopo (§80) sem depender só do erro do banco.
  await requireOwnedRequest(supabase, context, requestId);

  const { data, error } = await supabase.rpc('shipper_request_cancel', {
    p_shipper_org_id: context.shipperOrgId,
    p_request_id: requestId,
    p_portal_user_id: portalUserId,
    p_reason: texto(motivo, 'o motivo', { obrigatorio: false, max: 500 }),
  });
  if (error) throw mapRpcError(error);
  const cancelada = Array.isArray(data) ? data[0] : data;
  return projetarRequestParaPortal(cancelada, await carregarOrigens(supabase, requestId));
}

// Correção e reenvio (PORTAL-B). A transportadora pediu ajustes; o embarcador
// corrige e reenvia. A submissão anterior NÃO é sobrescrita: vira a versão
// anterior no histórico, com o motivo do pedido de ajuste carimbado nela.
//
// `expected_version` é controle otimista: se o portal estava exibindo a v2 e o
// banco já foi para a v3, o reenvio falha em vez de sobrescrever silenciosamente
// uma correção que outra pessoa da mesma empresa acabou de mandar.
async function revisarSolicitacao(supabase, { portalUserId, requestId, body = {} }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const atual = await requireOwnedRequest(supabase, context, requestId);

  const unidadeCanonica = unidade(body.quantity_unit || atual.quantity_unit);
  const origens = normalizarOrigens(body.origins, unidadeCanonica);

  const { data, error } = await supabase.rpc('shipper_request_revise_and_resubmit', {
    p_shipper_org_id: context.shipperOrgId,
    p_request_id: requestId,
    p_portal_user_id: portalUserId,
    p_cargo_name: texto(body.cargo_name, 'o que será transportado', { obrigatorio: false }) || atual.cargo_name,
    p_destination_name: texto(body.destination_name, 'o destino', { obrigatorio: false }) || atual.destination_name,
    p_quantity_unit: unidadeCanonica,
    p_window_start: body.window_start || null,
    p_window_end: body.window_end || null,
    p_notes: texto(body.notes, 'as observações', { obrigatorio: false, max: 2000 }),
    p_origins: origens.map((o) => ({ nome: o.nome, quantidade: o.quantidade })),
    p_expected_version: Number.isInteger(body.expected_version) ? body.expected_version : null,
  });
  if (error) throw mapRpcError(error);
  const revisada = Array.isArray(data) ? data[0] : data;
  return projetarRequestParaPortal(revisada, await carregarOrigens(supabase, requestId));
}

// Histórico de envios de UMA solicitação, para o embarcador entender o que ele
// mandou antes e por que foi devolvido. Projeção enxuta: o snapshot completo de
// versões antigas não é despejado na tela — só o essencial para reconhecer a
// versão e a decisão que ela recebeu.
async function historicoDaSolicitacao(supabase, { portalUserId, requestId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  await requireOwnedRequest(supabase, context, requestId);

  // ORDEM CRESCENTE, ao contrário da caixa de entrada interna. Para o
  // embarcador a leitura útil é causa → correção: envio 1, o que a
  // transportadora pediu, envio 2. Ler do mais novo para o mais antigo mostrava
  // o resultado antes do motivo, e contradizia a linha do tempo logo abaixo na
  // mesma tela, que sempre foi cronológica (VIS-09).
  const { data, error } = await supabase
    .from('shipper_transport_request_submissions')
    .select('version, snapshot, submitted_at, decision, decision_reason, decided_at')
    .eq('request_id', requestId)
    .order('version', { ascending: true });
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

module.exports = {
  ShipperPortalError,
  criarSolicitacao,
  listarMinhasSolicitacoes,
  obterMinhaSolicitacao,
  cancelarSolicitacao,
  revisarSolicitacao,
  historicoDaSolicitacao,
  normalizarOrigens,
  montarSnapshot,
  projetarRequestParaPortal,
  mapRpcError,
};

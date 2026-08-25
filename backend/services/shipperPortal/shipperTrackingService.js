'use strict';

// shipperTrackingService — a AUTORIDADE ÚNICA da projeção de acompanhamento
// para o embarcador (§49). A tela não decide status; ela exibe o que sai daqui.
//
// Princípio que governa este arquivo (§46): o portal NÃO tem máquina de estados
// própria. Ele projeta o estado canônico que já existe — solicitação, Campanha,
// Frete, ePOD — em um vocabulário que faz sentido para quem está de fora e não
// sabe (nem deveria saber) o que é Campaign, Dispatch ou ePOD (§5/§143).
//
// PROVENIÊNCIA, não heurística (§50/§51): a única forma de uma operação aparecer
// para um embarcador é a cadeia explícita
//     solicitação → campaign_id → campaign_trip_freights → fretes.
// Nenhum Frete histórico é associado por semelhança de texto de origem/destino.
// Se não há solicitação de origem, não aparece — mesmo que "pareça" ser dele.

const {
  ShipperPortalError, throwDb, loadPortalContext, scopeRequestsQuery,
} = require('./shipperBoundaryService');
const { freightStatusToBucket, EXECUTION_BUCKET } = require('../campaign/freightExecutionStatus');
const { getCampaignQuantitySummaryBatch } = require('../campaign/campaignProgressService');

// Vocabulário externo. Congelado e testado — adicionar um estado aqui é uma
// decisão consciente, não um efeito colateral.
const EXTERNAL_STATUS = Object.freeze({
  RECEBIDA: 'RECEBIDA',
  EM_ANALISE: 'EM_ANALISE',
  AJUSTES_SOLICITADOS: 'AJUSTES_SOLICITADOS',
  ACEITA: 'ACEITA',
  EM_PLANEJAMENTO: 'EM_PLANEJAMENTO',
  AGENDADA: 'AGENDADA',
  EM_TRANSPORTE: 'EM_TRANSPORTE',
  // Parte da carga chegou, parte ainda não. Estado necessário porque o
  // vocabulário anterior obrigava a escolher entre mentir ("Entregue") e
  // esconder ("Em transporte", com nada rodando).
  PARCIALMENTE_ENTREGUE: 'PARCIALMENTE_ENTREGUE',
  ENTREGUE: 'ENTREGUE',
  COMPROVANTE_DISPONIVEL: 'COMPROVANTE_DISPONIVEL',
  CANCELADA: 'CANCELADA',
  RECUSADA: 'RECUSADA',
  // Estado honesto para quando o interno não diz nada conclusivo. Nunca
  // inventamos progresso: um status desconhecido JAMAIS vira "Em transporte"
  // (§48) — isso faria o embarcador acreditar que a carga saiu quando ninguém
  // sabe se saiu.
  ATUALIZACAO_EM_PROCESSAMENTO: 'ATUALIZACAO_EM_PROCESSAMENTO',
});

const ROTULO = Object.freeze({
  RECEBIDA: 'Solicitação recebida',
  EM_ANALISE: 'Em análise pela transportadora',
  AJUSTES_SOLICITADOS: 'Ajustes solicitados',
  ACEITA: 'Solicitação aceita',
  EM_PLANEJAMENTO: 'Em planejamento',
  AGENDADA: 'Transporte agendado',
  EM_TRANSPORTE: 'Em transporte',
  PARCIALMENTE_ENTREGUE: 'Entrega parcial',
  ENTREGUE: 'Entrega concluída',
  COMPROVANTE_DISPONIVEL: 'Comprovante disponível',
  CANCELADA: 'Cancelada',
  RECUSADA: 'Não atendida',
  ATUALIZACAO_EM_PROCESSAMENTO: 'Atualização em processamento',
});

// Mapa congelado: status da SOLICITAÇÃO → estado externo. Enquanto não existe
// operação, é a solicitação que manda.
const REQUEST_STATUS_TO_EXTERNAL = Object.freeze({
  DRAFT: EXTERNAL_STATUS.RECEBIDA,
  SUBMITTED: EXTERNAL_STATUS.EM_ANALISE,
  CHANGES_REQUESTED: EXTERNAL_STATUS.AJUSTES_SOLICITADOS,
  ACCEPTED: EXTERNAL_STATUS.ACEITA,
  REJECTED: EXTERNAL_STATUS.RECUSADA,
  CANCELLED: EXTERNAL_STATUS.CANCELADA,
});

// Mapa congelado: status da CAMPANHA → estado externo, usado enquanto ainda não
// há Frete materializado. `CANCELLED` da campanha não vira "cancelada" para o
// embarcador: a solicitação dele foi aceita, e o que a transportadora faz com o
// planejamento interno depois é assunto interno até virar decisão externa.
const CAMPAIGN_STATUS_TO_EXTERNAL = Object.freeze({
  DRAFT: EXTERNAL_STATUS.EM_PLANEJAMENTO,
  PLANNING: EXTERNAL_STATUS.EM_PLANEJAMENTO,
  READY_FOR_REVIEW: EXTERNAL_STATUS.EM_PLANEJAMENTO,
  APPROVED: EXTERNAL_STATUS.AGENDADA,
  CANCELLED: EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO,
});

// Deriva o estado externo a partir da evidência REAL disponível, na ordem de
// autoridade: solicitação (desfechos terminais) > demanda residual > execução.
//
// A REGRA QUE MAIS IMPORTA AQUI (owner review HIGH-04): "entregue" NÃO é "todos
// os fretes materializados terminaram". A versão anterior tratava
// `concluídos + cancelados === total` como entrega — o que significa que uma
// operação com 30 t entregues e 70 t canceladas era anunciada ao cliente como
// ENTREGUE, embora 70 t da carga dele nunca tivessem saído do lugar.
//
// A autoridade agora é a DEMANDA RESIDUAL calculada pelo serviço canônico de
// progresso: só há entrega quando não sobra demanda a atender. Quantidade
// cancelada nunca abate demanda — ela volta para o residual.
function derivarStatusExterno({ request, campaign, freights = [], temComprovante = false, quantidade = null }) {
  const statusSolicitacao = REQUEST_STATUS_TO_EXTERNAL[request.status];

  // Desfechos da própria solicitação são terminais e não são sobrepostos por
  // nada operacional.
  if (request.status === 'CANCELLED') return EXTERNAL_STATUS.CANCELADA;
  if (request.status === 'REJECTED') return EXTERNAL_STATUS.RECUSADA;
  if (request.status !== 'ACCEPTED') {
    return statusSolicitacao || EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO;
  }

  // Aceita, mas a operação ainda não existe. Pode ser handoff pendente (§45):
  // o embarcador vê "aceita", nunca um erro interno.
  if (!campaign) return EXTERNAL_STATUS.ACEITA;

  const buckets = freights.map((f) => freightStatusToBucket(f.status));
  const emExecucao = buckets.filter((b) => b === EXECUTION_BUCKET.IN_EXECUTION).length;
  const concluidos = buckets.filter((b) => b === EXECUTION_BUCKET.COMPLETED).length;

  // Entrega exige prova de que a necessidade foi atendida — e só o cálculo
  // canônico de quantidade dá essa prova. Sem medição conclusiva, não afirmamos.
  const podeAfirmarEntrega = Boolean(quantidade && quantidade.conclusivo);
  if (podeAfirmarEntrega && quantidade.remaining <= 0 && quantidade.completed > 0) {
    return temComprovante ? EXTERNAL_STATUS.COMPROVANTE_DISPONIVEL : EXTERNAL_STATUS.ENTREGUE;
  }

  // Há transporte acontecendo agora.
  if (emExecucao > 0) return EXTERNAL_STATUS.EM_TRANSPORTE;

  // Houve entrega parcial mas ainda sobra demanda: NÃO é "entregue", e também
  // não é "em transporte" (nada está rodando). O cliente precisa de um estado
  // honesto, sem jargão interno de replanejamento.
  if (concluidos > 0 && podeAfirmarEntrega && quantidade.remaining > 0) {
    return EXTERNAL_STATUS.PARCIALMENTE_ENTREGUE;
  }

  if (freights.length) {
    // Existe execução materializada, mas nada dela permite concluir progresso.
    if (!podeAfirmarEntrega) return EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO;
    if (concluidos === 0 && quantidade.trips.cancelled > 0) return EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO;
    return EXTERNAL_STATUS.AGENDADA;
  }

  return CAMPAIGN_STATUS_TO_EXTERNAL[campaign.status] || EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO;
}

// A próxima ação em linguagem de quem está de fora (§80). "Status:
// CHANGES_REQUESTED" não é uma instrução — "Corrigir solicitação" é.
function derivarProximaAcao(statusExterno, { requestId }) {
  switch (statusExterno) {
    case EXTERNAL_STATUS.AJUSTES_SOLICITADOS:
      return { rotulo: 'Corrigir solicitação', tipo: 'REVISAR', request_id: requestId };
    case EXTERNAL_STATUS.COMPROVANTE_DISPONIVEL:
      return { rotulo: 'Baixar comprovante', tipo: 'VER_COMPROVANTE', request_id: requestId };
    case EXTERNAL_STATUS.EM_TRANSPORTE:
    case EXTERNAL_STATUS.AGENDADA:
    // Entrega parcial ainda é operação em curso do ponto de vista do cliente:
    // parte da carga dele continua esperando.
    case EXTERNAL_STATUS.PARCIALMENTE_ENTREGUE:
      return { rotulo: 'Acompanhar operação', tipo: 'ACOMPANHAR', request_id: requestId };
    default:
      return { rotulo: 'No momento, nenhuma ação é necessária.', tipo: 'NENHUMA', request_id: requestId };
  }
}

// Linha do tempo por whitelist (§54). Marcos derivados de evidência real — nunca
// um despejo de eventos de auditoria interna.
function montarLinhaDoTempo({ request, campaign, freights = [], comprovanteEm = null, quantidade = null }) {
  const marcos = [];
  const push = (chave, rotulo, em) => { if (em) marcos.push({ chave, rotulo, em }); };

  push('SOLICITACAO_ENVIADA', 'Solicitação enviada', request.submitted_at || request.created_at);
  if (request.status === 'CHANGES_REQUESTED' || request.revision_count > 0) {
    push('AJUSTES_SOLICITADOS', 'Ajustes solicitados pela transportadora', request.decided_at);
  }
  if (request.status === 'ACCEPTED') push('SOLICITACAO_ACEITA', 'Solicitação aceita', request.decided_at);
  if (request.status === 'REJECTED') push('SOLICITACAO_RECUSADA', 'Solicitação não atendida', request.decided_at);
  if (request.status === 'CANCELLED') push('SOLICITACAO_CANCELADA', 'Solicitação cancelada', request.cancelled_at);

  if (campaign && campaign.status === 'APPROVED') {
    push('OPERACAO_PLANEJADA', 'Operação planejada', campaign.approved_at || campaign.updated_at);
  }

  const emExecucao = freights.filter((f) => freightStatusToBucket(f.status) === EXECUTION_BUCKET.IN_EXECUTION);
  const concluidos = freights.filter((f) => freightStatusToBucket(f.status) === EXECUTION_BUCKET.COMPLETED);
  if (emExecucao.length) {
    const inicio = emExecucao.map((f) => f.created_at).filter(Boolean).sort()[0];
    push('EM_TRANSPORTE', 'Em transporte', inicio);
  }
  if (concluidos.length) {
    const fim = concluidos.map((f) => f.updated_at || f.created_at).filter(Boolean).sort().pop();
    // "Entrega concluída" só quando a demanda foi realmente satisfeita. Com
    // saldo restante, o marco honesto é a entrega parcial — caso contrário a
    // linha do tempo diria "concluída" com carga do cliente ainda parada.
    const completa = Boolean(quantidade && quantidade.conclusivo && quantidade.remaining <= 0);
    if (completa) push('ENTREGA_CONCLUIDA', 'Entrega concluída', fim);
    else push('ENTREGA_PARCIAL', 'Parte da carga foi entregue', fim);
  }
  push('COMPROVANTE_DISPONIBILIZADO', 'Comprovante disponibilizado', comprovanteEm);

  return marcos.sort((a, b) => new Date(a.em) - new Date(b.em));
}

// Carrega, para um conjunto de solicitações, a operação e os fretes que
// PROVADAMENTE vieram delas.
async function carregarOperacoes(supabase, requests) {
  const campaignIds = [...new Set(requests.map((r) => r.campaign_id).filter(Boolean))];
  if (!campaignIds.length) return { campaignsById: new Map(), freightsByCampaign: new Map() };

  const { data: campaigns, error } = await supabase
    .from('operation_campaigns')
    .select('id, status, planning_status, approved_at, updated_at, planned_start, planned_end')
    .in('id', campaignIds);
  throwDb(error, 'Não foi possível carregar suas operações.');
  const campaignsById = new Map((campaigns || []).map((c) => [c.id, c]));

  // Ponte de materialização: campanha → fretes reais.
  const { data: vinculos, error: vinculoError } = await supabase
    .from('campaign_trip_freights')
    .select('campaign_id, frete_id')
    .in('campaign_id', campaignIds);
  throwDb(vinculoError, 'Não foi possível carregar suas operações.');

  const freteIds = [...new Set((vinculos || []).map((v) => v.frete_id).filter(Boolean))];
  const freightsById = new Map();
  if (freteIds.length) {
    // Projeção MÍNIMA de frete. Nada financeiro, nada de motorista (§98/§99).
    const { data: fretes, error: freteError } = await supabase
      .from('fretes')
      .select('id, status, created_at, updated_at')
      .in('id', freteIds);
    throwDb(freteError, 'Não foi possível carregar suas operações.');
    for (const f of fretes || []) freightsById.set(f.id, f);
  }

  const freightsByCampaign = new Map();
  for (const v of vinculos || []) {
    const frete = freightsById.get(v.frete_id);
    if (!frete) continue;
    if (!freightsByCampaign.has(v.campaign_id)) freightsByCampaign.set(v.campaign_id, []);
    freightsByCampaign.get(v.campaign_id).push(frete);
  }

  // Quantidade canônica em LOTE (§137/§38): a autoridade de "quanto foi
  // efetivamente entregue e quanto ainda falta" é o serviço de progresso da
  // Campanha, não uma contagem de fretes feita aqui.
  const empresaIds = [...new Set(requests.map((r) => r.empresa_id).filter(Boolean))];
  const quantidadePorCampanha = new Map();
  for (const empresaId of empresaIds) {
    const idsDaEmpresa = requests
      .filter((r) => r.empresa_id === empresaId).map((r) => r.campaign_id).filter(Boolean);
    if (!idsDaEmpresa.length) continue;
    try {
      const lote = await getCampaignQuantitySummaryBatch(supabase, { empresaId, campaignIds: idsDaEmpresa });
      for (const [cid, resumo] of lote) quantidadePorCampanha.set(cid, resumo);
    } catch (err) {
      // Falha ao medir NÃO pode virar "entregue". Sem resumo, o derivador cai
      // no caminho conservador (§43).
      console.error('[shipperPortal:quantidade]', err?.message || err);
    }
  }

  return { campaignsById, freightsByCampaign, quantidadePorCampanha };
}

// Comprovantes COMPARTILHADOS por solicitação. A existência de um ePOD aprovado
// não basta: só conta o que a transportadora liberou explicitamente (§63/§71).
async function carregarComprovantesCompartilhados(supabase, { shipperOrgId, requestIds }) {
  if (!requestIds.length) return new Map();
  const { data, error } = await supabase
    .from('shipper_document_shares')
    .select('request_id, source_kind, shared_at')
    .eq('shipper_org_id', shipperOrgId)
    .eq('status', 'ACTIVE')
    .eq('source_kind', 'EPOD_EVIDENCIA')
    .in('request_id', requestIds);
  throwDb(error, 'Não foi possível carregar os comprovantes.');
  const porRequest = new Map();
  for (const s of data || []) {
    const atual = porRequest.get(s.request_id);
    if (!atual || new Date(s.shared_at) < new Date(atual)) porRequest.set(s.request_id, s.shared_at);
  }
  return porRequest;
}

// Lista de operações do embarcador (§52). Uma linha por solicitação aceita —
// que é a unidade que ele reconhece, não a Campanha nem o Frete.
async function listarMinhasOperacoes(supabase, { portalUserId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const { data, error } = await scopeRequestsQuery(
    supabase.from('shipper_transport_requests').select('*')
      .order('created_at', { ascending: false }).limit(100),
    context,
  );
  throwDb(error, 'Não foi possível carregar suas operações.');
  const requests = data || [];
  if (!requests.length) return { itens: [] };

  const { campaignsById, freightsByCampaign, quantidadePorCampanha } = await carregarOperacoes(supabase, requests);
  const comprovantes = await carregarComprovantesCompartilhados(supabase, {
    shipperOrgId: context.shipperOrgId,
    requestIds: requests.map((r) => r.id),
  });

  const { data: origens } = await supabase
    .from('shipper_transport_request_origins')
    .select('request_id, nome, quantidade, quantity_unit, ordem')
    .in('request_id', requests.map((r) => r.id));
  const origensPorRequest = new Map();
  for (const o of origens || []) {
    if (!origensPorRequest.has(o.request_id)) origensPorRequest.set(o.request_id, []);
    origensPorRequest.get(o.request_id).push(o);
  }

  const itens = requests.map((r) => {
    const campaign = r.campaign_id ? campaignsById.get(r.campaign_id) || null : null;
    const freights = campaign ? (freightsByCampaign.get(campaign.id) || []) : [];
    const comprovanteEm = comprovantes.get(r.id) || null;
    const statusExterno = derivarStatusExterno({
      request: r, campaign, freights, temComprovante: Boolean(comprovanteEm),
      quantidade: campaign ? quantidadePorCampanha.get(campaign.id) || null : null,
    });
    const lista = (origensPorRequest.get(r.id) || []).sort((a, b) => a.ordem - b.ordem);
    return {
      request_id: r.id,
      reference_code: r.reference_code,
      cargo_name: r.cargo_name,
      destination_name: r.destination_name,
      quantity_unit: r.quantity_unit,
      total_quantidade: lista.reduce((s, o) => s + Number(o.quantidade || 0), 0),
      origens: lista.map((o) => ({ nome: o.nome, quantidade: Number(o.quantidade) })),
      window_start: r.window_start,
      window_end: r.window_end,
      status_externo: statusExterno,
      status_rotulo: ROTULO[statusExterno],
      comprovante_disponivel: Boolean(comprovanteEm),
      proxima_acao: derivarProximaAcao(statusExterno, { requestId: r.id }),
      atualizado_em: r.updated_at,
    };
  });

  return { itens };
}

// Detalhe de UMA operação (§53). Conciso: resumo, situação, linha do tempo e o
// que exige ação. Documentos e comprovantes são carregados pela própria tela,
// pelo serviço de documentos, que aplica a fronteira de novo.
async function obterMinhaOperacao(supabase, { portalUserId, requestId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  const { data: request, error } = await scopeRequestsQuery(
    supabase.from('shipper_transport_requests').select('*').eq('id', requestId),
    context,
  ).maybeSingle();
  throwDb(error, 'Não foi possível carregar a operação.');
  if (!request) {
    // 404 deliberado para objeto fora da fronteira (§101): não confirmamos que
    // a solicitação existe para quem não pode vê-la.
    throw new ShipperPortalError('Operação não encontrada.', { status: 404, code: 'request_not_found' });
  }

  const { campaignsById, freightsByCampaign, quantidadePorCampanha } = await carregarOperacoes(supabase, [request]);
  const campaign = request.campaign_id ? campaignsById.get(request.campaign_id) || null : null;
  const freights = campaign ? (freightsByCampaign.get(campaign.id) || []) : [];
  const comprovantes = await carregarComprovantesCompartilhados(supabase, {
    shipperOrgId: context.shipperOrgId, requestIds: [request.id],
  });
  const comprovanteEm = comprovantes.get(request.id) || null;

  const { data: origens } = await supabase
    .from('shipper_transport_request_origins')
    .select('nome, quantidade, quantity_unit, ordem')
    .eq('request_id', request.id).order('ordem', { ascending: true });

  const quantidade = campaign ? quantidadePorCampanha.get(campaign.id) || null : null;
  const statusExterno = derivarStatusExterno({
    request, campaign, freights, temComprovante: Boolean(comprovanteEm), quantidade,
  });

  return {
    request_id: request.id,
    reference_code: request.reference_code,
    cargo_name: request.cargo_name,
    destination_name: request.destination_name,
    quantity_unit: request.quantity_unit,
    origens: (origens || []).map((o) => ({ nome: o.nome, quantidade: Number(o.quantidade) })),
    total_quantidade: (origens || []).reduce((s, o) => s + Number(o.quantidade || 0), 0),
    window_start: request.window_start,
    window_end: request.window_end,
    notes: request.notes,
    status_externo: statusExterno,
    status_rotulo: ROTULO[statusExterno],
    // Motivo só é exibido quando é uma mensagem que a transportadora escreveu
    // PARA o embarcador (ajuste ou recusa).
    motivo_transportadora: ['CHANGES_REQUESTED', 'REJECTED'].includes(request.status)
      ? request.decision_reason : null,
    versao_atual: request.current_submission_version ?? null,
    revisoes: request.revision_count ?? 0,
    // Existir comprovante NÃO significa operação concluída (§44): um
    // comprovante de uma viagem parcial é prova daquela viagem, não da entrega
    // inteira. Os dois campos são deliberadamente independentes.
    comprovante_disponivel: Boolean(comprovanteEm),
    // Progresso em quantidade, quando é possível medir com confiança. Só o que
    // o cliente entende: quanto da carga dele chegou e quanto ainda falta.
    // Nada de viagens, veículos ou plano — isso é planejamento interno.
    entrega: quantidade && quantidade.conclusivo ? {
      unidade: 'ton',
      solicitado: quantidade.target,
      entregue: quantidade.completed,
      restante: quantidade.remaining,
      concluida: quantidade.remaining <= 0 && quantidade.completed > 0,
    } : null,
    proxima_acao: derivarProximaAcao(statusExterno, { requestId: request.id }),
    linha_do_tempo: montarLinhaDoTempo({
      request, campaign, freights, comprovanteEm, quantidade,
    }),
    atualizado_em: request.updated_at,
  };
}

// Resumo para a home do portal (§79): o que precisa de atenção primeiro.
async function resumoInicio(supabase, { portalUserId }) {
  const { itens } = await listarMinhasOperacoes(supabase, { portalUserId });
  const precisamAtencao = itens.filter((i) => i.proxima_acao.tipo === 'REVISAR');
  const emAndamento = itens.filter((i) => [
    EXTERNAL_STATUS.EM_ANALISE, EXTERNAL_STATUS.ACEITA, EXTERNAL_STATUS.EM_PLANEJAMENTO,
    EXTERNAL_STATUS.AGENDADA, EXTERNAL_STATUS.EM_TRANSPORTE,
  ].includes(i.status_externo));
  const comComprovante = itens.filter((i) => i.comprovante_disponivel);

  return {
    precisam_atencao: precisamAtencao,
    em_andamento: emAndamento.slice(0, 10),
    comprovantes_disponiveis: comComprovante.slice(0, 10),
    recentes: itens.slice(0, 5),
    contadores: {
      precisam_atencao: precisamAtencao.length,
      em_andamento: emAndamento.length,
      comprovantes_disponiveis: comComprovante.length,
      total: itens.length,
    },
  };
}

module.exports = {
  EXTERNAL_STATUS,
  ROTULO,
  REQUEST_STATUS_TO_EXTERNAL,
  CAMPAIGN_STATUS_TO_EXTERNAL,
  derivarStatusExterno,
  derivarProximaAcao,
  montarLinhaDoTempo,
  listarMinhasOperacoes,
  obterMinhaOperacao,
  resumoInicio,
};

'use strict';

// partnerOpportunityService — compartilhar lacuna de capacidade e receber a
// resposta operacional do parceiro.
//
// A FONTE DA LACUNA. O prompt manda usar o `capacity_gap` já produzido pela
// stack determinística. A auditoria mostrou que o campo com esse nome
// (`campaignService.capacity_gap_quantity`) não serve: ele devolve a soma de
// TODAS as demandas quando existe qualquer exceção `HARD_CONSTRAINT` — não o
// residual — e soma `target_quantity` de unidades diferentes sem converter.
// Compartilhar isso seria pedir capacidade para um número inventado.
//
// A fonte usada aqui é `campaignProgressService`, que tem a fórmula canônica:
// residual = alvo − concluído (cancelado NÃO abate), unidade preservada, e
// `UNKNOWN` distinto de zero.
//
// SEM PREÇO. Não existe autoridade canônica de preço entre solicitante e
// parceiro (a mesma razão que mantém `PORTAL_QUOTE_PROPOSAL_V1B` deferida), e
// esta fatia não inventa uma.

const { PartnerNetworkError, traduzirErroDeRpc } = require('./partnerNetworkService');

// Campos que podem sair do tenant. Lista POSITIVA de propósito: o que não está
// aqui não vaza, e acrescentar algo exige decisão explícita — o inverso de um
// blocklist, que esquece o campo novo.
const CAMPOS_PUBLICOS_DA_OPORTUNIDADE = [
  'id', 'cargo_descricao', 'origem_resumo', 'destino_resumo',
  'quantidade', 'quantidade_unidade', 'janela_inicio', 'janela_fim',
  'restricoes', 'mensagem', 'prazo_resposta', 'estado', 'criado_em',
];

function erroDeBanco(error) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
      status: 503, code: 'partner_network_schema_missing',
    });
  }
  throw new PartnerNetworkError('Erro de banco na rede de parceiros.', {
    status: 500, code: 'partner_network_database_error', details: { db_code: error.code },
  });
}

// Projeção EXTERNA. O parceiro recebe o que precisa para decidir se consegue
// atender — e nada da procedência interna (campanha, versão do plano, demanda,
// autor), que fica persistida só para prova.
function projetarParaParceiro(oportunidade) {
  const saida = {};
  for (const campo of CAMPOS_PUBLICOS_DA_OPORTUNIDADE) {
    saida[campo] = oportunidade[campo] ?? null;
  }
  return saida;
}

// ── Compartilhar ───────────────────────────────────────────────────────────────

/**
 * Compartilha a lacuna residual de uma campanha com parceiros escolhidos.
 *
 * `residual` vem de `campaignProgressService` e chega já resolvido pelo
 * chamador — este serviço não recalcula regra de campanha, e é assim que a
 * fórmula canônica continua morando num lugar só.
 */
async function compartilharLacuna(supabase, {
  empresaId, actorUserId, campanha, residual, relationshipIds,
  prazoResposta = null, mensagem = null, clientRequestId = null,
}) {
  if (!Array.isArray(relationshipIds) || relationshipIds.length === 0) {
    throw new PartnerNetworkError('Escolha pelo menos um parceiro.', { code: 'parceiros_obrigatorios' });
  }

  // §30: desconhecido não é zero. Uma campanha cuja unidade não é comparável não
  // vira um pedido — vira uma recusa explicada.
  if (!residual || residual.known === false) {
    throw new PartnerNetworkError(
      'A lacuna desta campanha ainda não é conhecida. Aprove ou replaneje o plano antes de pedir capacidade.',
      { code: 'lacuna_desconhecida' },
    );
  }
  if (residual.compatible === false) {
    throw new PartnerNetworkError(
      'As demandas desta campanha usam unidades que não podem ser somadas. Ajuste a campanha antes de pedir capacidade.',
      { code: 'unidade_incompativel' },
    );
  }
  const quantidade = Number(residual.remaining);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new PartnerNetworkError('Esta campanha não tem lacuna de capacidade para compartilhar.', {
      code: 'sem_lacuna',
    });
  }
  // `SHARE_REQUIRES_APPROVED_PLAN_VERSION`: sem a versão do plano não há como
  // provar depois qual fonte gerou o residual.
  if (!campanha.approved_plan_version_id) {
    throw new PartnerNetworkError('Aprove o plano da campanha antes de pedir capacidade.', {
      status: 409, code: 'plano_nao_aprovado',
    });
  }

  // §10 + HIGH-04: oportunidade, destinatários e evento numa transação só. Antes
  // eram três operações soltas, e uma falha no meio deixava uma oportunidade sem
  // destinatário — um pedido que não chegou a ninguém, mas existe no banco.
  //
  // A RPC revalida empresa, campanha, plano aprovado e a titularidade dos
  // relacionamentos. Nada disso vem do cliente como autoridade.
  const { data, error } = await supabase.rpc('partner_network_share_gap', {
    p_empresa_id: empresaId,
    p_actor_user_id: actorUserId || null,
    p_campaign_id: campanha.id,
    p_plan_version_id: campanha.approved_plan_version_id,
    p_cargo: campanha.cargo_name || campanha.name || 'Carga',
    p_quantidade: quantidade,
    p_unidade: residual.unit,
    p_relationship_ids: relationshipIds,
    p_origem_resumo: residual.origem_resumo || null,
    p_destino_resumo: residual.destino_resumo || null,
    p_janela_inicio: campanha.planned_start || null,
    p_janela_fim: campanha.planned_end || null,
    p_mensagem: mensagem ? String(mensagem).trim() : null,
    p_prazo_resposta: prazoResposta || null,
    p_client_request_id: clientRequestId || null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  const destinatarios = await listarDestinatarios(supabase, {
    empresaId, opportunityId: linha.out_opportunity_id,
  });

  const { data: oportunidade } = await supabase
    .from('partner_opportunities').select('*').eq('id', linha.out_opportunity_id).maybeSingle();

  return { oportunidade, destinatarios, idempotent: linha.out_idempotent === true };
}
// ── Leitura interna ────────────────────────────────────────────────────────────

async function listarDestinatarios(supabase, { empresaId, opportunityId }) {
  const { data, error } = await supabase
    .from('partner_opportunity_recipients')
    .select('id, relationship_id, partner_organization_id, visualizado_em, criado_em, '
      + 'partner_organizations!inner(nome), partner_relationships!inner(apelido, status)')
    .eq('empresa_id', empresaId)
    .eq('opportunity_id', opportunityId)
    .order('criado_em');
  erroDeBanco(error);

  const destinatarios = data || [];
  if (destinatarios.length === 0) return [];

  // Todas as respostas em UMA consulta; a atual é a projeção da maior revisão.
  const { data: respostas, error: respErro } = await supabase
    .from('partner_opportunity_responses')
    .select('recipient_id, revisao, situacao, capacidade_quantidade, capacidade_unidade, '
      + 'disponivel_de, disponivel_ate, nota, criado_em')
    .eq('empresa_id', empresaId)
    .eq('opportunity_id', opportunityId)
    .order('revisao', { ascending: false });
  erroDeBanco(respErro);

  const atualPorDestinatario = new Map();
  const totalRevisoes = new Map();
  for (const r of respostas || []) {
    totalRevisoes.set(r.recipient_id, (totalRevisoes.get(r.recipient_id) || 0) + 1);
    if (!atualPorDestinatario.has(r.recipient_id)) atualPorDestinatario.set(r.recipient_id, r);
  }

  return destinatarios.map((d) => {
    const org = Array.isArray(d.partner_organizations) ? d.partner_organizations[0] : d.partner_organizations;
    const rel = Array.isArray(d.partner_relationships) ? d.partner_relationships[0] : d.partner_relationships;
    const atual = atualPorDestinatario.get(d.id) || null;
    return {
      id: d.id,
      parceiro: rel?.apelido || org?.nome || 'Parceiro',
      relacionamento_status: rel?.status || null,
      visualizado_em: d.visualizado_em,
      // Sem score, sem ranking, sem "melhor parceiro" (§52). A tela mostra o que
      // o parceiro declarou; a decisão é de quem lê.
      resposta: atual ? {
        situacao: atual.situacao,
        capacidade_quantidade: atual.capacidade_quantidade,
        capacidade_unidade: atual.capacidade_unidade,
        disponivel_de: atual.disponivel_de,
        disponivel_ate: atual.disponivel_ate,
        nota: atual.nota,
        revisao: atual.revisao,
        revisoes: totalRevisoes.get(d.id) || 0,
        respondido_em: atual.criado_em,
      } : null,
    };
  });
}

// ── Obsolescência (§31/§32) ────────────────────────────────────────────────────

/**
 * Marca as oportunidades CURRENT de uma campanha como `STALE_SOURCE`.
 *
 * O snapshot não é reescrito — só o estado muda. É isso que impede uma
 * oportunidade obsoleta de virar trabalho executável por acidente quando a
 * campanha é replanejada.
 */
async function marcarFonteObsoleta(supabase, { empresaId, campaignId, motivo = 'replan', actorUserId = null }) {
  const { data, error } = await supabase.rpc('partner_network_mark_source_stale', {
    p_empresa_id: empresaId,
    p_campaign_id: campaignId,
    p_motivo: motivo,
    p_actor_user_id: actorUserId || null,
  });
  if (error) throw traduzirErroDeRpc(error);
  return { afetadas: Number(data) || 0 };
}
/**
 * Retira um pedido da rede — mudança de estado e evento na MESMA transação.
 *
 * HIGH-11, mesmo defeito da transição de relacionamento: o `UPDATE` commitava
 * sozinho e o evento vinha numa segunda chamada. Uma falha no meio deixava o
 * pedido retirado sem registro de retirada — e retirar é justamente o ato que
 * encerra um compromisso já comunicado ao parceiro.
 */
async function retirarOportunidade(supabase, { empresaId, actorUserId, opportunityId, motivo = null }) {
  const { data, error } = await supabase.rpc('partner_network_withdraw_opportunity', {
    p_empresa_id: empresaId,
    p_actor_user_id: actorUserId || null,
    p_opportunity_id: opportunityId,
    p_motivo: motivo ? String(motivo).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Oportunidade não encontrada ou já encerrada.', {
      status: 404, code: 'partner_oportunidade_indisponivel',
    });
  }
  return { id: linha.out_opportunity_id, estado: linha.out_estado };
}

// ── Lado do parceiro ───────────────────────────────────────────────────────────

async function listarOportunidadesDoParceiro(supabase, { partnerOrganizationId }) {
  const { data, error } = await supabase
    .from('partner_opportunity_recipients')
    .select('id, opportunity_id, visualizado_em, criado_em, '
      + 'partner_relationships!inner(status), '
      + 'partner_opportunities!inner(*)')
    .eq('partner_organization_id', partnerOrganizationId)
    .order('criado_em', { ascending: false });
  erroDeBanco(error);

  const itens = [];
  for (const r of data || []) {
    const rel = Array.isArray(r.partner_relationships) ? r.partner_relationships[0] : r.partner_relationships;
    // Revogação corta o acesso IMEDIATAMENTE, inclusive à leitura (§16).
    if (!rel || rel.status !== 'ACTIVE') continue;
    const oport = Array.isArray(r.partner_opportunities) ? r.partner_opportunities[0] : r.partner_opportunities;
    if (!oport) continue;
    itens.push({
      recipient_id: r.id,
      visualizado_em: r.visualizado_em,
      ...projetarParaParceiro(oport),
    });
  }
  return { itens };
}

/**
 * Resolve o destinatário a partir da identidade EXTERNA.
 *
 * Nunca aceita `empresa_id` do cliente: a empresa é lida da linha encontrada.
 * E o parceiro só encontra a própria linha — é isto que impede um destinatário
 * de enumerar os outros convidados da mesma oportunidade (§17).
 */
async function resolverDestinatarioDoParceiro(supabase, { partnerOrganizationId, recipientId }) {
  const { data, error } = await supabase
    .from('partner_opportunity_recipients')
    .select('id, empresa_id, opportunity_id, partner_organization_id, relationship_id, '
      + 'partner_relationships!inner(status), partner_opportunities!inner(*)')
    .eq('id', recipientId)
    .eq('partner_organization_id', partnerOrganizationId)
    .maybeSingle();
  erroDeBanco(error);
  if (!data) throw new PartnerNetworkError('Oportunidade não encontrada.', { status: 404, code: 'oportunidade_nao_encontrada' });

  const rel = Array.isArray(data.partner_relationships) ? data.partner_relationships[0] : data.partner_relationships;
  if (!rel || rel.status !== 'ACTIVE') {
    throw new PartnerNetworkError('Seu acesso a esta oportunidade foi encerrado.', { status: 403, code: 'relacionamento_inativo' });
  }
  const oport = Array.isArray(data.partner_opportunities) ? data.partner_opportunities[0] : data.partner_opportunities;
  return { destinatario: data, oportunidade: oport };
}

// ── Resposta ───────────────────────────────────────────────────────────────────

/**
 * Registra a resposta do parceiro.
 *
 * HIGH-04: a decisão inteira acontece numa transação no banco. A versão anterior
 * resolvia o destinatário, conferia relacionamento, oportunidade e prazo, lia a
 * última revisão e só então inseria — e entre a conferência e a escrita cabia uma
 * revogação, um replanejamento ou o vencimento do prazo. Era TOCTOU, e o efeito
 * não era teórico: uma resposta gravada depois de o acesso já ter sido cortado.
 *
 * A RPC recebe a MENOR identidade possível — o destinatário e a identidade
 * externa. Empresa, oportunidade, relacionamento e campanha são derivados no
 * banco; o cliente não influencia nenhum deles.
 */
async function responder(supabase, {
  partnerOrganizationId, partnerUserId = null, usuarioId = null, origem = 'partner_portal',
  recipientId, situacao, capacidadeQuantidade = null, capacidadeUnidade = null,
  disponivelDe = null, disponivelAte = null, nota = null, clientRequestId = null,
}) {
  if (!recipientId || !partnerOrganizationId) {
    throw new PartnerNetworkError('Oportunidade não encontrada.', { status: 404, code: 'oportunidade_nao_encontrada' });
  }

  const { data, error } = await supabase.rpc('partner_network_submit_response', {
    p_recipient_id: recipientId,
    p_partner_organization_id: partnerOrganizationId,
    p_partner_user_id: partnerUserId,
    p_situacao: situacao,
    p_capacidade: situacao === 'DECLINED' ? null : Number(capacidadeQuantidade),
    p_unidade: situacao === 'DECLINED' ? null : (capacidadeUnidade ? String(capacidadeUnidade).trim() : null),
    p_disponivel_de: disponivelDe || null,
    p_disponivel_ate: disponivelAte || null,
    p_nota: nota ? String(nota).trim() : null,
    p_client_request_id: clientRequestId || null,
    p_origem: origem,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Não foi possível registrar sua resposta. Tente novamente.', {
      status: 500, code: 'partner_response_contract_broken',
    });
  }

  // HIGH-13 — `SOURCE_STALE` é RESULTADO, não exceção.
  //
  // A RPC precisava PERSISTIR a auto-correção (oportunidade vira `STALE_SOURCE`,
  // evento registrado) e ainda assim recusar a resposta. Com `RAISE EXCEPTION` as
  // duas coisas se anulavam: o RAISE aborta a transação e leva junto as escritas
  // que acabaram de acontecer. Por isso ela devolve um resultado estruturado e
  // commita — e é AQUI que ele vira a recusa que o parceiro vê.
  //
  // 409 e não 400: o pedido do parceiro estava correto; o que mudou foi o estado
  // do outro lado.
  if (linha.out_result === 'SOURCE_STALE') {
    throw new PartnerNetworkError(
      'A campanha foi replanejada. Aguarde um novo pedido da transportadora.',
      { status: 409, code: 'partner_response_fonte_obsoleta' },
    );
  }

  return {
    resposta: { id: linha.out_response_id, revisao: linha.out_revisao, situacao },
    idempotent: linha.out_idempotent === true,
  };
}
module.exports = {
  CAMPOS_PUBLICOS_DA_OPORTUNIDADE,
  projetarParaParceiro,
  compartilharLacuna,
  listarDestinatarios,
  marcarFonteObsoleta,
  retirarOportunidade,
  listarOportunidadesDoParceiro,
  resolverDestinatarioDoParceiro,
  responder,
};

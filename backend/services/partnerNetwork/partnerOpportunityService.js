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

const { PartnerNetworkError, registrarEvento } = require('./partnerNetworkService');

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

  // Idempotência (§37): repetir o mesmo pedido converge para a oportunidade que
  // já existe em vez de criar uma segunda.
  if (clientRequestId) {
    const { data: existente } = await supabase
      .from('partner_opportunities')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (existente) {
      const destinatarios = await listarDestinatarios(supabase, { empresaId, opportunityId: existente.id });
      return { oportunidade: existente, destinatarios, idempotent: true };
    }
  }

  // Só relacionamentos ATIVOS desta empresa. Filtrar no servidor é o que impede
  // um id de parceiro revogado — ou de outra empresa — entrar pelo corpo.
  const { data: ativos, error: ativosErro } = await supabase
    .from('partner_relationships')
    .select('id, partner_organization_id')
    .eq('empresa_id', empresaId)
    .eq('status', 'ACTIVE')
    .in('id', relationshipIds);
  erroDeBanco(ativosErro);

  if (!ativos || ativos.length === 0) {
    throw new PartnerNetworkError('Nenhum dos parceiros escolhidos está ativo na sua rede.', {
      status: 403, code: 'parceiros_indisponiveis',
    });
  }

  const { data: oportunidade, error: oportErro } = await supabase
    .from('partner_opportunities')
    .insert({
      empresa_id: empresaId,
      campaign_id: campanha.id,
      plan_version_id: campanha.approved_plan_version_id || null,
      cargo_descricao: campanha.cargo_name || campanha.name || 'Carga',
      origem_resumo: residual.origem_resumo || null,
      destino_resumo: residual.destino_resumo || null,
      quantidade,
      quantidade_unidade: residual.unit,
      janela_inicio: campanha.planned_start || null,
      janela_fim: campanha.planned_end || null,
      mensagem: mensagem ? String(mensagem).trim() : null,
      prazo_resposta: prazoResposta || null,
      criado_por: actorUserId || null,
      client_request_id: clientRequestId || null,
    })
    .select('*')
    .single();
  erroDeBanco(oportErro);

  const { error: recErro } = await supabase
    .from('partner_opportunity_recipients')
    .insert(ativos.map((rel) => ({
      opportunity_id: oportunidade.id,
      empresa_id: empresaId,
      relationship_id: rel.id,
      partner_organization_id: rel.partner_organization_id,
    })));
  erroDeBanco(recErro);

  await registrarEvento(supabase, {
    empresaId, entityType: 'opportunity', entityId: oportunidade.id,
    action: 'opportunity_shared', actorUserId,
    metadata: {
      campaign_id: campanha.id,
      destinatarios: ativos.length,
      quantidade,
      unidade: residual.unit,
    },
  });

  const destinatarios = await listarDestinatarios(supabase, { empresaId, opportunityId: oportunidade.id });
  return { oportunidade, destinatarios, idempotent: false };
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
  const { data, error } = await supabase
    .from('partner_opportunities')
    .update({ estado: 'STALE_SOURCE', estado_motivo: motivo, estado_em: new Date().toISOString() })
    .eq('empresa_id', empresaId)
    .eq('campaign_id', campaignId)
    .eq('estado', 'CURRENT')
    .select('id');
  erroDeBanco(error);

  for (const o of data || []) {
    await registrarEvento(supabase, {
      empresaId, entityType: 'opportunity', entityId: o.id,
      action: 'opportunity_stale_source', actorUserId, reason: motivo,
    });
  }
  return { afetadas: (data || []).length };
}

async function retirarOportunidade(supabase, { empresaId, actorUserId, opportunityId, motivo = null }) {
  const { data, error } = await supabase
    .from('partner_opportunities')
    .update({ estado: 'WITHDRAWN', estado_motivo: motivo, estado_em: new Date().toISOString() })
    .eq('id', opportunityId)
    .eq('empresa_id', empresaId)
    .in('estado', ['CURRENT', 'STALE_SOURCE'])
    .select('id')
    .maybeSingle();
  erroDeBanco(error);
  if (!data) throw new PartnerNetworkError('Oportunidade não encontrada ou já encerrada.', { status: 404, code: 'oportunidade_indisponivel' });

  await registrarEvento(supabase, {
    empresaId, entityType: 'opportunity', entityId: opportunityId,
    action: 'opportunity_withdrawn', actorUserId, reason: motivo,
  });
  return { id: data.id, estado: 'WITHDRAWN' };
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

async function responder(supabase, {
  partnerOrganizationId, partnerUserId = null, usuarioId = null, origem = 'partner_portal',
  recipientId, situacao, capacidadeQuantidade = null, capacidadeUnidade = null,
  disponivelDe = null, disponivelAte = null, nota = null, clientRequestId = null,
}) {
  const { destinatario, oportunidade } = await resolverDestinatarioDoParceiro(supabase, {
    partnerOrganizationId, recipientId,
  });

  // §32: revalidar a fonte ANTES de aceitar. Uma oportunidade obsoleta ou
  // retirada não pode receber resposta nova como se ainda valesse.
  if (oportunidade.estado !== 'CURRENT') {
    throw new PartnerNetworkError(
      oportunidade.estado === 'WITHDRAWN'
        ? 'Esta oportunidade foi retirada pela transportadora.'
        : 'Esta oportunidade mudou e não aceita mais respostas. Aguarde um novo pedido.',
      { status: 409, code: 'oportunidade_nao_current', details: { estado: oportunidade.estado } },
    );
  }
  if (oportunidade.prazo_resposta && new Date(oportunidade.prazo_resposta).getTime() < Date.now()) {
    throw new PartnerNetworkError('O prazo de resposta desta oportunidade encerrou.', {
      status: 409, code: 'prazo_encerrado',
    });
  }

  const situacoes = new Set(['AVAILABLE', 'PARTIALLY_AVAILABLE', 'DECLINED']);
  if (!situacoes.has(situacao)) {
    throw new PartnerNetworkError('Resposta inválida.', { code: 'situacao_invalida' });
  }

  let quantidade = null;
  let unidade = null;
  if (situacao !== 'DECLINED') {
    quantidade = Number(capacidadeQuantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new PartnerNetworkError('Informe a capacidade que você consegue atender.', { code: 'capacidade_invalida' });
    }
    if (quantidade > Number(oportunidade.quantidade)) {
      throw new PartnerNetworkError(
        `A capacidade informada é maior que a necessidade compartilhada (${oportunidade.quantidade} ${oportunidade.quantidade_unidade}).`,
        { code: 'capacidade_acima_da_lacuna' },
      );
    }
    // §30: a resposta usa a unidade EXATA da oportunidade. Não há conversão
    // inventada aqui — nem entre kg e ton.
    unidade = String(capacidadeUnidade || '').trim();
    if (unidade !== oportunidade.quantidade_unidade) {
      throw new PartnerNetworkError(
        `Responda na mesma unidade do pedido (${oportunidade.quantidade_unidade}).`,
        { code: 'unidade_divergente' },
      );
    }
  }

  // Idempotência da resposta: o mesmo envio repetido devolve a revisão já criada.
  if (clientRequestId) {
    const { data: jaExiste } = await supabase
      .from('partner_opportunity_responses')
      .select('*')
      .eq('recipient_id', recipientId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (jaExiste) return { resposta: jaExiste, idempotent: true };
  }

  // Append-only: a próxima revisão nasce da maior existente. O banco garante a
  // unicidade de (recipient_id, revisao), então duas revisões simultâneas não
  // podem colidir em silêncio.
  const { data: ultima } = await supabase
    .from('partner_opportunity_responses')
    .select('revisao')
    .eq('recipient_id', recipientId)
    .order('revisao', { ascending: false })
    .limit(1)
    .maybeSingle();
  const revisao = (ultima?.revisao || 0) + 1;

  const { data: resposta, error } = await supabase
    .from('partner_opportunity_responses')
    .insert({
      recipient_id: recipientId,
      empresa_id: destinatario.empresa_id,
      opportunity_id: destinatario.opportunity_id,
      revisao,
      situacao,
      capacidade_quantidade: quantidade,
      capacidade_unidade: unidade,
      disponivel_de: disponivelDe || null,
      disponivel_ate: disponivelAte || null,
      nota: nota ? String(nota).trim() : null,
      respondido_por_partner_user_id: partnerUserId,
      respondido_por_usuario_id: usuarioId,
      origem,
      client_request_id: clientRequestId || null,
    })
    .select('*')
    .single();
  erroDeBanco(error);

  await registrarEvento(supabase, {
    empresaId: destinatario.empresa_id,
    entityType: 'response', entityId: resposta.id,
    action: situacao === 'DECLINED' ? 'response_declined' : (revisao > 1 ? 'response_revised' : 'response_submitted'),
    actorPartnerUserId: partnerUserId,
    actorUserId: usuarioId,
    source: origem,
    metadata: { revisao, situacao },
  });

  return { resposta, idempotent: false };
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

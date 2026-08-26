'use strict';

// partnerNetworkService — a rede privada de parceiros (E3.6A).
//
// Três responsabilidades, e nenhuma delas é comercial:
//   1. relacionamentos privados (convite, ativação, suspensão, revogação);
//   2. compartilhar uma lacuna de capacidade REAL de campanha;
//   3. registrar a resposta operacional do parceiro.
//
// O que este serviço deliberadamente NÃO faz: preço, adjudicação, vencedor,
// alocação de viagem, comissão. Não há autoridade canônica de preço entre
// solicitante e parceiro — a mesma razão que mantém `PORTAL_QUOTE_PROPOSAL_V1B`
// deferida. Inventar um número aqui seria criar um valor sem dono.

const crypto = require('node:crypto');

const TOKEN_BYTES = 32;
const CONVITE_TTL_DIAS = 7;

class PartnerNetworkError extends Error {
  constructor(message, { status = 400, code = 'partner_network_error', details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

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

// Token de convite: alta entropia, guardado só como hash. O valor puro existe
// uma única vez, na resposta da criação — nunca é persistido, logado nem
// colocado em metadata de evento.
function gerarTokenConvite() {
  const valor = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { valor, hash: hashDoToken(valor) };
}

function hashDoToken(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest('hex');
}

// ── Eventos ────────────────────────────────────────────────────────────────────
//
// HIGH-07: a auditoria das mutações de AUTORIDADE não é best-effort.
//
// A versão anterior engolia o erro "para não derrubar a ação". Isso é errado
// justamente onde o evento é parte da prova: uma revogação que acontece sem
// registro deixa a empresa sem como mostrar quando cortou o acesso. Por isso as
// mutações críticas gravam evento DENTRO da mesma transação, nas RPCs — e esta
// função sobrou apenas para os registros periféricos, onde falhar em auditar
// realmente não muda o fato ocorrido.
async function registrarEvento(supabase, {
  empresaId, entityType, entityId, action,
  actorUserId = null, actorPartnerUserId = null, source = 'web',
  reason = null, metadata = {},
}) {
  const { error } = await supabase.from('partner_network_events').insert({
    empresa_id: empresaId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor_user_id: actorUserId,
    actor_partner_user_id: actorPartnerUserId,
    source,
    reason,
    // Montado com campos explícitos pelo chamador — nunca por spread de payload,
    // para que token, hash e senha não tenham como entrar aqui.
    metadata,
  });
  if (error) {
    throw new PartnerNetworkError('Não foi possível registrar o evento de auditoria.', {
      status: 500, code: 'partner_network_audit_failed',
    });
  }
}
// ── Relacionamentos ────────────────────────────────────────────────────────────

async function listarParceiros(supabase, { empresaId }) {
  const { data, error } = await supabase
    .from('partner_relationships')
    .select('id, status, apelido, criado_em, ativado_em, revogado_em, partner_organization_id, '
      + 'partner_organizations!inner(id, nome, documento, linked_empresa_id)')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false });
  erroDeBanco(error);

  const relacionamentos = data || [];
  const ids = relacionamentos.map((r) => r.id);

  // Última atividade relevante por relacionamento, numa consulta agregada — não
  // uma por linha (§71: nada de N+1 na lista da rede).
  const atividadePorRelacionamento = new Map();
  if (ids.length) {
    const { data: recs } = await supabase
      .from('partner_opportunity_recipients')
      .select('relationship_id, criado_em')
      .in('relationship_id', ids)
      .order('criado_em', { ascending: false });
    for (const r of recs || []) {
      if (!atividadePorRelacionamento.has(r.relationship_id)) {
        atividadePorRelacionamento.set(r.relationship_id, r.criado_em);
      }
    }
  }

  return {
    itens: relacionamentos.map((r) => {
      const org = Array.isArray(r.partner_organizations) ? r.partner_organizations[0] : r.partner_organizations;
      return {
        id: r.id,
        nome: r.apelido || org?.nome || 'Parceiro',
        documento: org?.documento || null,
        // Lite vs Cliente é DERIVADO do vínculo — sem coluna paralela que possa
        // divergir do fato.
        tipo: org?.linked_empresa_id ? 'CLIENTE' : 'LITE',
        status: r.status,
        criado_em: r.criado_em,
        ativado_em: r.ativado_em,
        revogado_em: r.revogado_em,
        ultima_atividade_em: atividadePorRelacionamento.get(r.id) || null,
      };
    }),
  };
}

async function convidarParceiro(supabase, { empresaId, actorUserId, nome, email, documento = null, apelido = null }) {
  const nomeLimpo = String(nome || '').trim();
  const emailLimpo = String(email || '').trim().toLowerCase();
  if (!nomeLimpo) throw new PartnerNetworkError('Informe o nome do parceiro.', { code: 'partner_nome_obrigatorio' });
  if (!emailLimpo || !emailLimpo.includes('@')) {
    throw new PartnerNetworkError('Informe um e-mail válido para o convite.', { code: 'partner_email_invalido' });
  }

  const token = gerarTokenConvite();
  const expiraEm = new Date(Date.now() + CONVITE_TTL_DIAS * 24 * 60 * 60 * 1000).toISOString();

  // HIGH-06: organização + relacionamento + convite + evento numa transação só.
  // Antes eram quatro inserts soltos: uma falha no terceiro deixava organização e
  // relacionamento órfãos, e o parceiro aparecia na lista sem nunca ter sido
  // convidado de fato.
  const { data, error } = await supabase.rpc('partner_network_create_invitation', {
    p_empresa_id: empresaId,
    p_actor_user_id: actorUserId || null,
    p_nome: nomeLimpo,
    p_email: emailLimpo,
    p_token_hash: token.hash,
    p_expires_at: expiraEm,
    p_documento: documento ? String(documento).trim() : null,
    p_apelido: apelido ? String(apelido).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  return {
    relationship_id: linha.out_relationship_id,
    partner_organization_id: linha.out_partner_organization_id,
    nome: nomeLimpo,
    convite: {
      id: linha.out_invitation_id,
      expires_at: expiraEm,
      // Entrega V1 = MANUAL_LINK (§19). O valor puro do token existe aqui, uma
      // vez — no banco só há o hash.
      token: token.valor,
      entrega: 'MANUAL_LINK',
    },
  };
}
// Máquina de estados do relacionamento (§8), explícita para não haver transição
// contraditória por PATCH.
//
//   INVITED   → ACTIVE     (somente por ativação válida do convite)
//   ACTIVE    → SUSPENDED | REVOKED
//   SUSPENDED → ACTIVE     (ação interna deliberada) | REVOKED
//   REVOKED   → terminal nesta fatia
//
// REVOKED ser terminal é decisão de segurança, não limitação: reativar por PATCH
// significaria que revogar o acesso pode ser desfeito sem passar por convite e
// sem prova de que o outro lado ainda controla a conta. Reconvite pós-revogação
// fica registrado como possibilidade futura — com fluxo próprio, não com um
// UPDATE de status.
const TRANSICOES_PERMITIDAS = Object.freeze({
  INVITED: ['REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
});

const ACAO_POR_STATUS = Object.freeze({
  ACTIVE: 'relationship_activated',
  SUSPENDED: 'relationship_suspended',
  REVOKED: 'relationship_revoked',
});

async function alterarStatusDoParceiro(supabase, { empresaId, actorUserId, relationshipId, novoStatus, motivo = null }) {
  if (!ACAO_POR_STATUS[novoStatus]) {
    throw new PartnerNetworkError('Situação de parceiro inválida.', { code: 'partner_status_invalido' });
  }

  const { data: atual, error: erroAtual } = await supabase
    .from('partner_relationships')
    .select('id, status')
    .eq('id', relationshipId)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  erroDeBanco(erroAtual);
  if (!atual) throw new PartnerNetworkError('Parceiro não encontrado.', { status: 404, code: 'partner_nao_encontrado' });

  if (atual.status === novoStatus) {
    return { id: atual.id, status: atual.status, inalterado: true };
  }

  const permitidas = TRANSICOES_PERMITIDAS[atual.status] || [];
  if (!permitidas.includes(novoStatus)) {
    throw new PartnerNetworkError(
      atual.status === 'REVOKED'
        ? 'Este parceiro foi revogado. Convide-o novamente para restabelecer o acesso.'
        : 'Esta mudança de situação não é permitida.',
      { status: 409, code: 'partner_transicao_invalida', details: { de: atual.status, para: novoStatus } },
    );
  }

  const agora = new Date().toISOString();
  const patch = { status: novoStatus, atualizado_em: agora };
  if (novoStatus === 'ACTIVE') patch.ativado_em = agora;
  if (novoStatus === 'REVOKED') {
    patch.revogado_em = agora;
    patch.revogado_por = actorUserId || null;
    patch.revogado_motivo = motivo ? String(motivo).trim() : null;
  }

  // A transição condicional é a decisão: o `eq(status)` faz duas mudanças
  // simultâneas serializarem em vez de a última sobrescrever a primeira.
  const { data, error } = await supabase
    .from('partner_relationships')
    .update(patch)
    .eq('id', relationshipId)
    .eq('empresa_id', empresaId)
    .eq('status', atual.status)
    .select('id, status')
    .maybeSingle();
  erroDeBanco(error);
  if (!data) {
    throw new PartnerNetworkError('A situação deste parceiro mudou. Recarregue a lista.', {
      status: 409, code: 'partner_status_concorrente',
    });
  }

  await registrarEvento(supabase, {
    empresaId, entityType: 'relationship', entityId: relationshipId,
    action: ACAO_POR_STATUS[novoStatus], actorUserId, reason: motivo || null,
  });

  return { id: data.id, status: data.status };
}
// Tradução dos erros das RPCs para mensagens de produto. Cada `RAISE EXCEPTION`
// da migration tem um nome estável; sem este mapa a pessoa veria o texto cru do
// Postgres.
const MENSAGEM_DE_RPC = {
  partner_invite_indisponivel: ['Este convite não é mais válido. Peça um novo à transportadora.', 410],
  partner_invite_inconsistente: ['Convite inconsistente. Peça um novo à transportadora.', 409],
  partner_relationship_revogado: ['Seu acesso foi encerrado pela transportadora.', 403],
  partner_relationship_suspenso: ['Seu acesso está suspenso. Fale com a transportadora.', 403],
  partner_invite_dados_invalidos: ['Dados do convite inválidos.', 400],
  partner_invite_token_invalido: ['Convite inválido.', 400],
  partner_activate_dados_invalidos: ['Convite inválido.', 400],
  partner_response_destinatario_invalido: ['Oportunidade não encontrada.', 404],
  partner_response_relacionamento_inativo: ['Seu acesso a esta oportunidade foi encerrado.', 403],
  partner_response_oportunidade_nao_current: ['Esta oportunidade mudou e não aceita mais respostas.', 409],
  partner_response_fonte_obsoleta: ['A campanha foi replanejada. Aguarde um novo pedido da transportadora.', 409],
  partner_response_prazo_encerrado: ['O prazo de resposta desta oportunidade encerrou.', 409],
  partner_response_situacao_invalida: ['Resposta inválida.', 400],
  partner_response_capacidade_invalida: ['Informe a capacidade que você consegue atender.', 400],
  partner_response_capacidade_acima_da_lacuna: ['A capacidade informada é maior que a necessidade compartilhada.', 400],
  partner_response_unidade_divergente: ['Responda na mesma unidade do pedido.', 400],
  partner_share_plano_nao_aprovado: ['O plano desta campanha não está mais aprovado. Replaneje antes de pedir capacidade.', 409],
  partner_share_sem_parceiro_ativo: ['Nenhum dos parceiros escolhidos está ativo na sua rede.', 403],
  partner_share_sem_destinatarios: ['Escolha pelo menos um parceiro.', 400],
  partner_share_quantidade_invalida: ['Quantidade inválida para compartilhar.', 400],
  partner_share_dados_invalidos: ['Dados insuficientes para compartilhar.', 400],
};

function traduzirErroDeRpc(error) {
  const bruto = String(error?.message || '');
  for (const [codigo, [mensagem, status]] of Object.entries(MENSAGEM_DE_RPC)) {
    if (bruto.includes(codigo)) return new PartnerNetworkError(mensagem, { status, code: codigo });
  }
  if (error?.code === '42883' || error?.code === '42P01') {
    return new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
      status: 503, code: 'partner_network_schema_missing',
    });
  }
  return new PartnerNetworkError('Não foi possível concluir a operação.', {
    status: 500, code: 'partner_network_rpc_error',
  });
}

/**
 * E-mail para o qual o convite foi emitido.
 *
 * É a autoridade de "quem foi convidado": a ativação prova a posse DESSA conta,
 * não de uma que a pessoa digite na hora. Aceitar um e-mail livre no corpo
 * permitiria ativar o convite de outra pessoa com a própria conta.
 *
 * Leitura deliberadamente magra — só o e-mail, e sem revelar se o convite está
 * pendente, expirado ou já usado: essa distinção só interessa a quem sonda tokens.
 */
async function emailDoConvite(supabase, { token }) {
  const { data, error } = await supabase
    .from('partner_invitations')
    .select('email')
    .eq('token_hash', hashDoToken(token))
    .maybeSingle();
  erroDeBanco(error);
  if (!data) {
    throw new PartnerNetworkError('Este convite não é mais válido. Peça um novo à transportadora.', {
      status: 410, code: 'convite_indisponivel',
    });
  }
  return data.email;
}

/**
 * Ativa o convite DEPOIS de a identidade Auth ter sido provada.
 *
 * A ordem importa e é o coração do HIGH-01/HIGH-06: quem prova a posse da conta
 * é o chamador, ANTES de chegar aqui. Se a senha estiver errada, esta função nem
 * é invocada — e o convite continua pendente, disponível para a tentativa certa.
 * Queimar o convite numa senha errada seria transformar erro de digitação em
 * perda de acesso.
 */
async function ativarConvite(supabase, { token, authUserId, nome = null }) {
  if (!token) throw new PartnerNetworkError('Convite inválido.', { status: 400, code: 'convite_invalido' });
  if (!authUserId) {
    throw new PartnerNetworkError('Não foi possível confirmar sua identidade.', { status: 401, code: 'identidade_ausente' });
  }

  const { data, error } = await supabase.rpc('partner_network_activate_invitation', {
    p_token_hash: hashDoToken(token),
    p_auth_user_id: authUserId,
    p_nome: nome ? String(nome).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Este convite não é mais válido. Peça um novo à transportadora.', {
      status: 410, code: 'convite_indisponivel',
    });
  }
  return {
    partner_user_id: linha.out_partner_user_id,
    partner_organization_id: linha.partner_organization_id,
    email: linha.out_email,
    relationship_id: linha.relationship_id,
  };
}
module.exports = {
  PartnerNetworkError,
  emailDoConvite,
  TRANSICOES_PERMITIDAS,
  traduzirErroDeRpc,
  gerarTokenConvite,
  hashDoToken,
  registrarEvento,
  listarParceiros,
  convidarParceiro,
  alterarStatusDoParceiro,
  ativarConvite,
  CONVITE_TTL_DIAS,
};

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
async function registrarEvento(supabase, {
  empresaId, entityType, entityId, action,
  actorUserId = null, actorPartnerUserId = null, source = 'web',
  reason = null, metadata = {},
}) {
  // Best-effort deliberado: auditoria não pode derrubar a ação que ela observa.
  // O que NÃO pode acontecer é o token entrar aqui — por isso metadata é sempre
  // montado pelo chamador com campos explícitos, nunca por spread de payload.
  try {
    await supabase.from('partner_network_events').insert({
      empresa_id: empresaId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_user_id: actorUserId,
      actor_partner_user_id: actorPartnerUserId,
      source,
      reason,
      metadata,
    });
  } catch { /* auditoria não bloqueia operação */ }
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

  // §14: nenhuma vinculação automática a empresa existente por nome, domínio,
  // telefone ou semelhança de documento. A organização nasce Lite; virar Cliente
  // é ato explícito e verificado, fora desta fatia.
  const { data: org, error: orgErro } = await supabase
    .from('partner_organizations')
    .insert({
      nome: nomeLimpo,
      documento: documento ? String(documento).trim() : null,
      criado_por_empresa_id: empresaId,
      criado_por_usuario_id: actorUserId || null,
    })
    .select('id, nome')
    .single();
  erroDeBanco(orgErro);

  const { data: rel, error: relErro } = await supabase
    .from('partner_relationships')
    .insert({
      empresa_id: empresaId,
      partner_organization_id: org.id,
      status: 'INVITED',
      apelido: apelido ? String(apelido).trim() : null,
      criado_por: actorUserId || null,
    })
    .select('id, status')
    .single();
  erroDeBanco(relErro);

  const token = gerarTokenConvite();
  const expiraEm = new Date(Date.now() + CONVITE_TTL_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: convite, error: convErro } = await supabase
    .from('partner_invitations')
    .insert({
      relationship_id: rel.id,
      empresa_id: empresaId,
      email: emailLimpo,
      token_hash: token.hash,
      expires_at: expiraEm,
      criado_por: actorUserId || null,
    })
    .select('id, expires_at')
    .single();
  erroDeBanco(convErro);

  await registrarEvento(supabase, {
    empresaId, entityType: 'relationship', entityId: rel.id,
    action: 'relationship_invited', actorUserId,
    // Sem token, sem hash de token. O e-mail é o mínimo para auditar o convite.
    metadata: { partner_organization_id: org.id, email: emailLimpo },
  });

  return {
    relationship_id: rel.id,
    partner_organization_id: org.id,
    nome: org.nome,
    convite: {
      id: convite.id,
      expires_at: convite.expires_at,
      // Entrega V1 = MANUAL_LINK (§19). Não há provedor de e-mail nesta frente,
      // e o valor puro do token aparece exatamente aqui, uma vez.
      token: token.valor,
      entrega: 'MANUAL_LINK',
    },
  };
}

async function alterarStatusDoParceiro(supabase, { empresaId, actorUserId, relationshipId, novoStatus, motivo = null }) {
  const permitidos = { ACTIVE: 'relationship_activated', SUSPENDED: 'relationship_suspended', REVOKED: 'relationship_revoked' };
  if (!permitidos[novoStatus]) {
    throw new PartnerNetworkError('Situação de parceiro inválida.', { code: 'partner_status_invalido' });
  }

  const patch = { status: novoStatus, atualizado_em: new Date().toISOString() };
  if (novoStatus === 'ACTIVE') patch.ativado_em = new Date().toISOString();
  if (novoStatus === 'REVOKED') {
    patch.revogado_em = new Date().toISOString();
    patch.revogado_por = actorUserId || null;
    patch.revogado_motivo = motivo ? String(motivo).trim() : null;
  }

  // Tenant no WHERE, não em checagem prévia: um id de outra empresa simplesmente
  // não encontra linha.
  const { data, error } = await supabase
    .from('partner_relationships')
    .update(patch)
    .eq('id', relationshipId)
    .eq('empresa_id', empresaId)
    .select('id, status')
    .maybeSingle();
  erroDeBanco(error);
  if (!data) throw new PartnerNetworkError('Parceiro não encontrado.', { status: 404, code: 'partner_nao_encontrado' });

  await registrarEvento(supabase, {
    empresaId, entityType: 'relationship', entityId: relationshipId,
    action: permitidos[novoStatus], actorUserId, reason: motivo || null,
  });

  return { id: data.id, status: data.status };
}

// ── Ativação do convite ────────────────────────────────────────────────────────

async function ativarConvite(supabase, { token, nome = null }) {
  if (!token) throw new PartnerNetworkError('Convite inválido.', { status: 400, code: 'convite_invalido' });
  const hash = hashDoToken(token);

  // Consumo ATÔMICO: a transição condicional é a decisão. Um `select` seguido de
  // `update` deixaria dois cliques simultâneos ativarem o mesmo convite.
  const agora = new Date().toISOString();
  const { data: convite, error } = await supabase
    .from('partner_invitations')
    .update({ status: 'ACEITO', aceito_em: agora })
    .eq('token_hash', hash)
    .eq('status', 'PENDENTE')
    .gt('expires_at', agora)
    .select('id, relationship_id, empresa_id, email')
    .maybeSingle();
  erroDeBanco(error);

  if (!convite) {
    // Deliberadamente não distingue "inexistente" de "já usado" ou "expirado":
    // a diferença só serve para quem está sondando tokens.
    throw new PartnerNetworkError('Este convite não é mais válido. Peça um novo à transportadora.', {
      status: 410, code: 'convite_indisponivel',
    });
  }

  const { data: rel, error: relErro } = await supabase
    .from('partner_relationships')
    .select('id, empresa_id, partner_organization_id, status')
    .eq('id', convite.relationship_id)
    .maybeSingle();
  erroDeBanco(relErro);
  if (!rel) throw new PartnerNetworkError('Convite inconsistente.', { status: 409, code: 'convite_inconsistente' });

  const { data: usuario, error: usuarioErro } = await supabase
    .from('partner_portal_users')
    .upsert({
      partner_organization_id: rel.partner_organization_id,
      email: convite.email,
      nome: nome ? String(nome).trim() : null,
    }, { onConflict: 'partner_organization_id,email' })
    .select('id, email, partner_organization_id')
    .single();
  erroDeBanco(usuarioErro);

  await supabase.from('partner_invitations')
    .update({ aceito_por_partner_user_id: usuario.id })
    .eq('id', convite.id);

  if (rel.status === 'INVITED') {
    await supabase.from('partner_relationships')
      .update({ status: 'ACTIVE', ativado_em: agora, atualizado_em: agora })
      .eq('id', rel.id);
    await registrarEvento(supabase, {
      empresaId: rel.empresa_id, entityType: 'relationship', entityId: rel.id,
      action: 'relationship_activated', actorPartnerUserId: usuario.id, source: 'partner_portal',
    });
  }

  return {
    partner_user_id: usuario.id,
    partner_organization_id: usuario.partner_organization_id,
    email: usuario.email,
  };
}

module.exports = {
  PartnerNetworkError,
  gerarTokenConvite,
  hashDoToken,
  registrarEvento,
  listarParceiros,
  convidarParceiro,
  alterarStatusDoParceiro,
  ativarConvite,
  CONVITE_TTL_DIAS,
};

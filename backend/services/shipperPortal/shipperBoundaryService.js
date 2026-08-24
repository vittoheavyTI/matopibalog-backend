'use strict';

// shipperBoundaryService — a AUTORIDADE ÚNICA da fronteira externa do Portal do
// Embarcador. Toda leitura/escrita feita em nome de um usuário de portal passa
// obrigatoriamente por aqui.
//
// Por que este serviço existe separado: a auditoria (§10) mostrou que o
// isolamento interno do produto é por `empresa_id` (middlewares/tenant.js). Isso
// é suficiente para separar transportadora A de transportadora B, mas é
// INSUFICIENTE para o portal, porque dois embarcadores diferentes (X e Y) da
// MESMA transportadora A compartilhariam o mesmo empresa_id. A fronteira do
// portal é, portanto, uma dimensão adicional: (usuário externo → organização
// embarcadora → relacionamento ATIVO com aquela transportadora → objeto pertence
// a esse relacionamento).
//
// Nunca confie em empresa_id sozinho aqui (§49/§50).

class ShipperPortalError extends Error {
  constructor(message, { status = 400, code = 'shipper_portal_error', details = null } = {}) {
    super(message);
    this.name = 'ShipperPortalError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function throwDb(error, fallback) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new ShipperPortalError('O Portal do Embarcador ainda não está disponível nesta instalação.', {
      status: 503, code: 'shipper_portal_schema_missing',
    });
  }
  throw new ShipperPortalError(fallback || 'Não foi possível concluir a operação agora. Tente novamente em instantes.', {
    status: 500, code: 'shipper_portal_database_error', details: { db_code: error.code },
  });
}

// Carrega o contexto externo do usuário do portal. Sem contexto válido, NADA é
// autorizado — não existe "acesso parcial" nem fallback para tenant.
async function loadPortalContext(supabase, { portalUserId }) {
  if (!portalUserId) {
    throw new ShipperPortalError('Sessão do portal inválida.', { status: 401, code: 'portal_session_invalid' });
  }
  const { data: user, error } = await supabase
    .from('shipper_portal_users')
    .select('id, shipper_org_id, email, nome, status')
    .eq('id', portalUserId)
    .maybeSingle();
  throwDb(error, 'Não foi possível carregar seu acesso ao portal.');
  if (!user) {
    throw new ShipperPortalError('Acesso ao portal não encontrado.', { status: 403, code: 'portal_user_not_found' });
  }
  if (user.status !== 'active') {
    throw new ShipperPortalError('Seu acesso ao portal está desativado. Fale com a transportadora.', {
      status: 403, code: 'portal_user_disabled',
    });
  }

  const { data: relationships, error: relError } = await supabase
    .from('shipper_carrier_relationships')
    .select('id, empresa_id, shipper_org_id, status')
    .eq('shipper_org_id', user.shipper_org_id)
    .eq('status', 'ACTIVE');
  throwDb(relError, 'Não foi possível carregar suas transportadoras.');

  const active = relationships || [];
  if (!active.length) {
    throw new ShipperPortalError('Você ainda não tem acesso liberado a nenhuma transportadora.', {
      status: 403, code: 'no_active_relationship',
    });
  }

  return {
    portalUser: user,
    shipperOrgId: user.shipper_org_id,
    relationships: active,
    relationshipIds: active.map((r) => r.id),
    empresaIds: [...new Set(active.map((r) => r.empresa_id))],
  };
}

// Resolve UM relacionamento específico (quando o portal opera sobre uma
// transportadora escolhida). Revogado ou de outro embarcador → negado.
function requireRelationship(context, relationshipId) {
  if (!relationshipId) {
    if (context.relationships.length === 1) return context.relationships[0];
    throw new ShipperPortalError('Selecione a transportadora para esta solicitação.', {
      status: 400, code: 'relationship_required',
    });
  }
  const found = context.relationships.find((r) => r.id === relationshipId);
  if (!found) {
    // 404 deliberado (§80): não confirmamos a existência de um relacionamento
    // fora da fronteira do usuário — enumerar UUIDs não deve revelar nada.
    throw new ShipperPortalError('Transportadora não encontrada para o seu acesso.', {
      status: 404, code: 'relationship_not_found',
    });
  }
  return found;
}

// Filtro de fronteira aplicado SEMPRE no servidor (§78). Devolve o builder já
// restrito ao embarcador — nunca buscamos tudo para filtrar depois no cliente.
function scopeRequestsQuery(query, context) {
  return query
    .eq('shipper_org_id', context.shipperOrgId)
    .in('relationship_id', context.relationshipIds);
}

// Confirma que UM objeto específico pertence à fronteira do usuário. Usado
// antes de qualquer leitura/ação sobre um recurso identificado por id.
async function requireOwnedRequest(supabase, context, requestId) {
  const { data, error } = await scopeRequestsQuery(
    supabase.from('shipper_transport_requests').select('*').eq('id', requestId),
    context,
  ).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!data) {
    throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  }
  return data;
}

module.exports = {
  ShipperPortalError,
  loadPortalContext,
  requireRelationship,
  scopeRequestsQuery,
  requireOwnedRequest,
  throwDb,
};

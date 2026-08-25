'use strict';

// shipperManagementService — o lado da TRANSPORTADORA gerindo quem, lá fora,
// tem acesso ao portal: cadastrar o embarcador, abrir o relacionamento,
// convidar contatos e revogar acesso.
//
// Tudo aqui roda sob a autoridade interna canônica (entitlement + permissão +
// tenant), nunca sob identidade de portal. E toda escrita amarra `empresa_id` a
// partir de `req.empresa_id` — nunca do corpo da requisição.

const { ShipperPortalError, throwDb } = require('./shipperBoundaryService');
const { hashToken, gerarTokenConvite, normalizarEmail } = require('./shipperIdentityService');

const CONVITE_VALIDADE_DIAS = 7;

function texto(value, campo, { obrigatorio = true, max = 200 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (!obrigatorio) return null;
    throw new ShipperPortalError(`Informe ${campo}.`, { status: 400, code: 'missing_field', details: { campo } });
  }
  return s.slice(0, max);
}

function userId(user) {
  return user?.uid || user?.id || null;
}

// Projeção do relacionamento para a tela interna. Não expõe nada do embarcador
// além do que a transportadora precisa para reconhecê-lo.
function projetarRelacionamento(rel, org, contagens = {}) {
  return {
    relationship_id: rel.id,
    status: rel.status,
    created_at: rel.created_at,
    revoked_at: rel.revoked_at,
    revocation_reason: rel.revocation_reason,
    embarcador: {
      id: org?.id || rel.shipper_org_id,
      nome: org?.nome || null,
      documento: org?.documento || null,
      status: org?.status || null,
    },
    convites_pendentes: contagens.convites_pendentes || 0,
    usuarios_ativos: contagens.usuarios_ativos || 0,
  };
}

async function listarEmbarcadores(supabase, { empresaId }) {
  const { data: rels, error } = await supabase
    .from('shipper_carrier_relationships')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(200);
  throwDb(error, 'Não foi possível carregar os embarcadores.');

  const lista = rels || [];
  if (!lista.length) return { itens: [] };

  const orgIds = [...new Set(lista.map((r) => r.shipper_org_id))];
  const { data: orgs, error: orgError } = await supabase
    .from('shipper_organizations').select('id, nome, documento, status').in('id', orgIds);
  throwDb(orgError, 'Não foi possível carregar os embarcadores.');
  const orgById = new Map((orgs || []).map((o) => [o.id, o]));

  // Contagens úteis para a tela decidir o que mostrar (convite pendente é a
  // diferença entre "convidei" e "ele já entrou").
  const { data: convites, error: convError } = await supabase
    .from('shipper_portal_invitations')
    .select('relationship_id, status')
    .eq('empresa_id', empresaId)
    .eq('status', 'PENDING');
  throwDb(convError, 'Não foi possível carregar os convites.');
  const pendentesPorRel = new Map();
  for (const c of convites || []) {
    pendentesPorRel.set(c.relationship_id, (pendentesPorRel.get(c.relationship_id) || 0) + 1);
  }

  const { data: usuarios, error: usuError } = await supabase
    .from('shipper_portal_users').select('shipper_org_id, status').in('shipper_org_id', orgIds);
  throwDb(usuError, 'Não foi possível carregar os usuários do portal.');
  const ativosPorOrg = new Map();
  for (const u of usuarios || []) {
    if (u.status !== 'active') continue;
    ativosPorOrg.set(u.shipper_org_id, (ativosPorOrg.get(u.shipper_org_id) || 0) + 1);
  }

  return {
    itens: lista.map((r) => projetarRelacionamento(r, orgById.get(r.shipper_org_id), {
      convites_pendentes: pendentesPorRel.get(r.id) || 0,
      usuarios_ativos: ativosPorOrg.get(r.shipper_org_id) || 0,
    })),
  };
}

// Cadastra o embarcador e abre o relacionamento numa única ação da tela.
//
// DECISÃO DE FRONTEIRA (não simplificar isto): a busca por embarcador existente
// é feita SOMENTE entre os que já têm relacionamento com ESTA transportadora.
//
// A tentação natural seria procurar `shipper_organizations` pelo nome e reusar a
// organização existente — afinal o schema permite que um embarcador se relacione
// com várias transportadoras (§22). Mas a busca global cria dois vazamentos
// reais entre transportadoras que não se conhecem:
//
//   1. a transportadora A, digitando um nome, descobriria que aquele embarcador
//      existe e quantos contatos ativos ele tem (cadastrados pela B);
//   2. os usuários de portal cadastrados pela B passariam a enxergar a A
//      automaticamente — porque o acesso é por organização, e `loadPortalContext`
//      devolve TODOS os relacionamentos ativos da organização.
//
// Ou seja: bastaria acertar o nome para se enxertar na base de contatos de outra
// transportadora. Unificar organizações entre transportadoras é uma decisão de
// produto que ninguém tomou (é Partner Network, fora de escopo). Até lá, cada
// transportadora cadastra o seu — o schema continua suportando N relacionamentos
// para quando essa decisão existir.
async function cadastrarEmbarcador(supabase, { empresaId, user, body = {} }) {
  const nome = texto(body.nome, 'o nome do embarcador');
  const documento = texto(body.documento, 'o documento', { obrigatorio: false, max: 32 });

  // Só reusa organização que JÁ está ligada a esta transportadora.
  const { data: relsDaEmpresa, error: relsError } = await supabase
    .from('shipper_carrier_relationships')
    .select('id, status, shipper_org_id')
    .eq('empresa_id', empresaId);
  throwDb(relsError, 'Não foi possível verificar os embarcadores da empresa.');

  const orgIdsDaEmpresa = (relsDaEmpresa || []).map((r) => r.shipper_org_id);
  let orgId = null;
  if (orgIdsDaEmpresa.length) {
    const { data: minhasOrgs, error: orgsError } = await supabase
      .from('shipper_organizations').select('id, nome').in('id', orgIdsDaEmpresa);
    throwDb(orgsError, 'Não foi possível verificar os embarcadores da empresa.');
    const alvo = nome.toLowerCase();
    orgId = (minhasOrgs || []).find((o) => String(o.nome || '').toLowerCase() === alvo)?.id || null;
  }

  if (!orgId) {
    const { data: criada, error: criaError } = await supabase
      .from('shipper_organizations').insert({ nome, documento }).select('id').single();
    throwDb(criaError, 'Não foi possível cadastrar o embarcador.');
    orgId = criada.id;
  }

  // Relacionamento já existente com esta transportadora: reativa em vez de
  // criar um segundo (o par é único no banco).
  const relExistente = (relsDaEmpresa || []).find((r) => r.shipper_org_id === orgId) || null;

  if (relExistente) {
    if (relExistente.status === 'ACTIVE') {
      return { relationship_id: relExistente.id, shipper_org_id: orgId, criado_agora: false, reativado: false };
    }
    const { data: reativado, error: reativaError } = await supabase
      .from('shipper_carrier_relationships')
      .update({ status: 'ACTIVE', revoked_at: null, revoked_by: null, revocation_reason: null })
      .eq('id', relExistente.id).select('id').single();
    throwDb(reativaError, 'Não foi possível reativar o acesso do embarcador.');
    return { relationship_id: reativado.id, shipper_org_id: orgId, criado_agora: false, reativado: true };
  }

  const { data: rel, error: relError } = await supabase
    .from('shipper_carrier_relationships')
    .insert({ empresa_id: empresaId, shipper_org_id: orgId, created_by: userId(user) })
    .select('id').single();
  throwDb(relError, 'Não foi possível liberar o acesso do embarcador.');
  return { relationship_id: rel.id, shipper_org_id: orgId, criado_agora: true, reativado: false };
}

// Revogar corta o acesso nas requisições seguintes sem apagar identidade nenhuma
// (§24). O histórico da operação continua íntegro.
async function revogarAcesso(supabase, { empresaId, user, relationshipId, motivo }) {
  const razao = texto(motivo, 'o motivo da revogação', { obrigatorio: false, max: 500 });
  const { data, error } = await supabase
    .from('shipper_carrier_relationships')
    .update({
      status: 'REVOKED',
      revoked_at: new Date().toISOString(),
      revoked_by: userId(user),
      revocation_reason: razao,
    })
    .eq('id', relationshipId).eq('empresa_id', empresaId).eq('status', 'ACTIVE')
    .select('id, status').maybeSingle();
  throwDb(error, 'Não foi possível revogar o acesso.');
  if (!data) {
    throw new ShipperPortalError('Este acesso não está ativo ou não foi encontrado.', {
      status: 404, code: 'relationship_not_found',
    });
  }

  // Convites ainda pendentes daquele relacionamento deixam de valer: manter um
  // token válido depois de revogar o acesso seria uma porta aberta.
  await supabase
    .from('shipper_portal_invitations')
    .update({ status: 'REVOKED' })
    .eq('relationship_id', relationshipId).eq('status', 'PENDING');

  return { relationship_id: data.id, status: data.status };
}

async function reativarAcesso(supabase, { empresaId, relationshipId }) {
  const { data, error } = await supabase
    .from('shipper_carrier_relationships')
    .update({ status: 'ACTIVE', revoked_at: null, revoked_by: null, revocation_reason: null })
    .eq('id', relationshipId).eq('empresa_id', empresaId).eq('status', 'REVOKED')
    .select('id, status').maybeSingle();
  throwDb(error, 'Não foi possível reativar o acesso.');
  if (!data) {
    throw new ShipperPortalError('Este acesso não está revogado ou não foi encontrado.', {
      status: 404, code: 'relationship_not_found',
    });
  }
  return { relationship_id: data.id, status: data.status };
}

// Cria o convite. O token em claro é devolvido UMA vez, aqui, porque é o
// instante em que ele precisa ser entregue — depois disso só existe o hash
// (§18). Não há e-mail transacional de convite nesta fatia: o link é entregue
// ao usuário interno autorizado, que o repassa. Fingir "e-mail enviado" sem
// provedor configurado seria mentir para o operador (§17).
async function convidarContato(supabase, { empresaId, user, body = {} }) {
  const relationshipId = texto(body.relationship_id, 'o embarcador');
  const email = normalizarEmail(texto(body.email, 'o e-mail do contato', { max: 160 }));
  const nomeConvidado = texto(body.nome, 'o nome do contato', { obrigatorio: false, max: 120 });

  const { data: rel, error: relError } = await supabase
    .from('shipper_carrier_relationships').select('*')
    .eq('id', relationshipId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(relError, 'Não foi possível carregar o embarcador.');
  if (!rel) {
    throw new ShipperPortalError('Embarcador não encontrado.', { status: 404, code: 'relationship_not_found' });
  }
  if (rel.status !== 'ACTIVE') {
    throw new ShipperPortalError('Reative o acesso deste embarcador antes de convidar contatos.', {
      status: 409, code: 'relationship_not_active',
    });
  }

  // Reconvite substitui o convite pendente anterior em vez de acumular tokens
  // válidos em paralelo (a unicidade parcial no banco garante isso de qualquer
  // forma; aqui apenas tornamos a intenção explícita).
  await supabase
    .from('shipper_portal_invitations')
    .update({ status: 'REVOKED' })
    .eq('relationship_id', relationshipId).eq('status', 'PENDING')
    .ilike('email', email);

  const tokenBruto = gerarTokenConvite();
  const expiraEm = new Date(Date.now() + CONVITE_VALIDADE_DIAS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('shipper_portal_invitations')
    .insert({
      empresa_id: empresaId,
      shipper_org_id: rel.shipper_org_id,
      relationship_id: relationshipId,
      email,
      nome_convidado: nomeConvidado,
      token_hash: hashToken(tokenBruto),
      expires_at: expiraEm,
      created_by: userId(user),
    })
    .select('id, email, expires_at, status').single();
  throwDb(error, 'Não foi possível criar o convite.');

  return {
    convite: { id: data.id, email: data.email, expires_at: data.expires_at, status: data.status },
    // Único momento em que o token existe fora do hash. Nunca logar.
    token: tokenBruto,
    entrega: 'MANUAL_LINK',
  };
}

async function listarConvites(supabase, { empresaId, relationshipId = null }) {
  let query = supabase
    .from('shipper_portal_invitations')
    .select('id, relationship_id, email, nome_convidado, status, expires_at, accepted_at, created_at')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (relationshipId) query = query.eq('relationship_id', relationshipId);
  const { data, error } = await query;
  throwDb(error, 'Não foi possível carregar os convites.');
  // token_hash jamais entra na projeção.
  return { itens: data || [] };
}

async function revogarConvite(supabase, { empresaId, conviteId }) {
  const { data, error } = await supabase
    .from('shipper_portal_invitations')
    .update({ status: 'REVOKED' })
    .eq('id', conviteId).eq('empresa_id', empresaId).eq('status', 'PENDING')
    .select('id, status').maybeSingle();
  throwDb(error, 'Não foi possível revogar o convite.');
  if (!data) {
    throw new ShipperPortalError('Este convite não está pendente ou não foi encontrado.', {
      status: 404, code: 'invitation_not_found',
    });
  }
  return data;
}

module.exports = {
  listarEmbarcadores,
  cadastrarEmbarcador,
  revogarAcesso,
  reativarAcesso,
  convidarContato,
  listarConvites,
  revogarConvite,
  CONVITE_VALIDADE_DIAS,
};

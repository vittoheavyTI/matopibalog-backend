'use strict';

// assignableTemplates — quais PERFIS DE ACESSO um ator pode atribuir a outra pessoa.
//
// O PROBLEMA QUE ISTO RESOLVE. A arquitetura de permissões (P2, migration 072) já
// tem tudo: templates por empresa, overrides, resolver único. Mas a única forma de
// listar templates era `GET /permissions/templates`, protegida por
// `permissions.manage` — a capability de EDITAR o que um perfil significa. Quem
// tinha apenas `users.manage` (montar a equipe) não conseguia nem ver os perfis
// para escolher um. Na prática, criar usuário virou "criar administrador", e a
// empresa não conseguia montar time.
//
// Ler um perfil para ATRIBUIR e editar o que ele SIGNIFICA são autoridades
// diferentes. Este módulo é a primeira; `permissions.manage` continua sendo a
// segunda, intocada.
//
// A REGRA DE NÃO-ESCALAÇÃO (§14/§15). Separar as autoridades abre uma porta:
// alguém com `users.manage` poderia se promover criando um administrador. A regra
// é de contenção, e é decidida SEMPRE no servidor:
//
//   um ator só pode atribuir um perfil cujas permissões efetivas estejam
//   CONTIDAS nas dele.
//
// Assim um gerente com `users.manage` cria operadores e outros gerentes iguais ou
// menores, e nunca um administrador. Já um administrador de verdade — que tem
// todas as permissões — continua podendo delegar administração (§16), porque o
// conjunto dele contém o do template Administrador.
//
// Super-admin é break-glass da plataforma e não passa por contenção, mas continua
// obrigado a escolher a empresa-alvo explicitamente.

const { loadEffectivePermissions, carregarEntitlements } = require('./permissionResolver');
const { TEMPLATE_META, UI_ENABLED_TEMPLATE_KEYS, TEMPLATE_KEYS, PERMISSION_BY_KEY } = require('./permissionRegistry');

// Perfis que descrevem gente de FORA da operação interna da transportadora. Não
// aparecem como opção ao montar a equipe: motorista tem fluxo próprio (exige linha
// em `motoristas`), e embarcador é identidade externa do Portal, que nem sequer
// vive em `usuarios`.
const NAO_ATRIBUIVEIS_NA_EQUIPE = new Set([TEMPLATE_KEYS.MOTORISTA, TEMPLATE_KEYS.EMBARCADOR]);

// TEAM-FUNC-02 — POR QUE O ENTITLEMENT ENTRA AQUI.
//
// A contenção comparava as permissões CRUAS do template alvo (lidas de
// `permission_template_permissions`) contra o EFETIVO do ator. São grandezas
// diferentes: o efetivo passa por um gate de entitlement que nega, antes de
// qualquer template, toda chave cuja funcionalidade a empresa não contratou.
//
// O resultado era absurdo e reproduzível. Na Empresa Alfa, cujo plano não inclui
// `operation_campaign` nem `estrutura_operacional`, o efetivo do Administrador não
// tem `campaign.*` — mas o template Administrador, cru, tem. Logo `contido()` dava
// falso e **o administrador não conseguia atribuir nem o próprio perfil**. Sobrava
// só Financeiro, o único baseline sem capacidade gated; numa empresa com plano
// menor, sobrava zero. Quanto menor o plano, menos time a empresa conseguia
// montar — o oposto do que faz sentido.
//
// A correção é comparar efetivo com efetivo. Uma capacidade que a empresa não
// contratou não é "acesso a mais" que o ator estaria concedendo: ela não existe
// para ninguém naquela empresa, e não pode pesar na contenção.
function filtrarPorEntitlement(permissoes, entitlements) {
  const efetivas = new Set();
  for (const key of permissoes) {
    const meta = PERMISSION_BY_KEY[key];
    const exige = meta && meta.entitlementCodigo;
    if (exige && entitlements[exige] !== true) continue;
    efetivas.add(key);
  }
  return efetivas;
}

/**
 * Permissões efetivas de um template, resolvidas do banco.
 * Retorna Set das chaves permitidas.
 */
async function permissoesDoTemplate(supabase, templateId) {
  const { data, error } = await supabase
    .from('permission_template_permissions')
    .select('permission_key, allowed')
    .eq('template_id', templateId);
  if (error) throw error;
  const set = new Set();
  for (const row of data || []) if (row.allowed) set.add(row.permission_key);
  return set;
}

/**
 * O ator pode delegar este conjunto de permissões?
 *
 * Contenção pura: tudo que o template concede precisa existir no efetivo do ator.
 * Nada de lista de exceções — uma regra que dependa de enumerar perfis
 * "perigosos" erra silenciosamente quando alguém cria um perfil novo.
 */
function contido(permissoesDoAlvo, efetivoDoAtor) {
  for (const key of permissoesDoAlvo) {
    if (efetivoDoAtor[key] !== true) return false;
  }
  return true;
}

/**
 * Lista os perfis de acesso que ESTE ator pode atribuir dentro DESTA empresa.
 *
 * Devolve já filtrado: o cliente nunca recebe a lista completa para decidir
 * segurança por conta própria (§18). O que não pode ser atribuído simplesmente
 * não chega.
 *
 * @returns {{itens: Array<{id,stable_key,nome,descricao,resumo:string[],editavel:boolean}>}}
 */
async function listarPerfisAtribuiveis(supabase, { actor, empresaId }) {
  if (!empresaId) return { itens: [] };

  const { data: templates, error } = await supabase
    .from('permission_templates')
    .select('id, stable_key, display_name, descricao, is_system_baseline, editable')
    .eq('empresa_id', empresaId)
    .order('stable_key');
  if (error) throw error;

  const isSuperAdmin = actor?.is_super_admin === true;
  const efetivoDoAtor = isSuperAdmin ? null : await loadEffectivePermissions(supabase, actor);
  // Os entitlements da EMPRESA-ALVO, não os do ator: é a empresa que contrata
  // funcionalidade, e é nela que o perfil vai valer.
  const entitlements = isSuperAdmin ? null : await carregarEntitlements(supabase, { empresaId, user: actor });

  const itens = [];
  for (const t of templates || []) {
    if (NAO_ATRIBUIVEIS_NA_EQUIPE.has(t.stable_key)) continue;

    // Baselines "preparados" mas ainda não habilitados na UI ficam de fora, a menos
    // que a empresa os tenha customizado (aí são perfis reais que ela usa).
    const baselineOculto = t.is_system_baseline
      && !UI_ENABLED_TEMPLATE_KEYS.includes(t.stable_key);
    if (baselineOculto) continue;

    const permissoes = await permissoesDoTemplate(supabase, t.id);
    const efetivasDoPerfil = isSuperAdmin
      ? permissoes
      : filtrarPorEntitlement(permissoes, entitlements);
    if (!isSuperAdmin && !contido(efetivasDoPerfil, efetivoDoAtor)) continue;

    const meta = TEMPLATE_META[t.stable_key] || {};
    itens.push({
      id: t.id,
      stable_key: t.stable_key,
      nome: t.display_name || meta.display_name || t.stable_key,
      descricao: t.descricao || meta.descricao || null,
      // O resumo descreve o que a pessoa VAI conseguir fazer nesta empresa —
      // prometer uma capacidade não contratada seria mentir na tela.
      resumo: resumirCapacidades(isSuperAdmin ? permissoes : efetivasDoPerfil),
      editavel: t.editable !== false,
    });
  }

  return { itens };
}

/**
 * Autoriza (ou nega) a atribuição de UM template específico.
 *
 * Chamado antes de gravar. Não confia no que a tela mandou: reconfere a empresa do
 * template e a contenção. Um `template_id` de outra empresa é tratado como
 * inexistente — enumerar UUID não deve revelar nada.
 *
 * @returns {{ok:true, template:object} | {ok:false, status:number, message:string}}
 */
async function autorizarAtribuicao(supabase, { actor, empresaId, templateId }) {
  if (!templateId) {
    return { ok: false, status: 400, message: 'Escolha o perfil de acesso do usuário.' };
  }

  const { data: template, error } = await supabase
    .from('permission_templates')
    .select('id, stable_key, display_name, empresa_id')
    .eq('id', templateId)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!template) {
    return { ok: false, status: 404, message: 'Perfil de acesso não encontrado.' };
  }

  if (NAO_ATRIBUIVEIS_NA_EQUIPE.has(template.stable_key)) {
    return {
      ok: false,
      status: 400,
      message: template.stable_key === TEMPLATE_KEYS.MOTORISTA
        ? 'Motoristas são cadastrados pela tela de Motoristas.'
        : 'Este perfil não pode ser atribuído a um usuário interno.',
    };
  }

  if (actor?.is_super_admin === true) return { ok: true, template };

  const [permissoes, efetivoDoAtor, entitlements] = await Promise.all([
    permissoesDoTemplate(supabase, template.id),
    loadEffectivePermissions(supabase, actor),
    carregarEntitlements(supabase, { empresaId, user: actor }),
  ]);

  // Mesmo critério da listagem — filtro de tela e regra de gravação não podem
  // divergir, senão a lista oferece o que a gravação recusa.
  if (!contido(filtrarPorEntitlement(permissoes, entitlements), efetivoDoAtor)) {
    // Deliberadamente explica o motivo sem listar as permissões que faltam: a
    // pessoa precisa saber que o caminho é pedir a um administrador, não
    // descobrir quais chaves tentar.
    return {
      ok: false,
      status: 403,
      message: 'Você não pode conceder um perfil com mais acesso do que o seu. '
        + 'Peça a um administrador para criar este usuário.',
    };
  }

  return { ok: true, template };
}

// Resumo curto e humano do que o perfil permite (§51). Não é a matriz de
// permissões — é a frase que responde "o que essa pessoa vai poder fazer?".
const RESUMO_POR_AREA = [
  { rotulo: 'Gerenciar usuários e permissões', chaves: ['users.manage', 'permissions.manage'] },
  { rotulo: 'Financeiro', chaves: ['finance.operational.view', 'reports.financial.view'] },
  { rotulo: 'Fretes e operação', chaves: ['freight.manage', 'campaign.create'] },
  { rotulo: 'Motoristas', chaves: ['drivers.manage'] },
  { rotulo: 'Frota', chaves: ['fleet.manage', 'fleet.view'] },
  { rotulo: 'Relatórios', chaves: ['reports.view', 'reports.financial.view'] },
  { rotulo: 'Pedidos de embarcadores', chaves: ['shipper_portal.requests.review'] },
];

function resumirCapacidades(permissoes) {
  const resumo = [];
  for (const area of RESUMO_POR_AREA) {
    if (area.chaves.some((k) => permissoes.has(k))) resumo.push(area.rotulo);
  }
  return resumo;
}

module.exports = {
  listarPerfisAtribuiveis,
  autorizarAtribuicao,
  permissoesDoTemplate,
  NAO_ATRIBUIVEIS_NA_EQUIPE,
};

// permissionRegistry.js — Catálogo CANÔNICO de permissões V9 (P2).
//
// Fonte única de verdade das capability-keys. Evita strings mágicas espalhadas e
// sinônimos (finance.view vs financeiro.ver). O resolver, o middleware, o seed da
// migration 072 e a UI consomem ESTE catálogo.
//
// Princípios (decisões congeladas P2):
//   * PERMISSION  ≠ ENTITLEMENT ≠ SCOPE ≠ ROLE_TEMPLATE ≠ OVERRIDE ≠ VISIBILITY.
//   * DEFAULT_DENY: ausência de definição = negado.
//   * Só entram chaves USADAS/agendadas de forma clara (não "encher catálogo").
//   * Chaves são estáveis (compat futura Entra ID/App Roles via stable_key do template).
//
// Compat legada: algumas chaves têm um `legacyMenuKey` (as 5 booleans de
// `usuarios.permissoes`) para o dual-read/migration preservar comportamento.

'use strict';

// Categorias canônicas (Section 16 do prompt P2).
const CATEGORIES = Object.freeze({
  company: 'company',
  users: 'users',
  permissions: 'permissions',
  freight: 'freight',
  launch: 'launch',
  documents: 'documents',
  drivers: 'drivers',
  fleet: 'fleet',
  campaign: 'campaign',
  finance_operational: 'finance.operational',
  finance_saas: 'finance.saas',
  reports: 'reports',
  governance: 'governance', // estrutura/ERP/SSO — já existem como PERMISSOES_PORTAL
  partner_network: 'partner_network', // E3.6: rede privada de parceiros
});

/**
 * Registry: cada permissão tem
 *   key           — capability-key canônica (imutável)
 *   category      — agrupador para a UI
 *   label         — rótulo pt-BR para a UI
 *   scoped        — se a ação é verificada contra escopo operacional (067)
 *   governance    — se é crítica para governança (último admin)
 *   legacyMenuKey — (opcional) boolean legado de usuarios.permissoes correspondente
 *   entitlementCodigo — (opcional) exige entitlement técnico da empresa (069/060)
 */
const PERMISSIONS = Object.freeze([
  // ── COMPANY ───────────────────────────────────────────────────────────────
  { key: 'company.settings.view', category: CATEGORIES.company, label: 'Ver configurações da empresa', scoped: false, legacyMenuKey: 'configuracoes' },
  { key: 'company.settings.manage', category: CATEGORIES.company, label: 'Gerenciar configurações da empresa', scoped: false },

  // ── USERS ─────────────────────────────────────────────────────────────────
  { key: 'users.view', category: CATEGORIES.users, label: 'Ver usuários', scoped: false, legacyMenuKey: 'usuarios' },
  { key: 'users.manage', category: CATEGORIES.users, label: 'Criar/editar/desativar usuários', scoped: false, governance: true },

  // ── PERMISSIONS (templates/overrides) ──────────────────────────────────────
  { key: 'permissions.manage', category: CATEGORIES.permissions, label: 'Gerenciar perfis e permissões', scoped: false, governance: true },

  // ── FREIGHT ────────────────────────────────────────────────────────────────
  { key: 'freight.view', category: CATEGORIES.freight, label: 'Ver fretes', scoped: true },
  { key: 'freight.create', category: CATEGORIES.freight, label: 'Criar frete', scoped: true },
  { key: 'freight.manage', category: CATEGORIES.freight, label: 'Editar/gerenciar fretes', scoped: true },
  { key: 'freight.finish', category: CATEGORIES.freight, label: 'Finalizar frete pelo app', scoped: true },

  // ── LAUNCH (despesas / abastecimento / vale) ───────────────────────────────
  { key: 'launch.view', category: CATEGORIES.launch, label: 'Ver lançamentos', scoped: true },
  { key: 'launch.create', category: CATEGORIES.launch, label: 'Criar lançamentos', scoped: true },
  { key: 'launch.approve', category: CATEGORIES.launch, label: 'Aprovar lançamentos', scoped: true },
  { key: 'launch.reject', category: CATEGORIES.launch, label: 'Rejeitar lançamentos', scoped: true },
  { key: 'launch.cancel', category: CATEGORIES.launch, label: 'Cancelar lançamentos', scoped: true },

  // ── DOCUMENTS ──────────────────────────────────────────────────────────────
  { key: 'documents.view', category: CATEGORIES.documents, label: 'Ver documentos', scoped: true },
  { key: 'documents.manage', category: CATEGORIES.documents, label: 'Gerenciar documentos', scoped: true },

  // ── DRIVERS ────────────────────────────────────────────────────────────────
  { key: 'drivers.view', category: CATEGORIES.drivers, label: 'Ver motoristas', scoped: true, legacyMenuKey: 'motoristas' },
  { key: 'drivers.manage', category: CATEGORIES.drivers, label: 'Gerenciar motoristas', scoped: true },

  // ── FLEET (Onda 2) ────────────────────────────────────────────────────────
  { key: 'fleet.view', category: CATEGORIES.fleet, label: 'Ver frota', scoped: true, entitlementCodigo: 'fleet' },
  { key: 'fleet.manage', category: CATEGORIES.fleet, label: 'Gerenciar frota', scoped: true, entitlementCodigo: 'fleet' },

  // ── OPERATION CAMPAIGN (Onda 3 / Campaign-A) ──────────────────────────────
  { key: 'campaign.view', category: CATEGORIES.campaign, label: 'Ver campanhas de escoamento', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.create', category: CATEGORIES.campaign, label: 'Criar campanhas de escoamento', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.plan', category: CATEGORIES.campaign, label: 'Gerar plano de campanha', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.approve', category: CATEGORIES.campaign, label: 'Aprovar plano de campanha', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.manage', category: CATEGORIES.campaign, label: 'Gerenciar campanhas de escoamento', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.dispatch', category: CATEGORIES.campaign, label: 'Designar/ofertar execução de viagens (Dispatch)', scoped: true, entitlementCodigo: 'operation_campaign' },
  { key: 'campaign.dispatch_respond', category: CATEGORIES.campaign, label: 'Responder a ofertas de despacho recebidas (motorista)', scoped: true, entitlementCodigo: 'operation_campaign' },

  // ── FINANCE OPERACIONAL (do cliente) ───────────────────────────────────────
  { key: 'finance.operational.view', category: CATEGORIES.finance_operational, label: 'Ver financeiro operacional', scoped: true },
  { key: 'finance.operational.manage', category: CATEGORIES.finance_operational, label: 'Gerenciar financeiro operacional', scoped: true },

  // ── FINANCE SaaS (faturas da própria empresa) ──────────────────────────────
  { key: 'finance.saas.view', category: CATEGORIES.finance_saas, label: 'Ver faturas SaaS da empresa', scoped: false },

  // ── REPORTS ────────────────────────────────────────────────────────────────
  { key: 'reports.operational.view', category: CATEGORIES.reports, label: 'Relatórios operacionais', scoped: true, legacyMenuKey: 'relatorios' },
  { key: 'reports.financial.view', category: CATEGORIES.reports, label: 'Relatórios financeiros', scoped: true },

  // ── PARTNER NETWORK (E3.6A) ────────────────────────────────────────────────
  // Rede PRIVADA: quem vê, quem administra o relacionamento, quem compartilha
  // uma lacuna de capacidade e quem responde por um parceiro que também é
  // cliente Matopiba. Nenhuma delas concede acesso financeiro.
  { key: 'partner_network.view', category: CATEGORIES.partner_network, label: 'Ver rede de parceiros', scoped: false, entitlementCodigo: 'partner_network' },
  { key: 'partner_network.manage', category: CATEGORIES.partner_network, label: 'Convidar e revogar parceiros', scoped: false, entitlementCodigo: 'partner_network' },
  { key: 'partner_network.share', category: CATEGORIES.partner_network, label: 'Compartilhar lacuna de capacidade com parceiros', scoped: true, entitlementCodigo: 'partner_network' },
  { key: 'partner_network.respond', category: CATEGORIES.partner_network, label: 'Responder oportunidades recebidas de parceiros', scoped: false, entitlementCodigo: 'partner_network' },

  // ── GOVERNANCE (portal — já existiam em PERMISSOES_PORTAL) ──────────────────
  { key: 'estrutura_operacional.gerenciar', category: CATEGORIES.governance, label: 'Gerenciar estrutura operacional', scoped: false, entitlementCodigo: 'estrutura_operacional' },
  { key: 'integracoes_erp.gerenciar', category: CATEGORIES.governance, label: 'Gerenciar integrações ERP', scoped: false, entitlementCodigo: 'integracoes_erp' },
  { key: 'acesso_corporativo_sso.gerenciar', category: CATEGORIES.governance, label: 'Gerenciar acesso corporativo (SSO)', scoped: false, entitlementCodigo: 'acesso_corporativo_sso' },
]);

const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((p) => p.key));
const PERMISSION_BY_KEY = Object.freeze(Object.fromEntries(PERMISSIONS.map((p) => [p.key, p])));
const GOVERNANCE_KEYS = Object.freeze(PERMISSIONS.filter((p) => p.governance).map((p) => p.key));
const SCOPED_KEYS = Object.freeze(PERMISSIONS.filter((p) => p.scoped).map((p) => p.key));

// Visibilidade financeira do motorista (VISIBILITY POLICY — não é permission).
const DRIVER_FINANCIAL_VISIBILITY = Object.freeze({
  COMMISSION_ONLY: 'commission_only',
  COMMISSION_PLUS_BASE: 'commission_plus_base',
  FULL_FREIGHT_FINANCIAL: 'full_freight_financial',
});
const DRIVER_FINANCIAL_VISIBILITY_MODES = Object.freeze(Object.values(DRIVER_FINANCIAL_VISIBILITY));

// stable_keys dos templates baseline (compat futura Entra App Role → template).
const TEMPLATE_KEYS = Object.freeze({
  ADMINISTRADOR: 'administrador',
  OPERADOR: 'operador',
  GERENTE_FROTA: 'gerente_frota',
  GERENTE_FILIAL: 'gerente_filial',
  GERENTE_REGIONAL: 'gerente_regional',
  GERENTE_NACIONAL: 'gerente_nacional',
  FINANCEIRO: 'financeiro',
  EMBARCADOR: 'embarcador',
  MOTORISTA: 'motorista',
});

// Tipos de usuário atualmente suportados pela UI (os demais ficam "preparados").
const UI_ENABLED_TEMPLATE_KEYS = Object.freeze([
  TEMPLATE_KEYS.ADMINISTRADOR,
  TEMPLATE_KEYS.OPERADOR,
  TEMPLATE_KEYS.GERENTE_FROTA,
  TEMPLATE_KEYS.FINANCEIRO,
  TEMPLATE_KEYS.MOTORISTA,
]);

// Mapa tipo-legado (usuarios.tipo) → template baseline. Só 'admin'/'motorista'
// existem em produção; o resto fica preparado.
const LEGACY_TIPO_TO_TEMPLATE = Object.freeze({
  admin: TEMPLATE_KEYS.ADMINISTRADOR,
  motorista: TEMPLATE_KEYS.MOTORISTA,
});

// Metadados de exibição dos templates baseline.
const TEMPLATE_META = Object.freeze({
  [TEMPLATE_KEYS.ADMINISTRADOR]: { display_name: 'Administrador', descricao: 'Administra o tenant: usuários, permissões, configurações, operação, relatórios e financeiro.' },
  [TEMPLATE_KEYS.OPERADOR]: { display_name: 'Operador', descricao: 'Operação do dia a dia: fretes, documentos e lançamentos. Sem financeiro nem administração.' },
  [TEMPLATE_KEYS.GERENTE_FROTA]: { display_name: 'Gerente de Frota', descricao: 'Gestão operacional da frota no escopo, incluindo aprovação de lançamentos. Sem financeiro por padrão.' },
  [TEMPLATE_KEYS.GERENTE_FILIAL]: { display_name: 'Gerente de Filial', descricao: 'Gestão dentro do escopo da filial. Sem financeiro por padrão.' },
  [TEMPLATE_KEYS.GERENTE_REGIONAL]: { display_name: 'Gerente Regional', descricao: 'Gestão dentro do escopo regional. Sem financeiro por padrão.' },
  [TEMPLATE_KEYS.GERENTE_NACIONAL]: { display_name: 'Gerente Nacional', descricao: 'Gestão no escopo atribuído. Sem financeiro automático.' },
  [TEMPLATE_KEYS.FINANCEIRO]: { display_name: 'Financeiro', descricao: 'Financeiro operacional e relatórios financeiros. Operação administrativa limitada.' },
  [TEMPLATE_KEYS.EMBARCADOR]: { display_name: 'Embarcador', descricao: 'Preparado para planejamento/demanda/documentos (futuro). Sem financeiro por padrão.' },
  [TEMPLATE_KEYS.MOTORISTA]: { display_name: 'Motorista', descricao: 'Acesso ao próprio contexto no app: fretes atribuídos, documentos e lançamentos.' },
});

// Permissões ALLOW por template baseline (default-deny para o que não estiver aqui).
// Estes são BASELINES INICIAIS da empresa — editáveis depois (não são regra global).
const _A = (...keys) => Object.freeze(keys);
const TEMPLATE_BASELINE_ALLOW = Object.freeze({
  [TEMPLATE_KEYS.ADMINISTRADOR]: _A(
    'company.settings.view', 'company.settings.manage',
    'users.view', 'users.manage',
    'permissions.manage',
    'freight.view', 'freight.create', 'freight.manage', 'freight.finish',
    'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
    'documents.view', 'documents.manage',
    'drivers.view', 'drivers.manage',
    'fleet.view', 'fleet.manage',
    'campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve', 'campaign.manage', 'campaign.dispatch',
    'finance.operational.view', 'finance.operational.manage',
    'finance.saas.view',
    'reports.operational.view', 'reports.financial.view',
    'estrutura_operacional.gerenciar', 'integracoes_erp.gerenciar', 'acesso_corporativo_sso.gerenciar',
    'partner_network.view', 'partner_network.manage', 'partner_network.share', 'partner_network.respond',
  ),
  [TEMPLATE_KEYS.OPERADOR]: _A(
    'company.settings.view',
    'freight.view', 'freight.create', 'freight.manage',
    'launch.view', 'launch.create',
    'documents.view', 'documents.manage',
    'drivers.view',
    'campaign.view', 'campaign.create', 'campaign.plan',
    'reports.operational.view',
  ),
  [TEMPLATE_KEYS.GERENTE_FROTA]: _A(
    'company.settings.view',
    'freight.view', 'freight.create', 'freight.manage', 'freight.finish',
    'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
    'documents.view', 'documents.manage',
    'drivers.view', 'drivers.manage',
    'fleet.view', 'fleet.manage',
    'campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve', 'campaign.manage', 'campaign.dispatch',
    'reports.operational.view',
    // §43: a rede é operacional, então o Gerente de Frota recebe. O Operador NÃO —
    // fica DEFAULT_DENY e a empresa delega depois, se quiser, pelo template editável.
    'partner_network.view', 'partner_network.manage', 'partner_network.share', 'partner_network.respond',
  ),
  [TEMPLATE_KEYS.GERENTE_FILIAL]: _A(
    'company.settings.view',
    'freight.view', 'freight.create', 'freight.manage', 'freight.finish',
    'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
    'documents.view', 'documents.manage',
    'drivers.view', 'drivers.manage',
    'campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve',
    'reports.operational.view',
  ),
  [TEMPLATE_KEYS.GERENTE_REGIONAL]: _A(
    'company.settings.view',
    'freight.view', 'freight.create', 'freight.manage', 'freight.finish',
    'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
    'documents.view', 'documents.manage',
    'drivers.view', 'drivers.manage',
    'campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve',
    'reports.operational.view',
  ),
  [TEMPLATE_KEYS.GERENTE_NACIONAL]: _A(
    'company.settings.view',
    'freight.view', 'freight.create', 'freight.manage', 'freight.finish',
    'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
    'documents.view', 'documents.manage',
    'drivers.view', 'drivers.manage',
    'campaign.view', 'campaign.create', 'campaign.plan', 'campaign.approve',
    'reports.operational.view',
  ),
  [TEMPLATE_KEYS.FINANCEIRO]: _A(
    'company.settings.view',
    'freight.view',
    'launch.view',
    'documents.view',
    'finance.operational.view', 'finance.operational.manage',
    'finance.saas.view',
    'reports.operational.view', 'reports.financial.view',
  ),
  [TEMPLATE_KEYS.EMBARCADOR]: _A(
    'freight.view',
    'documents.view',
    'reports.operational.view',
  ),
  [TEMPLATE_KEYS.MOTORISTA]: _A(
    // Motorista: acesso ao próprio contexto (app). freight.create=false por default;
    // freight.finish default false (existentes migram preservando pode_finalizar_viagem).
    'freight.view',
    'launch.view', 'launch.create',
    'documents.view',
    // Sem legado equivalente (Dispatch V1 é capacidade nova): allow por padrão, senão
    // nenhum motorista consegue responder a uma oferta mesmo com a empresa já habilitada
    // via entitlement operation_campaign. Override por usuário continua disponível.
    'campaign.dispatch_respond',
  ),
});

// Visibilidade financeira default por template (só motorista tem política real).
const TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY = Object.freeze({
  [TEMPLATE_KEYS.MOTORISTA]: DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY,
});

function isValidPermissionKey(key) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_BY_KEY, key);
}

function templateBaselineMap(stableKey) {
  // Retorna { key: true } (allow) para o baseline; ausência = deny.
  const allow = TEMPLATE_BASELINE_ALLOW[stableKey] || [];
  return Object.freeze(Object.fromEntries(allow.map((k) => [k, true])));
}

module.exports = {
  CATEGORIES,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  GOVERNANCE_KEYS,
  SCOPED_KEYS,
  DRIVER_FINANCIAL_VISIBILITY,
  DRIVER_FINANCIAL_VISIBILITY_MODES,
  TEMPLATE_KEYS,
  UI_ENABLED_TEMPLATE_KEYS,
  LEGACY_TIPO_TO_TEMPLATE,
  TEMPLATE_META,
  TEMPLATE_BASELINE_ALLOW,
  TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY,
  isValidPermissionKey,
  templateBaselineMap,
};

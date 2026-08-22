// permissionResolver.js — Resolver ÚNICO de permissões efetivas V9 (P2).
//
// Precedência (congelada):
//   PLATFORM_SECURITY_INVARIANT → ENTITLEMENT → USER_OVERRIDE → COMPANY_TEMPLATE → DEFAULT_DENY
//   scope é verificado DEPOIS da permissão efetiva (para ações scoped).
//
// - super_admin de plataforma: authority separada (todas as permissões de tenant = allow).
// - entitlement necessário ausente: DENY (mesmo com override/template allow).
// - override explícito (allow/deny): vence template.
// - template: allow se a chave estiver marcada; senão default-deny.
// - dual-read legado (motorista): freight.finish/create e visibilidade financeira
//   caem no legado quando não há override nem allow de template, preservando o
//   comportamento anterior (autônomo faz bypass de finish; pode_finalizar_viagem;
//   pode_criar_frete). Isto garante EFFECTIVE_BEFORE = EFFECTIVE_AFTER na transição.

'use strict';

const {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  DRIVER_FINANCIAL_VISIBILITY,
  LEGACY_TIPO_TO_TEMPLATE,
  templateBaselineMap,
  TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY,
} = require('./permissionRegistry');

function legacyTipoToStableKey(tipo) {
  return LEGACY_TIPO_TO_TEMPLATE[tipo] || null;
}

// Template sintético a partir do baseline em código (safety net anti-lockout).
function baselineTemplateFromRegistry(stableKey) {
  const permissions = { ...templateBaselineMap(stableKey) };
  if (Object.keys(permissions).length === 0 && stableKey !== 'motorista' && stableKey !== 'embarcador') return null;
  return {
    id: null,
    stable_key: stableKey,
    display_name: stableKey,
    driver_financial_visibility_mode: TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY[stableKey] || null,
    permissions,
    _fromRegistry: true,
  };
}

/**
 * Computa as permissões efetivas a partir de um contexto JÁ CARREGADO (pura, sem I/O).
 * @param {object} ctx
 *   ctx.user        {id, tipo, is_super_admin, empresa_id, empresa_tipo}
 *   ctx.template    {stable_key, permissions:{key:true}, driver_financial_visibility_mode} | null
 *   ctx.overrides   {key: 'allow'|'deny'}
 *   ctx.entitlements{codigo: boolean}   // para permissões com entitlementCodigo
 *   ctx.legacyDriver{pode_finalizar_viagem, pode_criar_frete, financial_visibility_mode} | null
 * @returns {{permissions:{key:boolean}, driverFinancialVisibility:string|null, isSuperAdmin:boolean,
 *            templateStableKey:string|null, source:{[key]:'super_admin'|'entitlement_denied'|'override'|'template'|'legacy'|'default_deny'}}}
 */
function computeEffectivePermissions(ctx = {}) {
  const user = ctx.user || {};
  const template = ctx.template || null;
  const overrides = ctx.overrides || {};
  const entitlements = ctx.entitlements || {};
  const legacyDriver = ctx.legacyDriver || null;
  const isSuperAdmin = user.is_super_admin === true;
  const isDriver = (user.tipo === 'motorista');
  const isAutonomo = (user.empresa_tipo === 'autonomo');

  const permissions = {};
  const source = {};

  for (const perm of PERMISSIONS) {
    const key = perm.key;

    if (isSuperAdmin) {
      permissions[key] = true;
      source[key] = 'super_admin';
      continue;
    }

    // 1) ENTITLEMENT (antes de override/template): se exige e não tem → DENY.
    if (perm.entitlementCodigo && entitlements[perm.entitlementCodigo] !== true) {
      permissions[key] = false;
      source[key] = 'entitlement_denied';
      continue;
    }

    // 2) USER OVERRIDE explícito.
    const ov = overrides[key];
    if (ov === 'deny') { permissions[key] = false; source[key] = 'override'; continue; }
    if (ov === 'allow') { permissions[key] = true; source[key] = 'override'; continue; }

    // 3) COMPANY TEMPLATE.
    if (template && template.permissions && template.permissions[key] === true) {
      permissions[key] = true;
      source[key] = 'template';
      continue;
    }

    // 4) DUAL-READ LEGADO (só motorista, chaves específicas) — preserva efetivo.
    if (isDriver && legacyDriver) {
      if (key === 'freight.finish') {
        const legacyFinish = isAutonomo || legacyDriver.pode_finalizar_viagem === true;
        if (legacyFinish) { permissions[key] = true; source[key] = 'legacy'; continue; }
      } else if (key === 'freight.create') {
        if (legacyDriver.pode_criar_frete === true) { permissions[key] = true; source[key] = 'legacy'; continue; }
      }
    }

    // 4b) AUTÔNOMO = dono do próprio negócio: enxerga as faturas SaaS da PRÓPRIA
    // empresa (Minhas Faturas / Regularização). Preserva o efetivo legado (a rota
    // /me/faturas era tenant-aberta e o autônomo owner é tipo='motorista', que não
    // tem finance.saas.view por template). Escopo continua a própria empresa (tenant).
    if (isAutonomo && key === 'finance.saas.view') {
      permissions[key] = true; source[key] = 'legacy'; continue;
    }

    // 5) DEFAULT_DENY.
    permissions[key] = false;
    source[key] = 'default_deny';
  }

  // VISIBILITY POLICY (motorista): override individual > (autônomo=full, preserva
  // o efetivo — o autônomo é o próprio dono e sempre viu o financeiro completo) >
  // template > default commission_only.
  let driverFinancialVisibility = null;
  if (isDriver) {
    driverFinancialVisibility =
      (legacyDriver && legacyDriver.financial_visibility_mode) ||
      (isAutonomo ? DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL : null) ||
      (template && template.driver_financial_visibility_mode) ||
      DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY;
  }

  return {
    permissions,
    driverFinancialVisibility,
    isSuperAdmin,
    templateStableKey: template ? template.stable_key || null : null,
    source,
  };
}

/** Conveniência: um usuário TEM a permissão efetiva? (sem scope) */
function hasPermission(effective, key) {
  return Boolean(effective && effective.permissions && effective.permissions[key] === true);
}

/**
 * Carrega o contexto de permissões de um usuário a partir do Supabase (I/O) e computa
 * o efetivo. Dual-read: se o usuário não tem template atribuído (dados V9 ausentes),
 * cai no baseline do tipo legado. NUNCA lança por tabela ausente (fail-safe legado).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} user  {uid|id, tipo|role, is_super_admin, empresa_id, empresa_tipo}
 */
async function loadEffectivePermissions(supabase, user = {}) {
  const uid = user.uid || user.id || null;
  const tipo = user.tipo || user.role || null;
  const isSuperAdmin = user.is_super_admin === true;
  const empresaId = user.empresa_id || null;

  const base = {
    user: { id: uid, tipo, is_super_admin: isSuperAdmin, empresa_id: empresaId, empresa_tipo: user.empresa_tipo || null },
    template: null,
    overrides: {},
    entitlements: {},
    legacyDriver: null,
  };

  if (isSuperAdmin) return computeEffectivePermissions(base);

  try {
    // Perfil canônico + template atribuído.
    let templateId = null;
    let empresaTipo = user.empresa_tipo || null;
    if (uid) {
      const { data: u } = await supabase
        .from('usuarios')
        .select('id, tipo, empresa_id, permission_template_id, empresas!usuarios_empresa_id_fkey(tipo)')
        .eq('id', uid)
        .maybeSingle();
      if (u) {
        base.user.tipo = u.tipo || base.user.tipo;
        base.user.empresa_id = u.empresa_id || base.user.empresa_id;
        templateId = u.permission_template_id || null;
        empresaTipo = u.empresas?.tipo || empresaTipo;
      }
    }
    base.user.empresa_tipo = empresaTipo;
    const resolvedEmpresaId = base.user.empresa_id;

    // Template: pelo id atribuído; senão baseline do tipo legado (dual-read).
    let template = null;
    const stableKey = base.user.tipo === 'admin' ? 'administrador'
      : base.user.tipo === 'motorista' ? 'motorista' : legacyTipoToStableKey(base.user.tipo);
    if (templateId) {
      template = await carregarTemplate(supabase, { id: templateId });
    } else if (resolvedEmpresaId && stableKey) {
      template = await carregarTemplate(supabase, { empresaId: resolvedEmpresaId, stableKey });
    }
    // Safety net: sem template no banco (ex.: empresa nova ainda não provisionada),
    // usa o BASELINE do registry em código pelo stable_key → evita lockout do admin.
    if (!template && stableKey) template = baselineTemplateFromRegistry(stableKey);
    base.template = template;

    // Overrides do usuário.
    if (uid) {
      const { data: ovs } = await supabase
        .from('user_permission_overrides')
        .select('permission_key, effect')
        .eq('usuario_id', uid);
      for (const o of ovs || []) base.overrides[o.permission_key] = o.effect;
    }

    // Legado do motorista (dual-read): flags + visibility.
    if (base.user.tipo === 'motorista' && uid) {
      const { data: m } = await supabase
        .from('motoristas')
        .select('pode_finalizar_viagem, pode_criar_frete, financial_visibility_mode')
        .eq('id', uid)
        .maybeSingle();
      if (m) base.legacyDriver = m;
    }

    // Entitlements (portal governance): reaproveita o serviço existente quando útil.
    base.entitlements = await carregarEntitlements(supabase, { empresaId: resolvedEmpresaId, user: base.user });
  } catch (err) {
    // fail-safe: se algo do V9 ainda não existe, retorna o efetivo com o que carregou
    // (nunca derruba a autoridade coarse legada, que segue em isAdmin/isSuperAdmin).
    if (!tabelaAusente(err)) throw err;
  }

  return computeEffectivePermissions(base);
}

async function carregarTemplate(supabase, { id, empresaId, stableKey } = {}) {
  let q = supabase.from('permission_templates')
    .select('id, stable_key, display_name, driver_financial_visibility_mode');
  if (id) q = q.eq('id', id);
  else if (empresaId && stableKey) q = q.eq('empresa_id', empresaId).eq('stable_key', stableKey);
  else return null;
  const { data: tpl } = await q.maybeSingle();
  if (!tpl) return null;
  const { data: perms } = await supabase
    .from('permission_template_permissions')
    .select('permission_key, allowed')
    .eq('template_id', tpl.id);
  const permissions = {};
  for (const p of perms || []) if (p.allowed === true) permissions[p.permission_key] = true;
  return {
    id: tpl.id,
    stable_key: tpl.stable_key,
    display_name: tpl.display_name,
    driver_financial_visibility_mode: tpl.driver_financial_visibility_mode || null,
    permissions,
  };
}

async function carregarEntitlements(supabase, { empresaId, user } = {}) {
  // Mapeia os códigos governance para permitido/negado usando o portal já existente.
  try {
    const { carregarPortalGovernanca } = require('../portalGovernanceService');
    const portal = await carregarPortalGovernanca(supabase, { empresaId, usuarioId: user?.id, user });
    const ent = portal?.entitlements || {};
    return {
      estrutura_operacional: ent.estrutura_operacional?.permitido === true,
      integracoes_erp: ent.integracoes_erp?.permitido === true,
      acesso_corporativo_sso: ent.acesso_corporativo_sso?.permitido === true,
      fleet: ent.fleet?.permitido === true,
    };
  } catch (_) {
    return {};
  }
}

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' ||
    /does not exist|could not find|schema cache/i.test(error.message || '')
  );
}

module.exports = {
  computeEffectivePermissions,
  loadEffectivePermissions,
  hasPermission,
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
};

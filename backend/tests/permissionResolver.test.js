'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeEffectivePermissions, hasPermission } = require('../services/permissions/permissionResolver');
const { templateBaselineMap, TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY, DRIVER_FINANCIAL_VISIBILITY } = require('../services/permissions/permissionRegistry');

function tpl(stableKey, extra = {}) {
  return {
    stable_key: stableKey,
    permissions: { ...templateBaselineMap(stableKey) },
    driver_financial_visibility_mode: TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY[stableKey] || null,
    ...extra,
  };
}

// ── PRECEDÊNCIA / DEFAULT-DENY ───────────────────────────────────────────────
test('default-deny: sem template nem override, tudo negado', () => {
  const eff = computeEffectivePermissions({ user: { tipo: 'operador' }, template: null });
  assert.equal(hasPermission(eff, 'freight.view'), false);
  assert.equal(hasPermission(eff, 'finance.operational.view'), false);
});

test('super_admin: todas as permissões de tenant = allow', () => {
  const eff = computeEffectivePermissions({ user: { is_super_admin: true } });
  assert.equal(hasPermission(eff, 'users.manage'), true);
  assert.equal(hasPermission(eff, 'finance.operational.manage'), true);
  assert.equal(eff.source['users.manage'], 'super_admin');
});

test('override DENY vence template ALLOW', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'operador' }, template: tpl('operador'),
    overrides: { 'freight.view': 'deny' },
  });
  assert.equal(hasPermission(eff, 'freight.view'), false);
  assert.equal(eff.source['freight.view'], 'override');
});

test('override ALLOW vence template ausente (default-deny)', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'operador' }, template: tpl('operador'),
    overrides: { 'finance.operational.view': 'allow' },
  });
  assert.equal(hasPermission(eff, 'finance.operational.view'), true);
});

test('ENTITLEMENT ausente nega mesmo com override ALLOW (entitlement > override)', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    overrides: { 'integracoes_erp.gerenciar': 'allow' },
    entitlements: { integracoes_erp: false },
  });
  assert.equal(hasPermission(eff, 'integracoes_erp.gerenciar'), false);
  assert.equal(eff.source['integracoes_erp.gerenciar'], 'entitlement_denied');
});

test('ENTITLEMENT presente + template ALLOW concede', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    entitlements: { estrutura_operacional: true, integracoes_erp: true, acesso_corporativo_sso: true },
  });
  assert.equal(hasPermission(eff, 'estrutura_operacional.gerenciar'), true);
});

// ── TEST MATRIX — TEMPLATES (Section 37) ────────────────────────────────────
test('templates: Operador não recebe financeiro por default; Administrador sim', () => {
  const op = computeEffectivePermissions({ user: { tipo: 'operador' }, template: tpl('operador') });
  assert.equal(hasPermission(op, 'finance.operational.view'), false);
  assert.equal(hasPermission(op, 'permissions.manage'), false);
  assert.equal(hasPermission(op, 'freight.create'), true);

  const adm = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('administrador') });
  assert.equal(hasPermission(adm, 'finance.operational.view'), true);
  assert.equal(hasPermission(adm, 'permissions.manage'), true);
});

test('templates: alterar template propaga a quem não tem override; override protege', () => {
  // Operador base finance=false
  const A_inherit = computeEffectivePermissions({ user: { tipo: 'operador' }, template: tpl('operador') });
  assert.equal(hasPermission(A_inherit, 'finance.operational.view'), false);

  // empresa muda template Operador → finance=true
  const operadorFinanceOn = tpl('operador');
  operadorFinanceOn.permissions['finance.operational.view'] = true;

  const A_after = computeEffectivePermissions({ user: { tipo: 'operador' }, template: operadorFinanceOn });
  assert.equal(hasPermission(A_after, 'finance.operational.view'), true); // A sem override segue o template

  const B_after = computeEffectivePermissions({
    user: { tipo: 'operador' }, template: operadorFinanceOn,
    overrides: { 'finance.operational.view': 'deny' },
  });
  assert.equal(hasPermission(B_after, 'finance.operational.view'), false); // B com override DENY não muda

  // remover override → B volta a herdar
  const B_reset = computeEffectivePermissions({ user: { tipo: 'operador' }, template: operadorFinanceOn });
  assert.equal(hasPermission(B_reset, 'finance.operational.view'), true);
});

// ── TEST MATRIX — DRIVER (Section 38) ───────────────────────────────────────
test('driver: create/finish default false; override e legado preservam efetivo', () => {
  const t = tpl('motorista');

  // A inherit puro
  const A = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'transportadora' }, template: t, legacyDriver: { pode_finalizar_viagem: false, pode_criar_frete: false } });
  assert.equal(hasPermission(A, 'freight.create'), false);
  assert.equal(hasPermission(A, 'freight.finish'), false);

  // B override create=true
  const B = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'transportadora' }, template: t, overrides: { 'freight.create': 'allow' }, legacyDriver: { pode_finalizar_viagem: false } });
  assert.equal(hasPermission(B, 'freight.create'), true);

  // legado pode_finalizar_viagem=true preserva finish sem override (dual-read)
  const C = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'transportadora' }, template: t, legacyDriver: { pode_finalizar_viagem: true } });
  assert.equal(hasPermission(C, 'freight.finish'), true);
  assert.equal(C.source['freight.finish'], 'legacy');

  // autônomo faz bypass de finish (preserva enforcement legado)
  const D = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: t, legacyDriver: { pode_finalizar_viagem: false } });
  assert.equal(hasPermission(D, 'freight.finish'), true);
});

test('driver: mudar template motorista create=true reflete em quem não tem override', () => {
  const t = tpl('motorista');
  t.permissions['freight.create'] = true; // empresa liga create no template
  const A = computeEffectivePermissions({ user: { tipo: 'motorista' }, template: t, legacyDriver: {} });
  assert.equal(hasPermission(A, 'freight.create'), true);
  const B = computeEffectivePermissions({ user: { tipo: 'motorista' }, template: t, overrides: { 'freight.create': 'deny' }, legacyDriver: {} });
  assert.equal(hasPermission(B, 'freight.create'), false);
});

test('driver financial visibility: default commission_only; override individual vence template', () => {
  const t = tpl('motorista');
  const def = computeEffectivePermissions({ user: { tipo: 'motorista' }, template: t, legacyDriver: {} });
  assert.equal(def.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY);

  const full = computeEffectivePermissions({ user: { tipo: 'motorista' }, template: t, legacyDriver: { financial_visibility_mode: DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL } });
  assert.equal(full.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL);
});

test('driver autônomo: visibilidade financeira = full por padrão (preserva efetivo do dono)', () => {
  const t = tpl('motorista');
  const auto = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: t, legacyDriver: {} });
  assert.equal(auto.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL);
  // override individual ainda vence
  const overrideCommission = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: t, legacyDriver: { financial_visibility_mode: DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY } });
  assert.equal(overrideCommission.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY);
});

// ── P2.9: LAUNCH transitions + REPORTS por template (features existentes) ─────
test('launch approve/reject/cancel: operador NÃO; gerente_frota e administrador SIM', () => {
  const op = computeEffectivePermissions({ user: { tipo: 'operador' }, template: tpl('operador') });
  for (const k of ['launch.approve', 'launch.reject', 'launch.cancel']) assert.equal(hasPermission(op, k), false, `operador não deve ${k}`);
  assert.equal(hasPermission(op, 'launch.create'), true);

  const gf = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('gerente_frota') });
  for (const k of ['launch.approve', 'launch.reject', 'launch.cancel']) assert.equal(hasPermission(gf, k), true, `gerente_frota deve ${k}`);

  const adm = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('administrador') });
  for (const k of ['launch.approve', 'launch.reject', 'launch.cancel']) assert.equal(hasPermission(adm, k), true);
});

test('reports: operador tem operational mas NÃO financial; financeiro/administrador têm financial', () => {
  const op = computeEffectivePermissions({ user: { tipo: 'operador' }, template: tpl('operador') });
  assert.equal(hasPermission(op, 'reports.operational.view'), true);
  assert.equal(hasPermission(op, 'reports.financial.view'), false);

  const fin = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('financeiro') });
  assert.equal(hasPermission(fin, 'reports.financial.view'), true);
  assert.equal(hasPermission(fin, 'launch.approve'), false); // financeiro não aprova lançamentos

  const adm = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('administrador') });
  assert.equal(hasPermission(adm, 'reports.financial.view'), true);
  assert.equal(hasPermission(adm, 'reports.operational.view'), true);
});

test('users.view: administrador SIM; motorista NÃO (feature existente enforced)', () => {
  const adm = computeEffectivePermissions({ user: { tipo: 'admin' }, template: tpl('administrador') });
  assert.equal(hasPermission(adm, 'users.view'), true);
  const mot = computeEffectivePermissions({ user: { tipo: 'motorista' }, template: tpl('motorista'), legacyDriver: {} });
  assert.equal(hasPermission(mot, 'users.view'), false);
});

// ── P2.10: DELEGAÇÃO real (template não é decorativo) ────────────────────────
test('delegação drivers.view: operador inherit=false → template ALLOW=true → override DENY=false → remove=true', () => {
  // baseline operador NÃO tem drivers.manage nem drivers.view? operador TEM drivers.view.
  // Para provar delegação, começamos de um template SEM a key e a empresa concede.
  const semDrivers = tpl('operador');
  delete semDrivers.permissions['drivers.view'];
  const A = computeEffectivePermissions({ user: { tipo: 'operador' }, template: semDrivers });
  assert.equal(hasPermission(A, 'drivers.view'), false, 'inherit sem a key → deny');

  const comDrivers = tpl('operador');
  comDrivers.permissions['drivers.view'] = true; // empresa concede no template
  const B = computeEffectivePermissions({ user: { tipo: 'operador' }, template: comDrivers });
  assert.equal(hasPermission(B, 'drivers.view'), true, 'template ALLOW → concede');

  const C = computeEffectivePermissions({ user: { tipo: 'operador' }, template: comDrivers, overrides: { 'drivers.view': 'deny' } });
  assert.equal(hasPermission(C, 'drivers.view'), false, 'override DENY protege');

  const D = computeEffectivePermissions({ user: { tipo: 'operador' }, template: comDrivers });
  assert.equal(hasPermission(D, 'drivers.view'), true, 'remover override → volta a herdar');
});

// ── P2.10: NEGATIVE ADMIN OVERRIDE (isAdmin NÃO fura o V9) ────────────────────
test('negative admin override: administrador com DENY em drivers.manage/company.settings.manage/finance.saas.view → NEGADO mesmo tipo=admin', () => {
  for (const k of ['drivers.manage', 'company.settings.manage', 'finance.saas.view']) {
    const eff = computeEffectivePermissions({
      user: { tipo: 'admin' }, template: tpl('administrador'), overrides: { [k]: 'deny' },
    });
    assert.equal(hasPermission(eff, k), false, `override DENY ${k} deve negar mesmo para admin`);
    assert.equal(eff.source[k], 'override');
  }
  // governança (users.manage/permissions.manage) segue protegida pela guarda de DB
  // (último admin), não por este caminho — aqui só provamos que o override vence o template.
});

test('autônomo: finance.saas.view = true por bypass (dono vê faturas SaaS da própria empresa)', () => {
  const auto = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: tpl('motorista'), legacyDriver: {} });
  assert.equal(hasPermission(auto, 'finance.saas.view'), true);
  const vinc = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'transportadora' }, template: tpl('motorista'), legacyDriver: {} });
  assert.equal(hasPermission(vinc, 'finance.saas.view'), false, 'motorista de empresa não vê faturas SaaS');
});

// ── P2.10: ESTRUTURA OPERACIONAL — autoridade em camadas (ENTITLEMENT ∧ PERMISSÃO) ──
// A rota /operacional aplica: verifyToken → verificarEmpresa → entitlement → requirePermission.
// O resolver espelha a mesma álgebra (defesa em profundidade): entitlement DENY vence tudo;
// com entitlement ALLOW, a permissão efetiva decide; override DENY nega mesmo para admin.
test('estrutura_operacional: entitlement DENY nega mesmo admin com template ALLOW (entitlement > permissão)', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    entitlements: { estrutura_operacional: false },
  });
  assert.equal(hasPermission(eff, 'estrutura_operacional.gerenciar'), false);
  assert.equal(eff.source['estrutura_operacional.gerenciar'], 'entitlement_denied');
});

test('estrutura_operacional: entitlement ALLOW + admin template ALLOW → concede', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    entitlements: { estrutura_operacional: true },
  });
  assert.equal(hasPermission(eff, 'estrutura_operacional.gerenciar'), true);
  assert.equal(eff.source['estrutura_operacional.gerenciar'], 'template');
});

test('estrutura_operacional: NEGATIVE ADMIN OVERRIDE — entitlement ALLOW mas override DENY → NEGADO mesmo tipo=admin', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    entitlements: { estrutura_operacional: true },
    overrides: { 'estrutura_operacional.gerenciar': 'deny' },
  });
  assert.equal(hasPermission(eff, 'estrutura_operacional.gerenciar'), false, 'isAdmin não fura o override DENY');
  assert.equal(eff.source['estrutura_operacional.gerenciar'], 'override');
});

// ── LEGADO: preservação de efetivo (admin coarse) ────────────────────────────
test('admin com template administrador mantém governança independentemente de overrides de menu .view', () => {
  const eff = computeEffectivePermissions({
    user: { tipo: 'admin' }, template: tpl('administrador'),
    overrides: { 'users.view': 'deny', 'company.settings.view': 'deny' }, // menu escondido (legado)
  });
  // menu escondido, mas governança (manage) intacta:
  assert.equal(hasPermission(eff, 'users.view'), false);
  assert.equal(hasPermission(eff, 'users.manage'), true);
  assert.equal(hasPermission(eff, 'permissions.manage'), true);
});

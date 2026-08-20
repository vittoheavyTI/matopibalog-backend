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

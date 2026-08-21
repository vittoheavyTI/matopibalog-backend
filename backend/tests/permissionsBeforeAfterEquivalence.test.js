'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// P2 (Review 5) — PROVA DE EQUIVALÊNCIA EFETIVO BEFORE→AFTER (test-only, sem DB, sem PII).
//
// BEFORE = modelo LEGADO (coarse isAdmin + permissoes JSON de menu + pode_finalizar_viagem
//          + bypass autônomo + criação implícita de frete pelo motorista).
// AFTER  = modelo V9 (template baseline do registry + overrides que a migration 072 CRIA
//          exatamente onde o legado difere do baseline), computado pelo resolver real.
//
// Objetivo: UNEXPECTED_PERMISSION_DRIFT = 0. O único delta ACEITO é o tightening de
// segurança D-042: motorista deixa de ter freight.create implícito (passa a default false).
// Perfis são SINTÉTICOS e representam as categorias do snapshot sanitizado (nenhum id/PII).

const { computeEffectivePermissions } = require('../services/permissions/permissionResolver');
const {
  templateBaselineMap, TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY, DRIVER_FINANCIAL_VISIBILITY,
} = require('../services/permissions/permissionRegistry');

// Capabilities derivadas do legado que fazem sentido comparar.
const CAPS = [
  'users.view', 'company.settings.view', 'drivers.view', 'reports.operational.view',
  'users.manage', 'permissions.manage', 'finance.operational.view', 'finance.operational.manage',
  'freight.view', 'freight.create', 'freight.finish', 'launch.view', 'launch.create', 'documents.view',
  // P2.9 — features EXISTENTES agora enforced (launch transitions + relatórios financeiros).
  'launch.approve', 'launch.reject', 'launch.cancel', 'reports.financial.view',
];

function bool(v, def) { return (v === undefined || v === null) ? def : v === true; }

// ── EFFECTIVE_BEFORE: reconstrói o efetivo do modelo LEGADO ───────────────────
function legacyEffective(p) {
  const e = {};
  if (p.tipo === 'admin') {
    // Coarse isAdmin: autoridade total no tenant; menu .view gated por permissoes.
    const menu = p.permissoes || {};
    e['users.view'] = bool(menu.usuarios, true);
    e['company.settings.view'] = bool(menu.configuracoes, true);
    e['drivers.view'] = bool(menu.motoristas, true);
    e['reports.operational.view'] = bool(menu.relatorios, true);
    // governança + operação + financeiro operacional + transições + relatórios
    // financeiros: admin coarse (role='admin') sempre pôde no modelo legado.
    for (const k of ['users.manage', 'permissions.manage', 'finance.operational.view',
      'finance.operational.manage', 'freight.view', 'freight.create', 'freight.finish',
      'launch.view', 'launch.create', 'launch.approve', 'launch.reject', 'launch.cancel',
      'documents.view', 'reports.financial.view']) e[k] = true;
  } else if (p.tipo === 'motorista') {
    for (const k of CAPS) e[k] = false;
    e['freight.view'] = true; e['launch.view'] = true; e['launch.create'] = true; e['documents.view'] = true;
    // finish legado: pode_finalizar_viagem OU autônomo (bypass do dono).
    e['freight.finish'] = (p.empresa_tipo === 'autonomo') || bool(p.pode_finalizar_viagem, false);
    // create legado: motorista podia criar frete implicitamente (auto-criação).
    e['freight.create'] = true;
  }
  return e;
}

// ── EFFECTIVE_AFTER: modelo V9 via resolver real (template + overrides migrados) ──
function v9Template(stableKey) {
  return {
    stable_key: stableKey,
    permissions: { ...templateBaselineMap(stableKey) },
    driver_financial_visibility_mode: TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY[stableKey] || null,
  };
}

function v9Effective(p) {
  if (p.tipo === 'admin') {
    // A migration 072 (6a) cria override DENY nas .view de menu desligadas no legado.
    const menu = p.permissoes || {};
    const overrides = {};
    if (bool(menu.usuarios, true) === false) overrides['users.view'] = 'deny';
    if (bool(menu.configuracoes, true) === false) overrides['company.settings.view'] = 'deny';
    if (bool(menu.motoristas, true) === false) overrides['drivers.view'] = 'deny';
    if (bool(menu.relatorios, true) === false) overrides['reports.operational.view'] = 'deny';
    const eff = computeEffectivePermissions({
      user: { tipo: 'admin', empresa_tipo: p.empresa_tipo }, template: v9Template('administrador'), overrides,
    });
    return eff.permissions;
  }
  // motorista: template motorista + dual-read legado (finish/create) + autônomo.
  const overrides = {};
  if (bool(p.pode_finalizar_viagem, false) === true) overrides['freight.finish'] = 'allow'; // 6b migration
  const eff = computeEffectivePermissions({
    user: { tipo: 'motorista', empresa_tipo: p.empresa_tipo },
    template: v9Template('motorista'),
    overrides,
    legacyDriver: {
      pode_finalizar_viagem: bool(p.pode_finalizar_viagem, false),
      pode_criar_frete: false, // D-042: default false (não migra o implícito)
      financial_visibility_mode: p.financial_visibility_mode || null,
    },
  });
  return eff.permissions;
}

// Perfis sintéticos representando as categorias do snapshot (sem PII).
const PROFILES = [
  { nome: 'admin_menu_completo', tipo: 'admin', empresa_tipo: 'transportadora', permissoes: { usuarios: true, configuracoes: true, motoristas: true, relatorios: true, dashboard: true } },
  { nome: 'admin_menu_parcial', tipo: 'admin', empresa_tipo: 'transportadora', permissoes: { usuarios: false, configuracoes: false, motoristas: true, relatorios: true } },
  { nome: 'admin_autonomo', tipo: 'admin', empresa_tipo: 'autonomo', permissoes: {} },
  { nome: 'motorista_finish_on', tipo: 'motorista', empresa_tipo: 'transportadora', pode_finalizar_viagem: true },
  { nome: 'motorista_finish_off', tipo: 'motorista', empresa_tipo: 'transportadora', pode_finalizar_viagem: false },
  { nome: 'motorista_autonomo', tipo: 'motorista', empresa_tipo: 'autonomo', pode_finalizar_viagem: false },
];

// Deltas ESPERADOS (tightening de segurança), não contam como drift inesperado.
function isExpectedTightening(profile, cap, before, after) {
  // D-042: motorista freight.create true(implícito)→false.
  return profile.tipo === 'motorista' && cap === 'freight.create' && before === true && after === false;
}

test('EFFECTIVE_BEFORE == EFFECTIVE_AFTER (exceto tightening D-042); drift inesperado = 0', () => {
  let expected = 0; let unexpected = 0; let compared = 0;
  const unexpectedDetails = [];
  for (const p of PROFILES) {
    const before = legacyEffective(p);
    const after = v9Effective(p);
    for (const cap of CAPS) {
      compared += 1;
      const b = before[cap] === true;
      const a = after[cap] === true;
      if (b === a) continue;
      if (isExpectedTightening(p, cap, b, a)) { expected += 1; continue; }
      unexpected += 1;
      unexpectedDetails.push(`${p.nome}:${cap} BEFORE=${b} AFTER=${a}`);
    }
  }
  // Relatório (sem PII) para o log do CI.
  console.log(`[before/after] USERS_SAMPLED=${PROFILES.length} CAPABILITIES_COMPARED=${compared} EXPECTED_DELTAS=${expected} UNEXPECTED_DELTAS=${unexpected}`);
  assert.deepEqual(unexpectedDetails, [], 'nenhum drift inesperado');
  assert.equal(unexpected, 0);
  // O tightening D-042 DEVE aparecer para os 3 perfis de motorista.
  assert.equal(expected, 3, 'D-042 aplica-se aos 3 perfis de motorista');
});

test('driver financial visibility preservada: vinculado=commission_only, autônomo=full', () => {
  const vinc = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'transportadora' }, template: v9Template('motorista'), legacyDriver: {} });
  assert.equal(vinc.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY);
  const auto = computeEffectivePermissions({ user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: v9Template('motorista'), legacyDriver: {} });
  assert.equal(auto.driverFinancialVisibility, DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL);
});

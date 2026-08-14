const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveOperationalScopeState,
  canAccessUnit,
  canDelegateScope,
  deriveUnitForWrite,
} = require('../services/operationalScopeDomainService');

test('empresa legacy sem unidades permanece equivalente sem virar GLOBAL novo', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    units: [],
    memberships: [],
  });
  assert.equal(scope.mode, 'LEGACY_COMPANY');
  assert.equal(scope.scope_level, 'LEGACY_COMPANY');
  assert.equal(scope.include_legacy_unscoped, true);
  assert.equal(scope.can_manage_operational_structure, true);
});

test('LOCAL acessa somente a unidade explicitamente permitida', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo', is_default: true },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [
      { usuario_id: 'u1', empresa_id: 'e1', scope_level: 'LOCAL', unidade_operacional_id: 'ua', status: 'ativo' },
    ],
  });
  assert.equal(scope.mode, 'LIMITED');
  assert.deepEqual(scope.allowed_unit_ids, ['ua']);
  assert.equal(canAccessUnit(scope, 'ua'), true);
  assert.equal(canAccessUnit(scope, 'ub'), false);
});

test('REGIONAL herda as unidades ativas vinculadas a regiao', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [
      { usuario_id: 'u1', empresa_id: 'e1', scope_level: 'REGIONAL', regiao_operacional_id: 'r1', status: 'ativo' },
    ],
    regionalUnitRows: [
      { regiao_id: 'r1', unidade_operacional_id: 'ua', status: 'ativo' },
      { regiao_id: 'r1', unidade_operacional_id: 'ub', status: 'ativo' },
    ],
  });
  assert.equal(scope.mode, 'LIMITED');
  assert.deepEqual(scope.allowed_unit_ids.sort(), ['ua', 'ub']);
});

test('GLOBAL explicito acessa todas as unidades da empresa', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [
      { usuario_id: 'u1', empresa_id: 'e1', scope_level: 'GLOBAL', status: 'ativo' },
    ],
  });
  assert.equal(scope.mode, 'GLOBAL');
  assert.deepEqual(scope.allowed_unit_ids.sort(), ['ua', 'ub']);
});

test('empresa com unidades e usuario sem membership fica sem acesso operacional', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [{ id: 'ua', empresa_id: 'e1', status: 'ativo' }],
    memberships: [],
  });
  assert.equal(scope.mode, 'NO_ACCESS');
});

test('deriveUnitForWrite usa default somente quando ela esta no escopo', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo', is_default: true },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [
      { usuario_id: 'u1', empresa_id: 'e1', scope_level: 'LOCAL', unidade_operacional_id: 'ua', status: 'ativo' },
    ],
  });
  assert.deepEqual(deriveUnitForWrite({ scope }), { ok: true, unidade_operacional_id: 'ua' });
  assert.deepEqual(deriveUnitForWrite({ scope, requestedUnitId: 'ub' }), { ok: false, reason: 'operational_unit_forbidden' });
});

test('configured preserva acesso legacy e evita lockout ao criar primeira unidade', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'admin-b', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'configured',
    units: [{ id: 'ua', empresa_id: 'e1', status: 'ativo', is_default: true }],
    memberships: [],
  });
  assert.equal(scope.mode, 'LEGACY_COMPANY');
  assert.equal(scope.has_operational_structure, true);
  assert.equal(scope.can_manage_operational_structure, true);
  assert.equal(canAccessUnit(scope, 'ua'), true);
});

test('enforced sem membership bloqueia somente depois da ativacao explicita', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'admin-b', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [{ id: 'ua', empresa_id: 'e1', status: 'ativo', is_default: true }],
    memberships: [],
  });
  assert.equal(scope.mode, 'NO_ACCESS');
});

test('GLOBAL autorizado e selecao visual filtra sem reduzir autorizacao', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    requestedUnitId: 'ua',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [{ usuario_id: 'u1', empresa_id: 'e1', scope_level: 'GLOBAL', papel: 'admin', status: 'ativo' }],
  });
  assert.equal(scope.mode, 'GLOBAL');
  assert.deepEqual(scope.authorized_unit_ids.sort(), ['ua', 'ub']);
  assert.deepEqual(scope.effective_filter_unit_ids, ['ua']);
  assert.equal(canAccessUnit(scope, 'ub'), true);
});

test('LOCAL nao delega regional maior nem global', () => {
  const actorScope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    empresaMode: 'enforced',
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e1', status: 'ativo' },
    ],
    memberships: [{ usuario_id: 'u1', empresa_id: 'e1', scope_level: 'LOCAL', unidade_operacional_id: 'ua', papel: 'gestor', status: 'ativo' }],
  });
  assert.equal(canDelegateScope(actorScope, { scope_level: 'GLOBAL' }).ok, false);
  assert.equal(canDelegateScope(actorScope, { scope_level: 'LOCAL', unidade_operacional_id: 'ua' }).ok, true);
  assert.equal(canDelegateScope(
    actorScope,
    { scope_level: 'REGIONAL', regiao_operacional_id: 'r1' },
    [
      { regiao_id: 'r1', unidade_operacional_id: 'ua', status: 'ativo' },
      { regiao_id: 'r1', unidade_operacional_id: 'ub', status: 'ativo' },
    ],
  ).ok, false);
});

test('GLOBAL corporativo autoriza empresas do grupo e exclui empresa externa', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'corp', role: 'admin' },
    grupoId: 'g1',
    empresaMode: 'enforced',
    groupCompanyRows: [
      { grupo_id: 'g1', empresa_id: 'e1', status: 'ativo' },
      { grupo_id: 'g1', empresa_id: 'e2', status: 'ativo' },
      { grupo_id: 'g2', empresa_id: 'e3', status: 'ativo' },
    ],
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e2', status: 'ativo' },
      { id: 'uc', empresa_id: 'e3', status: 'ativo' },
    ],
    memberships: [{ usuario_id: 'corp', grupo_id: 'g1', empresa_id: null, scope_level: 'GLOBAL', papel: 'admin', status: 'ativo' }],
  });
  assert.equal(scope.mode, 'GLOBAL_CORPORATE');
  assert.deepEqual(scope.authorized_empresa_ids.sort(), ['e1', 'e2']);
  assert.deepEqual(scope.authorized_unit_ids.sort(), ['ua', 'ub']);
});

test('GLOBAL de empresa nao vira corporativo apenas por grupo selecionado', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'admin-a', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
    grupoId: 'g1',
    empresaMode: 'enforced',
    groupCompanyRows: [
      { grupo_id: 'g1', empresa_id: 'e1', status: 'ativo' },
      { grupo_id: 'g1', empresa_id: 'e2', status: 'ativo' },
    ],
    units: [
      { id: 'ua', empresa_id: 'e1', status: 'ativo' },
      { id: 'ub', empresa_id: 'e2', status: 'ativo' },
    ],
    memberships: [{ usuario_id: 'admin-a', empresa_id: 'e1', scope_level: 'GLOBAL', papel: 'admin', status: 'ativo' }],
  });
  assert.equal(scope.mode, 'GLOBAL');
  assert.deepEqual(scope.authorized_empresa_ids, ['e1']);
  assert.deepEqual(scope.authorized_unit_ids, ['ua']);
  assert.equal(canAccessUnit(scope, 'ub'), false);
});

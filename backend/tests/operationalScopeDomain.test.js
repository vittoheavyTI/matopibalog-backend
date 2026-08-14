const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveOperationalScopeState,
  canAccessUnit,
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
    units: [{ id: 'ua', empresa_id: 'e1', status: 'ativo' }],
    memberships: [],
  });
  assert.equal(scope.mode, 'NO_ACCESS');
});

test('deriveUnitForWrite usa default somente quando ela esta no escopo', () => {
  const scope = resolveOperationalScopeState({
    user: { id: 'u1', empresa_id: 'e1', role: 'admin' },
    empresaId: 'e1',
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

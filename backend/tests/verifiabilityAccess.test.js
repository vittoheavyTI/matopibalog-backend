'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnosticAccessContext } = require('../services/verifiability/diagnosticAccess');

test('diagnostic access allows only platform super-admin authority', () => {
  const access = buildDiagnosticAccessContext({
    user: { uid: 'u-super', role: 'admin', is_super_admin: true },
    headers: { 'x-empresa-id': 'tenant-a' },
    correlation: { correlation_id: 'tenant-b' },
  });
  assert.equal(access.authority, 'super_admin');
  assert.equal(access.scope.type, 'platform');
  assert.equal(access.scope.empresa_id, null);
});

test('diagnostic access denies tenant users', () => {
  assert.throws(() => buildDiagnosticAccessContext({
    user: { uid: 'u-admin', role: 'admin', is_super_admin: false, empresa_id: 'tenant-a' },
  }), /diagnostics_super_admin_required/);
});

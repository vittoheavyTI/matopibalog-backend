const test = require('node:test');
const assert = require('node:assert/strict');
const {
  lerReasonDiagnostico, deviceHashCurto, montarLogEmissao, DIAGNOSTIC_REASONS,
} = require('../services/auth/trackingEmissaoDiag');

// Observabilidade da emissão da credencial de rastreamento (credential storm hardening).
// O reason é DIAGNÓSTICO: allowlist fechada, ausente/desconhecido → 'unknown', e NUNCA usado
// para autorização/escopo. O log é sanitizado (nenhum segredo).

test('reason da allowlist chega como está (trim + case-insensitive)', () => {
  for (const r of DIAGNOSTIC_REASONS) {
    assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': r } }), r);
  }
  assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': '  TRIP_STARTED ' } }), 'trip_started');
});

test('reason ausente → unknown', () => {
  assert.equal(lerReasonDiagnostico({ headers: {} }), 'unknown');
  assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': '' } }), 'unknown');
  assert.equal(lerReasonDiagnostico({}), 'unknown');
});

test('reason inválido/desconhecido → unknown (não injeta valor arbitrário)', () => {
  assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': 'admin' } }), 'unknown');
  assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': 'drop table' } }), 'unknown');
  assert.equal(lerReasonDiagnostico({ headers: { 'x-tracking-reason': 12345 } }), 'unknown');
  // O resultado é SEMPRE da allowlist ∪ {'unknown'} — nunca um valor arbitrário do cliente.
  const out = lerReasonDiagnostico({ headers: { 'x-tracking-reason': 'qualquer-coisa' } });
  assert.ok(out === 'unknown' || DIAGNOSTIC_REASONS.has(out));
});

test('deviceHashCurto: hash de 12 hex, nunca o device cru; null p/ ausente', () => {
  const raw = 'device-super-secreto-123';
  const h = deviceHashCurto(raw);
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.notEqual(h, raw);
  assert.ok(!h.includes(raw));
  assert.equal(deviceHashCurto(null), null);
  assert.equal(deviceHashCurto(''), null);
});

test('montarLogEmissao: só campos sanitizados; NENHUM segredo entra no log', () => {
  const req = {
    headers: { 'x-tracking-reason': 'finance_reconcile', authorization: 'Bearer access-token-secreto' },
    body: { credential: 'mtk1.SEGREDO', refresh: 'refresh-secreto' },
  };
  const log = montarLogEmissao({
    req,
    sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    deviceId: 'device-xyz',
    scopeCount: 2,
  });
  assert.equal(log.reason, 'finance_reconcile');
  assert.equal(log.session_id, 'aaaaaaaa'); // só prefixo do sid
  assert.equal(log.device_present, true);
  assert.match(log.device_hash, /^[0-9a-f]{12}$/);
  assert.equal(log.scope_count, 2);
  assert.equal(log.result, 'issued');

  // Nenhum segredo (credential/access/refresh/device cru/sid completo) pode aparecer no log.
  const serial = JSON.stringify(log);
  for (const segredo of [
    'mtk1.SEGREDO', 'access-token-secreto', 'refresh-secreto', 'device-xyz',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  ]) {
    assert.ok(!serial.includes(segredo), `log vazou segredo: ${segredo}`);
  }
});

test('montarLogEmissao: sid ausente → session_id null (sem quebrar)', () => {
  const log = montarLogEmissao({ req: { headers: {} }, sid: null, deviceId: null, scopeCount: 0 });
  assert.equal(log.session_id, null);
  assert.equal(log.device_present, false);
  assert.equal(log.device_hash, null);
  assert.equal(log.reason, 'unknown');
});

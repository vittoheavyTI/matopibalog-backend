const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularExpiracao,
  avaliarCredencial,
} = require('../services/auth/trackingCredentialDomain');

const AGORA = Date.parse('2026-08-10T12:00:00.000Z');
const EMP = 'emp-1';
const MOT = 'mot-1';

function credOk(over = {}) {
  return {
    motorista_id: MOT,
    empresa_id: EMP,
    expires_at: new Date(AGORA + 3600 * 1000).toISOString(),
    revoked_at: null,
    ...over,
  };
}
function usuarioOk(over = {}) {
  return { id: MOT, status: 'ativo', empresa_id: EMP, ...over };
}

test('calcularExpiracao soma o TTL em segundos', () => {
  const iso = calcularExpiracao(AGORA, 86400);
  assert.equal(Date.parse(iso), AGORA + 86400 * 1000);
});

test('credencial válida + motorista ativo + mesma empresa → ok', () => {
  const r = avaliarCredencial({ credencial: credOk(), usuario: usuarioOk(), sessao: null, agoraMs: AGORA });
  assert.equal(r.ok, true);
  assert.equal(r.identidade.uid, MOT);
  assert.equal(r.identidade.empresa_id, EMP);
  assert.equal(r.identidade.role, 'motorista');
  assert.equal(r.identidade.is_super_admin, false);
});

test('credencial ausente → credential_invalid', () => {
  const r = avaliarCredencial({ credencial: null, usuario: usuarioOk(), sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'credential_invalid' });
});

test('credencial revogada → credential_revoked', () => {
  const r = avaliarCredencial({ credencial: credOk({ revoked_at: new Date(AGORA).toISOString() }), usuario: usuarioOk(), sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'credential_revoked' });
});

test('credencial expirada → credential_expired', () => {
  const r = avaliarCredencial({ credencial: credOk({ expires_at: new Date(AGORA - 1000).toISOString() }), usuario: usuarioOk(), sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'credential_expired' });
});

test('SESSÃO revogada explicitamente → credential_revoked (logout/admin)', () => {
  const r = avaliarCredencial({ credencial: credOk(), usuario: usuarioOk(), sessao: { revoked_at: new Date(AGORA).toISOString() }, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'credential_revoked' });
});

test('§5: NÃO olha idle/absolute da sessão — só revoked_at (expiração natural não interrompe)', () => {
  // Sessão com idle/absolute expirados, mas NÃO revogada → tracking segue válido.
  const r = avaliarCredencial({
    credencial: credOk(),
    usuario: usuarioOk(),
    sessao: { revoked_at: null, idle_expires_at: new Date(AGORA - 10 * 3600 * 1000).toISOString(), absolute_expires_at: new Date(AGORA - 3600 * 1000).toISOString() },
    agoraMs: AGORA,
  });
  assert.equal(r.ok, true);
});

test('motorista inexistente → driver_blocked', () => {
  const r = avaliarCredencial({ credencial: credOk(), usuario: null, sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'driver_blocked' });
});

test('motorista com status != ativo (bloqueio admin) → driver_blocked', () => {
  for (const status of ['bloqueado', 'inativo', 'suspenso', '']) {
    const r = avaliarCredencial({ credencial: credOk(), usuario: usuarioOk({ status }), sessao: null, agoraMs: AGORA });
    assert.deepEqual(r, { ok: false, code: 'driver_blocked' }, `status=${status}`);
  }
});

test('motorista mudou de empresa (vínculo) → tracking_scope_forbidden', () => {
  const r = avaliarCredencial({ credencial: credOk(), usuario: usuarioOk({ empresa_id: 'outra-empresa' }), sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'tracking_scope_forbidden' });
});

test('id do usuário difere do motorista da credencial → tracking_scope_forbidden', () => {
  const r = avaliarCredencial({ credencial: credOk(), usuario: usuarioOk({ id: 'outro-usuario' }), sessao: null, agoraMs: AGORA });
  assert.deepEqual(r, { ok: false, code: 'tracking_scope_forbidden' });
});

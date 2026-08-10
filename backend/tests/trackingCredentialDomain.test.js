const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularExpiracao,
  calcularMaxExpiracao,
  avaliarCredencial,
} = require('../services/auth/trackingCredentialDomain');

const AGORA = Date.parse('2026-08-10T12:00:00.000Z');
const EMP = 'emp-1';
const MOT = 'mot-1';
const SESS = 'sess-1';
const DEV = 'device-abc';

function credOk(over = {}) {
  return {
    id: 'cred-1', motorista_id: MOT, empresa_id: EMP, session_id: SESS, device_id: DEV, frete_id: 'frete-1',
    expires_at: new Date(AGORA + 3600 * 1000).toISOString(),
    max_expires_at: new Date(AGORA + 7 * 86400 * 1000).toISOString(),
    revoked_at: null,
    ...over,
  };
}
const usuarioOk = (o = {}) => ({ id: MOT, status: 'ativo', empresa_id: EMP, ...o });
const sessaoOk = (o = {}) => ({ id: SESS, revoked_at: null, ...o });
function avaliar(over = {}) {
  return avaliarCredencial({ credencial: credOk(), usuario: usuarioOk(), sessao: sessaoOk(), temEscopoAtivo: true, deviceId: DEV, agoraMs: AGORA, ...over });
}

test('calcularExpiracao respeita TTL e o teto (maxMs)', () => {
  assert.equal(Date.parse(calcularExpiracao(AGORA, 3600)), AGORA + 3600 * 1000);
  assert.equal(Date.parse(calcularExpiracao(AGORA, 86400, AGORA + 1000)), AGORA + 1000);
});
test('calcularMaxExpiracao = issued + maxLifetime', () => {
  assert.equal(Date.parse(calcularMaxExpiracao(AGORA, 604800)), AGORA + 604800 * 1000);
});

test('tudo canônico válido + tem viagem ativa → ok (escopo motorista/empresa, sem frete)', () => {
  const r = avaliar();
  assert.equal(r.ok, true);
  assert.equal(r.identidade.uid, MOT);
  assert.equal(r.identidade.empresa_id, EMP);
  assert.equal(r.identidade.frete_id, undefined); // multi-viagem: sem binding por-viagem
  assert.equal(r.identidade.role, 'motorista');
});

test('credencial ausente/revogada', () => {
  assert.equal(avaliar({ credencial: null }).code, 'tracking_credential_invalid');
  assert.equal(avaliarCredencial({ credencial: credOk({ revoked_at: new Date(AGORA).toISOString() }), usuario: usuarioOk(), sessao: sessaoOk(), temEscopoAtivo: true, deviceId: DEV, agoraMs: AGORA }).code, 'tracking_credential_revoked');
});

test('teto absoluto ultrapassado → max_lifetime (nem renovação recupera)', () => {
  const cred = credOk({ max_expires_at: new Date(AGORA - 1000).toISOString(), expires_at: new Date(AGORA - 2000).toISOString() });
  const base = { credencial: cred, usuario: usuarioOk(), sessao: sessaoOk(), temEscopoAtivo: true, deviceId: DEV, agoraMs: AGORA };
  assert.equal(avaliarCredencial({ ...base }).code, 'tracking_credential_max_lifetime');
  assert.equal(avaliarCredencial({ ...base, permitirExpirada: true }).code, 'tracking_credential_max_lifetime');
});

test('expirada bloqueia telemetria mas é aceita na RENOVAÇÃO (dentro do teto)', () => {
  const cred = credOk({ expires_at: new Date(AGORA - 1000).toISOString() });
  const base = { credencial: cred, usuario: usuarioOk(), sessao: sessaoOk(), temEscopoAtivo: true, deviceId: DEV, agoraMs: AGORA };
  assert.equal(avaliarCredencial({ ...base }).code, 'tracking_credential_expired');
  assert.equal(avaliarCredencial({ ...base, permitirExpirada: true }).ok, true);
});

test('sessão ausente ou revogada → session_revoked (§5 não olha idle/absolute)', () => {
  assert.equal(avaliar({ sessao: null }).code, 'tracking_session_revoked');
  assert.equal(avaliar({ sessao: sessaoOk({ revoked_at: new Date(AGORA).toISOString() }) }).code, 'tracking_session_revoked');
  assert.equal(avaliar({ sessao: sessaoOk({ idle_expires_at: new Date(AGORA - 1e7).toISOString(), absolute_expires_at: new Date(AGORA - 1e6).toISOString() }) }).ok, true);
});

test('motorista bloqueado/mudança de empresa', () => {
  assert.equal(avaliar({ usuario: null }).code, 'tracking_driver_blocked');
  assert.equal(avaliar({ usuario: usuarioOk({ status: 'bloqueado' }) }).code, 'tracking_driver_blocked');
  assert.equal(avaliar({ usuario: usuarioOk({ empresa_id: 'outra' }) }).code, 'tracking_tenant_mismatch');
  assert.equal(avaliar({ usuario: usuarioOk({ id: 'outro' }) }).code, 'tracking_tenant_mismatch');
});

test('device binding (§M-1): device ausente/errado → device_mismatch', () => {
  assert.equal(avaliar({ deviceId: null }).code, 'tracking_device_mismatch');
  assert.equal(avaliar({ deviceId: 'outro-device' }).code, 'tracking_device_mismatch');
});

test('contexto operacional (§H-3 multi-viagem): sem viagem ativa → trip_inactive', () => {
  assert.equal(avaliar({ temEscopoAtivo: false }).code, 'tracking_trip_inactive');
  // com >=1 viagem ativa (o motorista pode ter VÁRIAS) → ok
  assert.equal(avaliar({ temEscopoAtivo: true }).ok, true);
});

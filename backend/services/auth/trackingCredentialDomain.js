// backend/services/auth/trackingCredentialDomain.js — decisões PURAS da credencial de
// rastreamento (SEC-1 / Opção C). Sem Express, sem Supabase, sem relógio implícito.
//
// Concentra "esta credencial pode operar AGORA?" de forma determinística. O serviço
// (I/O) carrega as linhas canônicas do banco e delega aqui.
//
// PRINCÍPIO SEC-1 (§5/§12): a expiração NATURAL do access/idle/ABSOLUTE da sessão de UI
// NÃO interrompe o rastreamento — por isso NÃO olhamos idle/absolute da sessão aqui.
// Só a REVOGAÇÃO EXPLÍCITA (logout/admin) importa: sessao.revoked_at.
//
// A validação é CANÔNICA e NÃO depende de hooks best-effort: checa credencial, teto
// absoluto, sessão emissora, motorista, empresa (tenant), DEVICE e a VIAGEM vinculada
// (existe, é a mesma, pertence ao motorista/empresa e ainda está ATIVA).

const STATUS_MOTORISTA_ATIVO = new Set(['ativo']);
const STATUS_FRETE_ATIVO = new Set(['ativo', 'em_viagem', 'em_andamento']);

function msDe(x) {
  const t = new Date(x).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Expiração = agora + ttl, limitada ao teto absoluto (maxMs). Retorna ISO. */
function calcularExpiracao(agoraMs, ttlSeconds, maxMs) {
  const alvo = agoraMs + ttlSeconds * 1000;
  const efetivo = typeof maxMs === 'number' ? Math.min(alvo, maxMs) : alvo;
  return new Date(efetivo).toISOString();
}

/** Teto absoluto = issued + maxLifetime. */
function calcularMaxExpiracao(issuedMs, maxLifetimeSeconds) {
  return new Date(issuedMs + maxLifetimeSeconds * 1000).toISOString();
}

/**
 * Avalia a credencial. Entradas (todas canônicas do banco):
 *   credencial: { id, motorista_id, empresa_id, frete_id, session_id, device_id,
 *                 expires_at, max_expires_at, revoked_at }
 *   usuario:    { id, status, empresa_id }
 *   sessao:     { id, revoked_at }
 *   frete:      { id, status, empresa_id, motorista_id }
 *   deviceId:   device apresentado na requisição (header)
 *   agoraMs:    epoch atual (injetável)
 *   permitirExpirada: true no fluxo de RENOVAÇÃO (aceita expires_at vencido, mas nunca
 *                     além do teto absoluto). false na telemetria normal.
 * Retorna { ok:true, identidade } ou { ok:false, code } (code = contrato semântico).
 */
function avaliarCredencial({ credencial, usuario, sessao, frete, deviceId, agoraMs, permitirExpirada = false }) {
  if (!credencial) return neg('tracking_credential_invalid');
  if (credencial.revoked_at) return neg('tracking_credential_revoked');

  // Teto ABSOLUTO: uma vez ultrapassado, nem a renovação recupera (§H-2).
  const max = msDe(credencial.max_expires_at);
  if (max === null || agoraMs > max) return neg('tracking_credential_max_lifetime');

  // Expiração NOMINAL: bloqueia telemetria; a renovação (permitirExpirada) a ignora,
  // desde que dentro do teto absoluto já checado acima.
  if (!permitirExpirada) {
    const exp = msDe(credencial.expires_at);
    if (exp === null || exp <= agoraMs) return neg('tracking_credential_expired');
  }

  // Sessão SEC-1 emissora: revogação EXPLÍCITA (logout/admin) invalida. Expiração
  // natural (idle/absolute) NÃO é checada aqui (decisão §5/§12). FK CASCADE garante
  // que sessão apagada some junto com a credencial → ausência = tratada como revogada.
  if (!sessao || sessao.revoked_at) return neg('tracking_session_revoked');

  if (!usuario) return neg('tracking_driver_blocked');
  if (!STATUS_MOTORISTA_ATIVO.has(String(usuario.status || '').toLowerCase())) {
    return neg('tracking_driver_blocked');
  }
  if (String(usuario.empresa_id) !== String(credencial.empresa_id)) return neg('tracking_tenant_mismatch');
  if (String(usuario.id) !== String(credencial.motorista_id)) return neg('tracking_tenant_mismatch');

  // DEVICE BINDING (§M-1): o device apresentado tem de bater com o da emissão.
  if (!deviceId || String(deviceId) !== String(credencial.device_id)) return neg('tracking_device_mismatch');

  // VIAGEM VINCULADA (§H-3): existe, é a MESMA, pertence ao motorista/empresa e ativa.
  if (!frete || String(frete.id) !== String(credencial.frete_id)) return neg('tracking_trip_mismatch');
  if (String(frete.empresa_id) !== String(credencial.empresa_id) ||
      String(frete.motorista_id) !== String(credencial.motorista_id)) {
    return neg('tracking_tenant_mismatch');
  }
  if (!STATUS_FRETE_ATIVO.has(String(frete.status || '').toLowerCase())) return neg('tracking_trip_inactive');

  return {
    ok: true,
    identidade: {
      uid: credencial.motorista_id,
      empresa_id: credencial.empresa_id,
      frete_id: credencial.frete_id,
      role: 'motorista',
      is_super_admin: false,
    },
  };
}

function neg(code) { return { ok: false, code }; }

module.exports = {
  calcularExpiracao, calcularMaxExpiracao, avaliarCredencial,
  STATUS_MOTORISTA_ATIVO, STATUS_FRETE_ATIVO,
};

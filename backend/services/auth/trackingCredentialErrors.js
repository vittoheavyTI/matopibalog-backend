// backend/services/auth/trackingCredentialErrors.js — CONTRATO SEMÂNTICO de erros da
// credencial de rastreamento (SEC-1 / Opção C). Reusa a base AuthError.
//
// O `code` (campo `error` no JSON) é CONTRATO com o serviço nativo (Kotlin), que
// decide o comportamento por CÓDIGO — nunca só pelo status HTTP:
//   RECUPERÁVEL (renovar/rotacionar; NÃO descartar fila):
//     tracking_credential_expired · tracking_credential_rotated
//   DEFINITIVO (encerra; NUNCA descarta fila — só remove ponto em 2xx):
//     tracking_credential_invalid · tracking_credential_revoked ·
//     tracking_credential_max_lifetime · tracking_session_revoked ·
//     tracking_driver_blocked · tracking_tenant_mismatch · tracking_device_mismatch ·
//     tracking_trip_inactive · tracking_trip_mismatch
//   TRANSITÓRIO (não encerra; mantém fila): tracking_unavailable (503) + rede/5xx/408/429.
//
// NUNCA inclui token/hash/SQL/segredo na mensagem pública.

const { AuthError } = require('./authErrors');

// code → { http, msg }
const CATALOGO = {
  tracking_credential_invalid:      { http: 401, msg: 'Credencial de rastreamento inválida.' },
  tracking_credential_expired:      { http: 401, msg: 'Credencial de rastreamento expirada.' },
  tracking_credential_rotated:      { http: 409, msg: 'Credencial de rastreamento rotacionada. Reobtenha o estado.' },
  tracking_credential_max_lifetime: { http: 401, msg: 'Credencial de rastreamento além do tempo máximo. Reative pelo app.' },
  tracking_credential_revoked:      { http: 401, msg: 'Credencial de rastreamento revogada.' },
  tracking_session_revoked:         { http: 401, msg: 'Sessão encerrada. Reative o rastreamento pelo app.' },
  tracking_driver_blocked:          { http: 403, msg: 'Motorista bloqueado.' },
  tracking_tenant_mismatch:         { http: 403, msg: 'Credencial fora do escopo autorizado.' },
  tracking_device_mismatch:         { http: 403, msg: 'Credencial vinculada a outro dispositivo.' },
  tracking_trip_inactive:           { http: 409, msg: 'Viagem não está mais ativa.' },
  tracking_trip_mismatch:           { http: 403, msg: 'Credencial vinculada a outra viagem.' },
  tracking_disabled:                { http: 404, msg: 'Rastreamento escopado indisponível.' },
  tracking_unavailable:             { http: 503, msg: 'Serviço de rastreamento temporariamente indisponível.' },
};

// Só estes NÃO são definitivos para o serviço nativo.
const RECUPERAVEIS = Object.freeze(['tracking_credential_expired', 'tracking_credential_rotated']);
const TRANSITORIOS = Object.freeze(['tracking_unavailable']);
const CODES_DEFINITIVOS = Object.freeze(
  Object.keys(CATALOGO).filter((c) => !RECUPERAVEIS.includes(c) && !TRANSITORIOS.includes(c) && c !== 'tracking_disabled'),
);

class TrackingError extends AuthError {
  constructor(code, internalCause) {
    const entry = CATALOGO[code] || CATALOGO.tracking_credential_invalid;
    super(code in CATALOGO ? code : 'tracking_credential_invalid', entry.http, entry.msg, internalCause);
  }
}

/** Cria o erro tipado a partir do code semântico. */
function erroDeCode(code, internalCause) {
  return new TrackingError(code, internalCause);
}

module.exports = {
  TrackingError, erroDeCode, CATALOGO,
  CODES_DEFINITIVOS, RECUPERAVEIS, TRANSITORIOS,
};

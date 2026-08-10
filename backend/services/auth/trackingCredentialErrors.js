// backend/services/auth/trackingCredentialErrors.js — erros de domínio da credencial
// de rastreamento (SEC-1 / Opção C). Reusa a base AuthError (code/httpStatus/toPublic).
//
// O `code` é CONTRATO com o serviço nativo (Kotlin): ele decide parar (stopSelf) só em
// erros DEFINITIVOS; erros TRANSITÓRIOS preservam a fila e NÃO param o rastreamento.
//   DEFINITIVOS  → credential_invalid | credential_expired | credential_revoked |
//                  driver_blocked | tracking_scope_forbidden
//   TRANSITÓRIOS → tracking_unavailable (503) e qualquer 5xx/timeout de rede.
//
// NUNCA inclui token/hash/SQL/segredo na mensagem pública.

const { AuthError } = require('./authErrors');

function definir(code, httpStatus, publicMessage) {
  return class extends AuthError {
    constructor(internalCause) { super(code, httpStatus, publicMessage, internalCause); }
  };
}

// Definitivos (o serviço nativo deve encerrar de forma controlada)
const TrackingCredentialInvalid = definir('credential_invalid', 401, 'Credencial de rastreamento inválida.');
const TrackingCredentialExpired = definir('credential_expired', 401, 'Credencial de rastreamento expirada.');
const TrackingCredentialRevoked = definir('credential_revoked', 401, 'Credencial de rastreamento revogada.');
const TrackingDriverBlocked     = definir('driver_blocked', 403, 'Motorista bloqueado ou desvinculado.');
const TrackingScopeForbidden    = definir('tracking_scope_forbidden', 403, 'Credencial fora do escopo autorizado.');
const TrackingDisabled          = definir('tracking_disabled', 404, 'Rastreamento escopado indisponível.');

// Transitório (NÃO parar; preservar fila e tentar de novo)
const TrackingDependencyUnavailable = definir('tracking_unavailable', 503, 'Serviço de rastreamento temporariamente indisponível.');

// Conjunto de codes DEFINITIVOS — usado por testes/documentação e espelhado no Kotlin.
const CODES_DEFINITIVOS = Object.freeze([
  'credential_invalid', 'credential_expired', 'credential_revoked',
  'driver_blocked', 'tracking_scope_forbidden',
]);

module.exports = {
  TrackingCredentialInvalid, TrackingCredentialExpired, TrackingCredentialRevoked,
  TrackingDriverBlocked, TrackingScopeForbidden, TrackingDisabled,
  TrackingDependencyUnavailable,
  CODES_DEFINITIVOS,
};

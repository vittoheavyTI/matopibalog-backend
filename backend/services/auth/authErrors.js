// backend/services/auth/authErrors.js — erros de domínio tipados (SEC-1).
//
// Cada erro tem: code interno, httpStatus sugerido, mensagem PÚBLICA sanitizada e
// causa interna NÃO-serializável (não vaza em JSON/log). NUNCA inclui SQL, nome de
// tabela, hash, token, segredo ou payload bruto na mensagem pública.
//
// O serviço mapeia o RESULTADO ESTRUTURADO da RPC (não parsing frágil de SQL) para
// estes erros. O middleware/rotas convertem httpStatus → resposta HTTP.

class AuthError extends Error {
  constructor(code, httpStatus, publicMessage, internalCause) {
    super(publicMessage);
    this.name = code;
    this.code = code;
    this.httpStatus = httpStatus;
    this.publicMessage = publicMessage;
    // causa interna: presente para logs internos controlados, mas NÃO enumerável
    // (não aparece em JSON.stringify nem em spreads acidentais).
    Object.defineProperty(this, 'internalCause', { value: internalCause ?? null, enumerable: false, writable: false });
  }
  /** Payload público seguro (sem causa interna). */
  toPublic() { return { error: this.code, message: this.publicMessage }; }
}

function definir(code, httpStatus, publicMessage) {
  return class extends AuthError {
    constructor(internalCause) { super(code, httpStatus, publicMessage, internalCause); }
  };
}

// Refresh / rotação
const RefreshInvalid        = definir('RefreshInvalid', 401, 'Sessão inválida. Faça login novamente.');
const RefreshExpired        = definir('RefreshExpired', 401, 'Sua sessão expirou. Faça login novamente.');
const RefreshRevoked        = definir('RefreshRevoked', 401, 'Sessão encerrada. Faça login novamente.');
const RefreshAlreadyRotated = definir('RefreshAlreadyRotated', 409, 'Requisição concorrente de renovação. Tente novamente.');
const RefreshReuseDetected  = definir('RefreshReuseDetected', 401, 'Sessão encerrada por segurança. Faça login novamente.');
// Sessão
const SessionNotFound        = definir('SessionNotFound', 401, 'Sessão não encontrada. Faça login novamente.');
const SessionRevoked         = definir('SessionRevoked', 401, 'Sessão encerrada. Faça login novamente.');
const SessionIdleExpired     = definir('SessionIdleExpired', 401, 'Sessão expirada por inatividade. Faça login novamente.');
const SessionAbsoluteExpired = definir('SessionAbsoluteExpired', 401, 'Sessão expirada. Faça login novamente.');
const SessionInvalid         = definir('SessionInvalid', 401, 'Sessão inválida. Faça login novamente.');
const SessionConflict        = definir('SessionConflict', 409, 'Conflito de sessão. Tente novamente.');
// Infra
const SessionDependencyUnavailable = definir('SessionDependencyUnavailable', 503, 'Serviço de autenticação temporariamente indisponível. Tente novamente em instantes.');

const POR_RESULTADO = {
  refresh_already_rotated: RefreshAlreadyRotated,
  reuse_detected: RefreshReuseDetected,
  expirado: RefreshExpired,
  revogado: RefreshRevoked,
  invalido: RefreshInvalid,
  sessao_invalida: SessionInvalid,
};

/**
 * Converte o `resultado` estruturado da RPC rotacionar_refresh_token em erro de
 * domínio. Retorna null quando 'ok' (sucesso — sem erro).
 */
function erroDeResultadoRotacao(resultado, internalCause) {
  if (resultado === 'ok') return null;
  const Klass = POR_RESULTADO[resultado];
  if (!Klass) return new RefreshInvalid(internalCause || `resultado desconhecido: ${resultado}`);
  return new Klass(internalCause);
}

module.exports = {
  AuthError,
  RefreshInvalid, RefreshExpired, RefreshRevoked, RefreshAlreadyRotated, RefreshReuseDetected,
  SessionNotFound, SessionRevoked, SessionIdleExpired, SessionAbsoluteExpired, SessionInvalid, SessionConflict,
  SessionDependencyUnavailable,
  erroDeResultadoRotacao,
};

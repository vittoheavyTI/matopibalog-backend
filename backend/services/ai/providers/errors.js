'use strict';

// Classes de erro normalizadas do provider (contrato estável, provider-agnóstico).
// NUNCA carregam secret nem internals do vendor.
const PROVIDER_ERROR = Object.freeze({
  DISABLED: 'DISABLED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
});

// Mensagens pt-BR seguras exibidas ao usuário (sem internals).
const USER_MESSAGE = Object.freeze({
  DISABLED: 'O assistente ainda não está habilitado.',
  NOT_CONFIGURED: 'O assistente ainda não está configurado.',
  TIMEOUT: 'O assistente demorou para responder. Tente novamente.',
  RATE_LIMIT: 'O assistente está com muitas solicitações agora. Tente em instantes.',
  UPSTREAM_ERROR: 'O assistente está indisponível no momento.',
  INVALID_RESPONSE: 'Não foi possível interpretar a resposta do assistente.',
});

class AIProviderError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'AIProviderError';
    this.code = PROVIDER_ERROR[code] ? code : PROVIDER_ERROR.UPSTREAM_ERROR;
    // detail é interno (log), NUNCA vai ao usuário nem ao modelo.
    this.detail = detail || null;
  }

  get userMessage() {
    return USER_MESSAGE[this.code] || USER_MESSAGE.UPSTREAM_ERROR;
  }
}

module.exports = { PROVIDER_ERROR, USER_MESSAGE, AIProviderError };

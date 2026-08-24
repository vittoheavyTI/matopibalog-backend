'use strict';

const ROUTE_PROVIDER_ERROR = Object.freeze({
  DISABLED: 'DISABLED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
});

const USER_MESSAGE = Object.freeze({
  DISABLED: 'O provedor de rotas não está habilitado. Você pode informar os dados manualmente.',
  NOT_CONFIGURED: 'O provedor de rotas não está configurado. Você pode informar os dados manualmente.',
  TIMEOUT: 'O provedor de rotas demorou para responder. Tente novamente ou informe os dados manualmente.',
  RATE_LIMIT: 'O provedor de rotas está ocupado agora. Tente em instantes ou informe os dados manualmente.',
  UPSTREAM_ERROR: 'O provedor de rotas está indisponível. Você pode informar os dados manualmente.',
  INVALID_RESPONSE: 'Não foi possível interpretar a resposta do provedor de rotas.',
});

class RouteProviderError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'RouteProviderError';
    this.code = ROUTE_PROVIDER_ERROR[code] ? code : ROUTE_PROVIDER_ERROR.UPSTREAM_ERROR;
    this.detail = detail || null; // interno; nunca ao usuário
  }

  get userMessage() {
    return USER_MESSAGE[this.code] || USER_MESSAGE.UPSTREAM_ERROR;
  }
}

module.exports = { ROUTE_PROVIDER_ERROR, USER_MESSAGE, RouteProviderError };

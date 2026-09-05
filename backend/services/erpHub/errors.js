'use strict';

// Erros tipados do ERP Integration Hub. Nunca vazam segredo/PII: `detail` é
// interno e nunca vai ao usuário; `userMessage` é sempre genérica e segura.
//
// Invariante central da frente: provider desabilitado / capability desconhecida
// falham EXPLICITAMENTE. Nunca existe um caminho que finja sucesso.

const ERP_PROVIDER_ERROR = Object.freeze({
  DISABLED: 'DISABLED',                       // não há provider (default de produção)
  NOT_CONFIGURED: 'NOT_CONFIGURED',           // provider existiria, mas falta config/secret
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY', // capability não declarada pelo provider
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',       // envelope canônico inválido/insanitizável
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
});

const USER_MESSAGE = Object.freeze({
  DISABLED: 'A integração com ERP ainda não está disponível.',
  NOT_CONFIGURED: 'A integração com ERP ainda não está configurada.',
  UNSUPPORTED_CAPABILITY: 'Esta operação não é suportada pela integração de ERP.',
  INVALID_ENVELOPE: 'Os dados enviados para a integração de ERP são inválidos.',
  TIMEOUT: 'A integração de ERP demorou para responder. Tente novamente.',
  RATE_LIMIT: 'A integração de ERP está ocupada agora. Tente em instantes.',
  UPSTREAM_ERROR: 'A integração de ERP está indisponível no momento.',
  INVALID_RESPONSE: 'Não foi possível interpretar a resposta da integração de ERP.',
});

class ErpProviderError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'ErpProviderError';
    this.code = ERP_PROVIDER_ERROR[code] ? code : ERP_PROVIDER_ERROR.UPSTREAM_ERROR;
    this.detail = detail || null; // interno; NUNCA exposto ao usuário
  }

  get userMessage() {
    return USER_MESSAGE[this.code] || USER_MESSAGE.UPSTREAM_ERROR;
  }
}

module.exports = { ERP_PROVIDER_ERROR, USER_MESSAGE, ErpProviderError };

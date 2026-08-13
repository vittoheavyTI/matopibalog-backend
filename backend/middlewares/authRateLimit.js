const rateLimit = require('express-rate-limit');

function criarRefreshLimiter({ windowMs = 15 * 60 * 1000, max = 30 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Muitas tentativas de renovacao de sessao. Tente novamente em alguns minutos.' },
  });
}

module.exports = { criarRefreshLimiter };

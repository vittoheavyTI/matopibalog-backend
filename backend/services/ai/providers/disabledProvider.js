'use strict';

const { AIProviderError, PROVIDER_ERROR } = require('./errors');

// Provider inerte (default de produção). Nunca chama nada.
const disabledProvider = {
  name: 'disabled',
  async generate() {
    throw new AIProviderError(PROVIDER_ERROR.DISABLED, 'provider disabled by config');
  },
};

module.exports = { disabledProvider };

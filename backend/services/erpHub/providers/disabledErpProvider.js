'use strict';

// Provider inerte — DEFAULT DE PRODUÇÃO. Não conhece nenhuma capability e nunca
// executa nada. Toda operação falha EXPLICITAMENTE com DISABLED: jamais finge
// sucesso, jamais toca em rede. Esta é a garantia de que a frente é inerte em prod.

const { ErpProviderError, ERP_PROVIDER_ERROR } = require('../errors');

const disabledErpProvider = {
  name: 'disabled',
  // Nenhuma capability declarada → nada é suportado.
  capabilities() {
    return [];
  },
  async send() {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.DISABLED, 'erp provider disabled by config');
  },
  async lookup() {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.DISABLED, 'erp provider disabled by config');
  },
  async reconcile() {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.DISABLED, 'erp provider disabled by config');
  },
};

module.exports = { disabledErpProvider };

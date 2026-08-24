'use strict';

const { RouteProviderError, ROUTE_PROVIDER_ERROR } = require('./errors');

// Provider inerte (default de produção). Nunca chama nada. Entrada MANUAL do
// serviço continua funcionando independentemente deste provider.
const disabledRouteProvider = {
  name: 'disabled',
  async calculate() {
    throw new RouteProviderError(ROUTE_PROVIDER_ERROR.DISABLED, 'route provider disabled by config');
  },
};

module.exports = { disabledRouteProvider };

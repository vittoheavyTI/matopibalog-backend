'use strict';

// RouteProviderGateway — ponto único de acesso ao provedor de rotas. Seleciona pelo
// modo e expõe contrato estável e provider-agnostic. Não importa supabase.
// calculate({ origin, destination }) → resultado normalizado ou RouteProviderError.

const { MODES, resolveMode } = require('./config');
const { disabledRouteProvider } = require('./providers/disabledRouteProvider');
const { fakeRouteProvider } = require('./providers/fakeRouteProvider');
const { httpRouteProvider } = require('./providers/httpRouteProvider');

function selectProvider(mode = resolveMode()) {
  switch (mode) {
    case MODES.FAKE: return fakeRouteProvider;
    case MODES.HTTP: return httpRouteProvider;
    default: return disabledRouteProvider;
  }
}

async function calculate(input, { mode } = {}) {
  return selectProvider(mode || resolveMode()).calculate(input);
}

module.exports = { selectProvider, calculate, fakeRouteProvider };

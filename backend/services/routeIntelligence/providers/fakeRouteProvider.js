'use strict';

const crypto = require('node:crypto');
const { RouteProviderError, ROUTE_PROVIDER_ERROR } = require('./errors');

// Provider FAKE determinístico (testes/dev). NENHUMA chamada externa.
// Distância derivada de hash estável de origem+destino (mesma entrada → mesma
// saída). NÃO fabrica pedágio (tolls null) nem restrições de caminhão
// (UNAVAILABLE) — só o que um roteamento simples "provaria".
//
// Roteirizável para erros de teste via setFailure(code).

let forcedFailure = null;
function setFailure(code) { forcedFailure = code || null; }
function reset() { forcedFailure = null; }

const fakeRouteProvider = {
  name: 'fake',
  setFailure,
  reset,
  async calculate({ origin, destination }) {
    if (forcedFailure) throw new RouteProviderError(ROUTE_PROVIDER_ERROR[forcedFailure] || ROUTE_PROVIDER_ERROR.UPSTREAM_ERROR, 'fake failure');
    const seed = crypto.createHash('sha256').update(`${origin}->${destination}`).digest();
    const distance_km = 50 + (seed.readUInt16BE(0) % 1450); // 50..1499 determinístico
    const avgKmH = 60;
    const duration_minutes = Math.round((distance_km / avgKmH) * 60);
    return {
      provider: 'fake',
      distance_km,
      duration_minutes,
      tolls_amount: null, // fake não inventa pedágio
      truck_restrictions_status: 'UNAVAILABLE',
    };
  },
};

module.exports = { fakeRouteProvider };

'use strict';

// Route Intelligence V1 — configuração schema-free, provider-agnostic, production-inert.
//
//   ROUTE_PROVIDER_MODE = disabled | fake | http
//     disabled (default de produção) → nenhum provider externo; entrada MANUAL ainda
//                                       funciona (V1 é útil sem provider, §76/§102).
//     fake     → provider determinístico (testes/dev). Nenhuma chamada externa.
//     http     → adapter HTTP genérico (OSRM-compatível). Exige ROUTE_PROVIDER_URL.
//                Sem URL → NOT_CONFIGURED. NUNCA ativado em produção nesta frente.
//
// Nenhum secret é necessário para o adapter genérico (OSRM público é sem key), mas
// nada é ativado por padrão. Sem mudar env do Railway nesta frente.

const MODES = Object.freeze({ DISABLED: 'disabled', FAKE: 'fake', HTTP: 'http' });

const LIMITS = Object.freeze({
  MAX_TEXT: 240,           // origem/destino texto
  MAX_DISTANCE_KM: 100000, // teto sanidade
  MAX_CONSUMPTION: 100,    // km/L
  MAX_FUEL_PRICE: 100,     // R$/L
  PROVIDER_TIMEOUT_MS: 8000,
});

function resolveMode() {
  const raw = String(process.env.ROUTE_PROVIDER_MODE || '').trim().toLowerCase();
  if (raw === MODES.FAKE) return MODES.FAKE;
  if (raw === MODES.HTTP) return MODES.HTTP;
  return MODES.DISABLED;
}

function providerAvailable(mode = resolveMode()) {
  if (mode === MODES.FAKE) return true;
  if (mode === MODES.HTTP) return Boolean(process.env.ROUTE_PROVIDER_URL);
  return false;
}

module.exports = { MODES, LIMITS, resolveMode, providerAvailable };

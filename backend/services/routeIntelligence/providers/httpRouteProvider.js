'use strict';

const axios = require('axios');
const { RouteProviderError, ROUTE_PROVIDER_ERROR } = require('./errors');
const { LIMITS } = require('../config');

// Adapter HTTP genérico, provider-agnostic. PRONTO para habilitação futura, sem
// key hardcoded e SEM ativação nesta frente. Espera um endpoint configurado
// (`ROUTE_PROVIDER_URL`) que aceite origin/destination e devolva um contrato
// normalizado { distance_km, duration_minutes, tolls_amount?, truck_restrictions_status? }.
// A camada de negócio NÃO conhece o formato do vendor — só este adapter normaliza.
// NUNCA chamado em produção (mode=disabled por padrão) nem em testes (usa fake).
// Não faz scraping de mapas.

const httpRouteProvider = {
  name: 'http',
  async calculate({ origin, destination }) {
    const baseUrl = process.env.ROUTE_PROVIDER_URL;
    if (!baseUrl) throw new RouteProviderError(ROUTE_PROVIDER_ERROR.NOT_CONFIGURED, 'missing ROUTE_PROVIDER_URL');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ROUTE_PROVIDER_API_KEY) headers.Authorization = `Bearer ${process.env.ROUTE_PROVIDER_API_KEY}`;

    let resp;
    try {
      resp = await axios.post(baseUrl, { origin, destination }, { headers, timeout: LIMITS.PROVIDER_TIMEOUT_MS });
    } catch (err) {
      if (err.code === 'ECONNABORTED') throw new RouteProviderError(ROUTE_PROVIDER_ERROR.TIMEOUT, 'provider timeout');
      const status = err.response?.status;
      if (status === 429) throw new RouteProviderError(ROUTE_PROVIDER_ERROR.RATE_LIMIT, 'rate limited');
      throw new RouteProviderError(ROUTE_PROVIDER_ERROR.UPSTREAM_ERROR, `upstream status ${status || 'unknown'}`);
    }

    const d = resp.data || {};
    const distance_km = Number(d.distance_km);
    const duration_minutes = Number(d.duration_minutes);
    if (!Number.isFinite(distance_km) || !Number.isFinite(duration_minutes)) {
      throw new RouteProviderError(ROUTE_PROVIDER_ERROR.INVALID_RESPONSE, 'missing distance/duration');
    }
    return {
      provider: String(d.provider || 'http'),
      distance_km,
      duration_minutes,
      tolls_amount: Number.isFinite(Number(d.tolls_amount)) ? Number(d.tolls_amount) : null,
      truck_restrictions_status: d.truck_restrictions_status || 'UNAVAILABLE',
    };
  },
};

module.exports = { httpRouteProvider };

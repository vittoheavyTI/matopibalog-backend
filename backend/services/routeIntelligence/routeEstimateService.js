'use strict';

// Serviço de estimativa de rota (READ-ONLY, sem persistência). Orquestra:
//   1) fonte da distância/duração/pedágio: MANUAL (se informado) tem prioridade;
//      senão o provider (via gateway); se provider falhar → UNAVAILABLE + fallback manual.
//   2) combustível: só quando distância + consumo + preço são AUTORITATIVOS (todos
//      inputs explícitos). Nunca inventa consumo/preço (§84/§85). Senão UNAVAILABLE.
//   3) custo: soma apenas valores conhecidos (combustível + pedágio + outros conhecidos);
//      marca parcial quando algum componente é desconhecido (§86).
//
// Contrato normalizado (§74/§75): unknown != zero.

const { resolveMode, MODES, LIMITS } = require('./config');
const gateway = require('./routeProviderGateway');
const { RouteProviderError, ROUTE_PROVIDER_ERROR } = require('./providers/errors');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// PURO: estimativa de combustível. Retorna { status, liters, cost } — status KNOWN
// só quando os 3 inputs são válidos e positivos.
function estimateFuel({ distanceKm, consumptionKmPerLiter, fuelPricePerLiter }) {
  const d = num(distanceKm);
  const c = num(consumptionKmPerLiter);
  const p = num(fuelPricePerLiter);
  if (d == null || d <= 0) return { status: 'UNAVAILABLE', reason: 'distance_unknown', liters: null, cost: null };
  if (c == null || c <= 0) return { status: 'UNAVAILABLE', reason: 'consumption_not_provided', liters: null, cost: null };
  if (p == null || p <= 0) return { status: 'UNAVAILABLE', reason: 'fuel_price_not_provided', liters: null, cost: null };
  const liters = d / c;
  return { status: 'KNOWN', liters: round2(liters), cost: round2(liters * p) };
}

// PURO: custo total parcial-aware. Soma só conhecidos.
function estimateCost({ fuelCost, tollsAmount, otherKnownCost }) {
  const parts = [];
  let partial = false;
  const fuel = num(fuelCost);
  const tolls = num(tollsAmount);
  const other = num(otherKnownCost);
  if (fuel != null) parts.push(fuel); else partial = true;
  if (tolls != null) parts.push(tolls); else partial = true;
  if (other != null) parts.push(other);
  const total = parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null;
  return {
    fuel_cost: fuel,
    tolls_cost: tolls, // null = desconhecido, NÃO zero
    other_known_cost: other,
    estimated_route_cost: total,
    partial,
  };
}

function validText(v) {
  const s = String(v || '').trim();
  return s.length && s.length <= LIMITS.MAX_TEXT ? s : null;
}

// Estimativa completa. `input`:
//   origin, destination (texto),
//   manual { distance_km, duration_minutes, tolls_amount } (opcional),
//   params { consumption_km_per_liter, fuel_price_per_liter, other_known_cost } (opcional).
async function estimateRoute(input = {}) {
  const origin = validText(input.origin);
  const destination = validText(input.destination);
  if (!origin || !destination) {
    return { ok: false, error: 'invalid_input', message: 'Informe origem e destino.' };
  }

  const manual = input.manual || {};
  const manualDistance = num(manual.distance_km);
  const hasManual = manualDistance != null && manualDistance > 0;

  let route;
  const warnings = [];
  if (hasManual) {
    route = {
      route_source: 'MANUAL',
      provider: null,
      distance_km: round2(manualDistance),
      duration_minutes: num(manual.duration_minutes),
      tolls_amount: num(manual.tolls_amount), // null = desconhecido
      truck_restrictions_status: 'UNAVAILABLE',
      availability: 'AVAILABLE',
    };
  } else {
    const mode = resolveMode();
    try {
      const r = await gateway.calculate({ origin, destination }, { mode });
      route = {
        route_source: 'PROVIDER',
        provider: r.provider,
        distance_km: round2(r.distance_km),
        duration_minutes: r.duration_minutes,
        tolls_amount: r.tolls_amount ?? null,
        truck_restrictions_status: r.truck_restrictions_status || 'UNAVAILABLE',
        availability: 'AVAILABLE',
      };
    } catch (err) {
      const code = err instanceof RouteProviderError ? err.code : ROUTE_PROVIDER_ERROR.UPSTREAM_ERROR;
      const message = err instanceof RouteProviderError ? err.userMessage : 'Provedor de rotas indisponível.';
      warnings.push(message);
      route = {
        route_source: 'UNAVAILABLE',
        provider: null,
        distance_km: null,
        duration_minutes: null,
        tolls_amount: null,
        truck_restrictions_status: 'UNAVAILABLE',
        availability: 'UNAVAILABLE',
        error_class: code,
        manual_fallback_supported: true, // §76: pode informar manualmente
      };
    }
  }

  const params = input.params || {};
  const fuel = estimateFuel({
    distanceKm: route.distance_km,
    consumptionKmPerLiter: params.consumption_km_per_liter,
    fuelPricePerLiter: params.fuel_price_per_liter,
  });
  const cost = estimateCost({
    fuelCost: fuel.cost,
    tollsAmount: route.tolls_amount,
    otherKnownCost: params.other_known_cost,
  });

  if (route.duration_minutes != null) {
    warnings.push('Duração é estimativa de rota do provedor, não um prazo legal (não considera janelas/descanso).');
  }
  if (route.truck_restrictions_status === 'UNAVAILABLE' && route.availability === 'AVAILABLE') {
    warnings.push('Restrições para caminhão não confirmadas nesta fonte.');
  }

  return {
    ok: true,
    origin,
    destination,
    ...route,
    fuel: { status: fuel.status, liters: fuel.liters, cost: fuel.cost, reason: fuel.reason || null },
    cost,
    calculated_at: new Date().toISOString(),
    warnings,
  };
}

module.exports = { estimateRoute, estimateFuel, estimateCost };

'use strict';

// Tool: route.estimate — estimativa de rota read-only via Route Intelligence.
// REUSA routeEstimateService (mesma autoridade/normalização; provider default
// disabled em produção). Sem PII, sem URL assinada, sem ação de negócio. Quando o
// provider está inerte e não há dados manuais, devolve availability=UNAVAILABLE
// (o assistente deve dizer que precisa de dados manuais / provedor não habilitado).

const { estimateRoute } = require('../../routeIntelligence/routeEstimateService');

module.exports = {
  name: 'route.estimate',
  description: 'Estima distância, duração, pedágio (se conhecido), combustível (se informados consumo e preço) e custo de uma rota entre origem e destino. Somente leitura; dados desconhecidos aparecem como indisponíveis (nunca zero).',
  requiredPermission: 'freight.view',
  inputSchema: {
    type: 'object',
    properties: {
      origin: { type: 'string' },
      destination: { type: 'string' },
      consumption_km_per_liter: { type: 'number' },
      fuel_price_per_liter: { type: 'number' },
    },
    required: ['origin', 'destination'],
    additionalProperties: false,
  },
  async handler(_ctx, args) {
    const r = await estimateRoute({
      origin: args.origin,
      destination: args.destination,
      params: {
        consumption_km_per_liter: args.consumption_km_per_liter,
        fuel_price_per_liter: args.fuel_price_per_liter,
      },
    });
    if (!r.ok) return { ok: false, data: null, evidence: [], warnings: [r.message || 'Não foi possível estimar a rota.'], truncated: false };
    return {
      ok: true,
      data: {
        origin: r.origin,
        destination: r.destination,
        route_source: r.route_source,
        availability: r.availability,
        distance_km: r.distance_km,
        duration_minutes: r.duration_minutes,
        tolls_amount: r.tolls_amount,
        truck_restrictions_status: r.truck_restrictions_status,
        fuel: r.fuel,
        cost: r.cost,
      },
      evidence: [{ tool: 'route.estimate', entity_type: 'route', label: `${r.origin} → ${r.destination}`, snapshot_at: r.calculated_at }],
      warnings: r.warnings || [],
      truncated: false,
    };
  },
};

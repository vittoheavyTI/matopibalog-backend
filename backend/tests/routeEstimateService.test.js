'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateRoute, estimateFuel, estimateCost } = require('../services/routeIntelligence/routeEstimateService');

function withMode(mode, fn) {
  const prev = process.env.ROUTE_PROVIDER_MODE;
  process.env.ROUTE_PROVIDER_MODE = mode;
  return Promise.resolve(fn()).finally(() => { process.env.ROUTE_PROVIDER_MODE = prev; });
}

test('input inválido: sem origem/destino', async () => {
  const r = await estimateRoute({ origin: '', destination: 'B' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_input');
});

test('MANUAL: usa dados informados (source=MANUAL), funciona mesmo disabled', async () => {
  await withMode('disabled', async () => {
    const r = await estimateRoute({ origin: 'A', destination: 'B', manual: { distance_km: 100, duration_minutes: 90, tolls_amount: 30 } });
    assert.equal(r.ok, true);
    assert.equal(r.route_source, 'MANUAL');
    assert.equal(r.distance_km, 100);
    assert.equal(r.tolls_amount, 30);
    assert.equal(r.availability, 'AVAILABLE');
  });
});

test('DISABLED sem manual: UNAVAILABLE + fallback manual (unknown != zero)', async () => {
  await withMode('disabled', async () => {
    const r = await estimateRoute({ origin: 'A', destination: 'B' });
    assert.equal(r.ok, true);
    assert.equal(r.route_source, 'UNAVAILABLE');
    assert.equal(r.availability, 'UNAVAILABLE');
    assert.equal(r.distance_km, null); // NÃO zero
    assert.equal(r.tolls_amount, null);
    assert.equal(r.manual_fallback_supported, true);
    assert.equal(r.error_class, 'DISABLED');
  });
});

test('FAKE: determinístico (mesma entrada → mesma distância); tolls null; restrições UNAVAILABLE', async () => {
  await withMode('fake', async () => {
    const r1 = await estimateRoute({ origin: 'Cidade A', destination: 'Cidade B' });
    const r2 = await estimateRoute({ origin: 'Cidade A', destination: 'Cidade B' });
    assert.equal(r1.route_source, 'PROVIDER');
    assert.equal(r1.provider, 'fake');
    assert.equal(r1.distance_km, r2.distance_km);
    assert.ok(r1.distance_km > 0);
    assert.equal(r1.tolls_amount, null); // fake não inventa pedágio
    assert.equal(r1.truck_restrictions_status, 'UNAVAILABLE'); // sem alegar rota segura p/ caminhão
  });
});

test('combustível: completo calcula; incompleto = UNAVAILABLE (nunca inventa consumo/preço)', async () => {
  const ok = estimateFuel({ distanceKm: 100, consumptionKmPerLiter: 2.5, fuelPricePerLiter: 6 });
  assert.equal(ok.status, 'KNOWN');
  assert.equal(ok.liters, 40);
  assert.equal(ok.cost, 240);
  assert.equal(estimateFuel({ distanceKm: 100, fuelPricePerLiter: 6 }).status, 'UNAVAILABLE');
  assert.equal(estimateFuel({ distanceKm: 100, consumptionKmPerLiter: 2.5 }).status, 'UNAVAILABLE');
  assert.equal(estimateFuel({ consumptionKmPerLiter: 2.5, fuelPricePerLiter: 6 }).status, 'UNAVAILABLE');
});

test('custo: soma só conhecidos, marca partial quando algo é desconhecido', async () => {
  const full = estimateCost({ fuelCost: 240, tollsAmount: 30, otherKnownCost: 10 });
  assert.equal(full.estimated_route_cost, 280);
  assert.equal(full.partial, false);
  const partial = estimateCost({ fuelCost: 240, tollsAmount: null });
  assert.equal(partial.estimated_route_cost, 240);
  assert.equal(partial.partial, true);
  assert.equal(partial.tolls_cost, null); // desconhecido, não zero
});

test('FAKE + params completos: rota + combustível + custo parcial (tolls desconhecido)', async () => {
  await withMode('fake', async () => {
    const r = await estimateRoute({ origin: 'X', destination: 'Y', params: { consumption_km_per_liter: 3, fuel_price_per_liter: 6 } });
    assert.equal(r.fuel.status, 'KNOWN');
    assert.ok(r.cost.estimated_route_cost > 0);
    assert.equal(r.cost.partial, true); // tolls null (fake)
    assert.ok(r.warnings.some((w) => /prazo legal/i.test(w)));
  });
});

test('provider erro (fake failure) → UNAVAILABLE com fallback', async () => {
  const { fakeRouteProvider } = require('../services/routeIntelligence/providers/fakeRouteProvider');
  await withMode('fake', async () => {
    fakeRouteProvider.setFailure('TIMEOUT');
    const r = await estimateRoute({ origin: 'A', destination: 'B' });
    fakeRouteProvider.reset();
    assert.equal(r.availability, 'UNAVAILABLE');
    assert.equal(r.error_class, 'TIMEOUT');
    assert.equal(r.distance_km, null);
  });
});

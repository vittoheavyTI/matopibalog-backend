const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODALIDADE_PADRAO,
  normalizarModalidade,
  calcularKmTotal,
  calcularValorToneladaKm,
} = require('../utils/calculoFrete');

// ─── normalizarModalidade ─────────────────────────────────────────────────────

test('normalizarModalidade: ausente/null/vazio → padrão valor_fixo', () => {
  assert.equal(normalizarModalidade(undefined), MODALIDADE_PADRAO);
  assert.equal(normalizarModalidade(null), MODALIDADE_PADRAO);
  assert.equal(normalizarModalidade(''), MODALIDADE_PADRAO);
  assert.equal(MODALIDADE_PADRAO, 'valor_fixo');
});

test('normalizarModalidade: valores válidos passam; inválido → null', () => {
  assert.equal(normalizarModalidade('valor_fixo'), 'valor_fixo');
  assert.equal(normalizarModalidade('tonelada_km'), 'tonelada_km');
  assert.equal(normalizarModalidade('outra'), null);
});

// ─── calcularKmTotal ──────────────────────────────────────────────────────────

test('calcularKmTotal: distância positiva', () => {
  assert.equal(calcularKmTotal(1000, 1500), 500);
});

test('calcularKmTotal: km ausente/inválido → null', () => {
  assert.equal(calcularKmTotal(null, 1500), null);
  assert.equal(calcularKmTotal(1000, undefined), null);
  assert.equal(calcularKmTotal('x', 1500), null);
});

test('calcularKmTotal: km_final <= km_inicial → null (sem distância)', () => {
  assert.equal(calcularKmTotal(1500, 1500), null);
  assert.equal(calcularKmTotal(1500, 1000), null);
});

// ─── calcularValorToneladaKm ──────────────────────────────────────────────────

test('valor tonelada/km: cálculo correto = toneladas * km * valor', () => {
  // 30 t * (1500-1000=500 km) * 0,20 = 3000
  assert.equal(
    calcularValorToneladaKm({ toneladas: 30, valorToneladaKm: 0.2, kmInicial: 1000, kmFinal: 1500 }),
    3000
  );
});

test('valor tonelada/km: arredonda a 2 casas (centavos)', () => {
  // 10 t * 100 km * 0,3333 = 333,3 → 333.3
  assert.equal(
    calcularValorToneladaKm({ toneladas: 10, valorToneladaKm: 0.3333, kmInicial: 0, kmFinal: 100 }),
    333.3
  );
});

test('valor tonelada/km: km_final ausente → null (provisório até finalizar)', () => {
  assert.equal(
    calcularValorToneladaKm({ toneladas: 30, valorToneladaKm: 0.2, kmInicial: 1000, kmFinal: undefined }),
    null
  );
});

test('valor tonelada/km: toneladas ou valor ausentes/não-positivos → null', () => {
  assert.equal(calcularValorToneladaKm({ toneladas: 0, valorToneladaKm: 0.2, kmInicial: 1000, kmFinal: 1500 }), null);
  assert.equal(calcularValorToneladaKm({ toneladas: 30, valorToneladaKm: 0, kmInicial: 1000, kmFinal: 1500 }), null);
  assert.equal(calcularValorToneladaKm({ toneladas: undefined, valorToneladaKm: 0.2, kmInicial: 1000, kmFinal: 1500 }), null);
});

test('valor tonelada/km: km_final <= km_inicial → null (não fabrica valor negativo)', () => {
  assert.equal(
    calcularValorToneladaKm({ toneladas: 30, valorToneladaKm: 0.2, kmInicial: 1500, kmFinal: 1000 }),
    null
  );
});

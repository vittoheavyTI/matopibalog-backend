const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VALOR_TONELADA_KM_MAX,
  TONELADAS_MAX,
  VALOR_FRETE_MAX,
  validarLimitesFrete,
} = require('../utils/limitesFrete');

test('constantes de limite conforme decisao inicial', () => {
  assert.equal(VALOR_TONELADA_KM_MAX, 10);
  assert.equal(TONELADAS_MAX, 100);
  assert.equal(VALOR_FRETE_MAX, 1000000);
});

test('caso valido: 30 t x 500 km x 0,20 = 3.000 passa', () => {
  const r = validarLimitesFrete({
    modalidade: 'tonelada_km',
    valorFrete: 3000,
    toneladas: 30,
    valorToneladaKm: 0.20,
    kmInicial: 1000,
    kmFinal: 1500,
  });
  assert.equal(r.ok, true);
});

test('valor_fixo dentro do teto passa', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 3000 }).ok, true);
});

test('tonelada_km com valor_frete 0 provisorio antes de finalizar passa', () => {
  const r = validarLimitesFrete({
    modalidade: 'tonelada_km',
    valorFrete: 0,
    toneladas: 30,
    valorToneladaKm: 0.2,
    kmInicial: 1000,
  });
  assert.equal(r.ok, true);
});

test('outliers reais continuam recusados', () => {
  assert.equal(validarLimitesFrete({
    modalidade: 'tonelada_km',
    valorFrete: 50 * 799 * 150,
    toneladas: 50,
    valorToneladaKm: 150,
    kmInicial: 1,
    kmFinal: 800,
  }).ok, false);
  assert.equal(validarLimitesFrete({
    modalidade: 'tonelada_km',
    valorFrete: 48 * 1750 * 450,
    toneladas: 48,
    valorToneladaKm: 450,
    kmInicial: 1,
    kmFinal: 1751,
  }).ok, false);
});

test('km_final menor ou igual ao km_inicial recusa com campo km', () => {
  const igual = validarLimitesFrete({ kmInicial: 1000, kmFinal: 1000 });
  const menor = validarLimitesFrete({ kmInicial: 1000, kmFinal: 500 });
  assert.equal(igual.ok, false);
  assert.equal(igual.campo, 'km');
  assert.equal(menor.ok, false);
  assert.equal(menor.campo, 'km');
});

test('valor_tonelada_km invalido recusa e identifica o campo', () => {
  assert.equal(validarLimitesFrete({ valorToneladaKm: -1 }).campo, 'valor_tonelada_km');
  const acima = validarLimitesFrete({ valorToneladaKm: 10.0001 });
  assert.equal(acima.ok, false);
  assert.equal(acima.campo, 'valor_tonelada_km');
  assert.equal(validarLimitesFrete({ valorToneladaKm: 10 }).ok, true);
});

test('toneladas invalidas recusam e identificam o campo', () => {
  assert.equal(validarLimitesFrete({ toneladas: -5 }).campo, 'toneladas');
  const acima = validarLimitesFrete({ toneladas: 100.001 });
  assert.equal(acima.ok, false);
  assert.equal(acima.campo, 'toneladas');
  assert.equal(validarLimitesFrete({ toneladas: 100 }).ok, true);
});

test('valor_frete respeita zero, negativo e teto', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 1000000.01 }).campo, 'valor_frete');
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 1000000 }).ok, true);
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: -1 }).campo, 'valor_frete');
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 0 }).campo, 'valor_frete');
});

test('campos ausentes ou km isolado nao reprovam edicao parcial', () => {
  assert.equal(validarLimitesFrete({}).ok, true);
  assert.equal(validarLimitesFrete().ok, true);
  assert.equal(validarLimitesFrete({ kmInicial: 1000 }).ok, true);
  assert.equal(validarLimitesFrete({ kmFinal: 1500 }).ok, true);
});

test('mensagem de erro informa campo, valor atual e orientacao', () => {
  const r = validarLimitesFrete({ valorToneladaKm: 150 });
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'valor_tonelada_km');
  assert.equal(r.valorAtual, 150);
  assert.match(r.message, /valor por tonelada\/km/i);
  assert.match(r.message, /150/i);
  assert.match(r.message, /Campo invalido: Valor por tonelada\/km/i);
  assert.match(r.message, /Valor atual: R\$ 150/i);
  assert.match(r.message, /Limite aceitavel: ate R\$ 10/i);
  assert.match(r.message, /Corrija este campo pelo painel/i);
});

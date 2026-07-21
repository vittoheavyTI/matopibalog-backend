const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VALOR_TONELADA_KM_MAX,
  TONELADAS_MAX,
  VALOR_FRETE_MAX,
  validarLimitesFrete,
} = require('../utils/limitesFrete');

// Constantes documentadas como limites de SANIDADE OPERACIONAL (não regra comercial).
test('constantes de limite conforme decisão inicial', () => {
  assert.equal(VALOR_TONELADA_KM_MAX, 10);
  assert.equal(TONELADAS_MAX, 100);
  assert.equal(VALOR_FRETE_MAX, 1000000);
});

// ─── Caso válido de referência (escala realista) continua passando ────────────
test('caso válido: 30 t × 500 km × 0,20 = 3.000 → ok', () => {
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

test('valor_fixo dentro do teto → ok', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 3000 }).ok, true);
});

test('tonelada_km com valor_frete 0 provisório (antes de finalizar) → ok', () => {
  const r = validarLimitesFrete({
    modalidade: 'tonelada_km', valorFrete: 0, toneladas: 30, valorToneladaKm: 0.2, kmInicial: 1000,
  });
  assert.equal(r.ok, true);
});

// ─── Regressão dos casos reais (devem ser recusados) ──────────────────────────
test('regressão 50 × 799 × 150 (R$5.992.500) → recusado', () => {
  assert.equal(validarLimitesFrete({
    modalidade: 'tonelada_km', valorFrete: 50 * 799 * 150,
    toneladas: 50, valorToneladaKm: 150, kmInicial: 1, kmFinal: 800,
  }).ok, false);
});

test('regressão 48 × 1750 × 450 (R$37.800.000) → recusado', () => {
  assert.equal(validarLimitesFrete({
    modalidade: 'tonelada_km', valorFrete: 48 * 1750 * 450,
    toneladas: 48, valorToneladaKm: 450, kmInicial: 1, kmFinal: 1751,
  }).ok, false);
});

test('regressão 1 × 799 × 150 → recusado por valor_tonelada_km > 10', () => {
  assert.equal(validarLimitesFrete({
    modalidade: 'tonelada_km', valorFrete: 1 * 799 * 150,
    toneladas: 1, valorToneladaKm: 150, kmInicial: 1, kmFinal: 800,
  }).ok, false);
});

// ─── Rejeições unitárias por regra ────────────────────────────────────────────
test('km_final <= km_inicial → recusado', () => {
  assert.equal(validarLimitesFrete({ kmInicial: 1000, kmFinal: 1000 }).ok, false);
  assert.equal(validarLimitesFrete({ kmInicial: 1000, kmFinal: 500 }).ok, false);
});

test('valor_tonelada_km negativo → recusado', () => {
  assert.equal(validarLimitesFrete({ valorToneladaKm: -1 }).ok, false);
});

test('valor_tonelada_km acima do teto (10) → recusado; no teto exato → ok', () => {
  assert.equal(validarLimitesFrete({ valorToneladaKm: 10.0001 }).ok, false);
  assert.equal(validarLimitesFrete({ valorToneladaKm: 10 }).ok, true);
});

test('toneladas negativo → recusado', () => {
  assert.equal(validarLimitesFrete({ toneladas: -5 }).ok, false);
});

test('toneladas acima do teto (100) → recusado; no teto exato → ok', () => {
  assert.equal(validarLimitesFrete({ toneladas: 100.001 }).ok, false);
  assert.equal(validarLimitesFrete({ toneladas: 100 }).ok, true);
});

test('valor_frete fixo acima de R$1.000.000 → recusado; no teto exato → ok', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 1000000.01 }).ok, false);
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 1000000 }).ok, true);
});

test('valor_frete fixo negativo → recusado', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: -1 }).ok, false);
});

test('valor_frete fixo zero → recusado (fixo exige > 0)', () => {
  assert.equal(validarLimitesFrete({ modalidade: 'valor_fixo', valorFrete: 0 }).ok, false);
});

// ─── Campos ausentes não reprovam (edição parcial / criação provisória) ───────
test('objeto vazio / campos ausentes → ok (nada a validar)', () => {
  assert.equal(validarLimitesFrete({}).ok, true);
  assert.equal(validarLimitesFrete().ok, true);
});

test('km isolado (só km_inicial, sem km_final) não dispara regra de ordem', () => {
  assert.equal(validarLimitesFrete({ kmInicial: 1000 }).ok, true);
  assert.equal(validarLimitesFrete({ kmFinal: 1500 }).ok, true);
});

test('mensagem de erro é clara e única', () => {
  const r = validarLimitesFrete({ valorToneladaKm: 150 });
  assert.equal(r.ok, false);
  assert.match(r.message, /limites operacionais/i);
});

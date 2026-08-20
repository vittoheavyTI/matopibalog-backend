'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactFreteForDriver } = require('../services/permissions/driverFinancialRedaction');
const { DRIVER_FINANCIAL_VISIBILITY } = require('../services/permissions/permissionRegistry');

const frete = () => ({
  id: 'f1', origem: 'A', destino: 'B', status: 'ativo',
  valor_frete: 1000, valor_tonelada_km: 2.5, toneladas: 30,
});

test('commission_only: omite bruto, expõe comissão derivada', () => {
  const r = redactFreteForDriver(frete(), DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY, 12);
  assert.equal(r.valor_frete, undefined);
  assert.equal(r.valor_tonelada_km, undefined);
  assert.equal(r.toneladas, undefined);
  assert.equal(r.comissao_percentual, 12);
  assert.equal(r.comissao_valor, 120); // 1000 * 12%
  assert.equal(r.origem, 'A'); // não-financeiro preservado
});

test('commission_plus_base: mantém valor_frete (base), remove demais brutos', () => {
  const r = redactFreteForDriver(frete(), DRIVER_FINANCIAL_VISIBILITY.COMMISSION_PLUS_BASE, 10);
  assert.equal(r.valor_frete, 1000);
  assert.equal(r.valor_tonelada_km, undefined);
  assert.equal(r.toneladas, undefined);
  assert.equal(r.comissao_valor, 100);
});

test('full_freight_financial: sem redação (+ comissão derivada)', () => {
  const r = redactFreteForDriver(frete(), DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL, 15);
  assert.equal(r.valor_frete, 1000);
  assert.equal(r.valor_tonelada_km, 2.5);
  assert.equal(r.toneladas, 30);
  assert.equal(r.comissao_valor, 150);
});

test('sem percentual: comissao_valor null, brutos ainda redigidos no commission_only', () => {
  const r = redactFreteForDriver(frete(), DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY, null);
  assert.equal(r.comissao_valor, null);
  assert.equal(r.valor_frete, undefined);
});

test('não muta o objeto original', () => {
  const f = frete();
  redactFreteForDriver(f, DRIVER_FINANCIAL_VISIBILITY.COMMISSION_ONLY, 12);
  assert.equal(f.valor_frete, 1000);
});

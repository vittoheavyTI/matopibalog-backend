// MEGA-FRENTE Cobrança de Extras por Empresa — FASE 2: valorEfetivoEmpresa.
// Cenários do prompt (centavos inteiros; recomendação de upgrade melhor-ou-igual).

const test = require('node:test');
const assert = require('node:assert/strict');

const { valorEfetivoEmpresa } = require('../services/calculadoraComercialService');

const START = { id: 'start', nome: 'Empresa Start', categoria: 'empresa', preco_mensal: 299.90, capacidade_inclusa: 5, preco_motorista_extra: 100 };
const ESSENCIAL = { id: 'essencial', nome: 'Empresa Essencial', categoria: 'empresa', preco_mensal: 499.90, capacidade_inclusa: 10, preco_motorista_extra: 90 };
const GROWTH = { id: 'growth', nome: 'Empresa Growth', categoria: 'empresa', preco_mensal: 799.90, capacidade_inclusa: 20, preco_motorista_extra: 80 };
const SCALE = { id: 'scale', nome: 'Empresa Scale', categoria: 'empresa', preco_mensal: 1199.90, capacidade_inclusa: 40, preco_motorista_extra: 70 };
const CAT = [START, ESSENCIAL, GROWTH, SCALE];
const SOLO = { id: 'solo', nome: 'Autônomo Solo', categoria: 'autonomo', preco_mensal: 99.90, capacidade_inclusa: 1, preco_motorista_extra: null };

test('Start 5 → total 299,90, sem extras, sem upgrade', () => {
  const r = valorEfetivoEmpresa({ plano: START, quantidade_contratada: 5, planos: CAT });
  assert.equal(r.valor_total, 299.90);
  assert.equal(r.quantidade_extra, 0);
  assert.equal(r.valor_extra, 0);
  assert.equal(r.recomendacao_upgrade, null);
});

test('Start 7 → 499,90 (base + 2×100) e recomenda Essencial (empate → maior capacidade)', () => {
  const r = valorEfetivoEmpresa({ plano: START, quantidade_contratada: 7, planos: CAT });
  assert.equal(r.valor_total_centavos, 49990);
  assert.equal(r.valor_total, 499.90);
  assert.equal(r.quantidade_extra, 2);
  assert.equal(r.valor_extra, 200);
  assert.equal(r.recomendacao_upgrade, 'essencial');
  assert.equal(r.economia_upgrade, 0);
  assert.equal(r.empate_upgrade, true);
});

test('Essencial 15 → 949,90 e recomenda Growth (economia 150)', () => {
  const r = valorEfetivoEmpresa({ plano: ESSENCIAL, quantidade_contratada: 15, planos: CAT });
  assert.equal(r.valor_total_centavos, 94990);
  assert.equal(r.recomendacao_upgrade, 'growth');
  assert.equal(r.economia_upgrade, 150.00);
});

test('Growth 25 → 1.199,90 e recomenda Scale (empate)', () => {
  const r = valorEfetivoEmpresa({ plano: GROWTH, quantidade_contratada: 25, planos: CAT });
  assert.equal(r.valor_total_centavos, 119990);
  assert.equal(r.recomendacao_upgrade, 'scale');
  assert.equal(r.empate_upgrade, true);
});

test('Scale 40 → 1.199,90, sem extras', () => {
  const r = valorEfetivoEmpresa({ plano: SCALE, quantidade_contratada: 40, planos: CAT });
  assert.equal(r.valor_total, 1199.90);
  assert.equal(r.quantidade_extra, 0);
});

test('41 → requer negociação (sem valor de tabela)', () => {
  const r = valorEfetivoEmpresa({ plano: SCALE, quantidade_contratada: 41, planos: CAT });
  assert.equal(r.requer_negociacao, true);
  assert.equal(r.valor_total, null);
});

test('Autônomo Solo 1 → 99,90 sem extra', () => {
  const r = valorEfetivoEmpresa({ plano: SOLO, quantidade_contratada: 1, planos: [SOLO] });
  assert.equal(r.valor_total, 99.90);
  assert.equal(r.quantidade_extra, 0);
});

test('Autônomo 2 → não acomoda (sem extra de empresa)', () => {
  const r = valorEfetivoEmpresa({ plano: SOLO, quantidade_contratada: 2, planos: [SOLO] });
  assert.equal(r.acomoda, false);
  assert.equal(r.valor_total, null);
  assert.equal(r.motivo, 'excede_capacidade_sem_extra');
});

test('sem catálogo → calcula valor mas sem recomendação', () => {
  const r = valorEfetivoEmpresa({ plano: START, quantidade_contratada: 7 });
  assert.equal(r.valor_total, 499.90);
  assert.equal(r.recomendacao_upgrade, null);
  assert.equal(r.plano_recomendado, null);
});

test('quantidade inválida → erro', () => {
  const r = valorEfetivoEmpresa({ plano: START, quantidade_contratada: 0, planos: CAT });
  assert.equal(r.ok, false);
});

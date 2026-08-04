const test = require('node:test');
const assert = require('node:assert/strict');
const { montarPatchComercial } = require('../services/planoComercialPatchService');

test('body vazio → patch vazio', () => {
  const r = montarPatchComercial({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {});
});

test('capacidade_inclusa válida entra; inválida → 422', () => {
  assert.equal(montarPatchComercial({ capacidade_inclusa: 5 }).patch.capacidade_inclusa, 5);
  const err = montarPatchComercial({ capacidade_inclusa: -1 });
  assert.equal(err.ok, false);
  assert.equal(err.status, 422);
});

test('preco_motorista_extra: null limpa, valor entra, negativo → 422', () => {
  assert.equal(montarPatchComercial({ preco_motorista_extra: null }).patch.preco_motorista_extra, null);
  assert.equal(montarPatchComercial({ preco_motorista_extra: '90.00' }).patch.preco_motorista_extra, 90);
  assert.equal(montarPatchComercial({ preco_motorista_extra: -5 }).ok, false);
});

test('valor_implantacao: zero entra como 0', () => {
  assert.equal(montarPatchComercial({ valor_implantacao: 0 }).patch.valor_implantacao, 0);
});

test('requer_negociacao vira boolean', () => {
  assert.equal(montarPatchComercial({ requer_negociacao: true }).patch.requer_negociacao, true);
  assert.equal(montarPatchComercial({ requer_negociacao: 'x' }).patch.requer_negociacao, false);
});

test('limite_negociacao: válido entra, null limpa, inválido → 422', () => {
  assert.equal(montarPatchComercial({ limite_negociacao: 40 }).patch.limite_negociacao, 40);
  assert.equal(montarPatchComercial({ limite_negociacao: '' }).patch.limite_negociacao, null);
  const err = montarPatchComercial({ limite_negociacao: 1.5 });
  assert.equal(err.ok, false);
  assert.equal(err.status, 422);
});

test('visivel_cadastro vira boolean e só entra quando enviado', () => {
  assert.equal(montarPatchComercial({ visivel_cadastro: true }).patch.visivel_cadastro, true);
  assert.equal(montarPatchComercial({ visivel_cadastro: false }).patch.visivel_cadastro, false);
  assert.equal('visivel_cadastro' in montarPatchComercial({}).patch, false);
});

test('combinação completa monta patch coerente', () => {
  const r = montarPatchComercial({
    capacidade_inclusa: 10, preco_motorista_extra: '80', valor_implantacao: '500.00',
    requer_negociacao: false, limite_negociacao: 40, visivel_cadastro: true,
  });
  assert.deepEqual(r.patch, {
    capacidade_inclusa: 10, preco_motorista_extra: 80, valor_implantacao: 500,
    requer_negociacao: false, limite_negociacao: 40, visivel_cadastro: true,
  });
});

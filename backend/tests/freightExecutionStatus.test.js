'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freightStatusToBucket,
  FREIGHT_STATUS_TO_BUCKET,
  EXECUTION_BUCKET,
  IN_EXECUTION_STATUSES,
} = require('../services/campaign/freightExecutionStatus');

// Congela o mapeamento canônico (§18). Alterar exige atualizar este teste.
test('mapeamento congelado FRETE→bucket', () => {
  assert.deepEqual(FREIGHT_STATUS_TO_BUCKET, {
    pendente: 'IN_EXECUTION',
    ativo: 'IN_EXECUTION',
    em_viagem: 'IN_EXECUTION',
    em_andamento: 'IN_EXECUTION',
    finalizado: 'COMPLETED',
    cancelado: 'CANCELLED',
  });
});

test('finalizado→COMPLETED, cancelado→CANCELLED', () => {
  assert.equal(freightStatusToBucket('finalizado'), EXECUTION_BUCKET.COMPLETED);
  assert.equal(freightStatusToBucket('cancelado'), EXECUTION_BUCKET.CANCELLED);
});

test('ativos→IN_EXECUTION', () => {
  for (const s of ['pendente', 'ativo', 'em_viagem', 'em_andamento']) {
    assert.equal(freightStatusToBucket(s), EXECUTION_BUCKET.IN_EXECUTION);
  }
});

test('desconhecido/nulo/vazio → UNKNOWN (nunca IN_EXECUTION)', () => {
  assert.equal(freightStatusToBucket('foo'), EXECUTION_BUCKET.UNKNOWN);
  assert.equal(freightStatusToBucket(null), EXECUTION_BUCKET.UNKNOWN);
  assert.equal(freightStatusToBucket(''), EXECUTION_BUCKET.UNKNOWN);
  assert.equal(freightStatusToBucket(undefined), EXECUTION_BUCKET.UNKNOWN);
});

test('case-insensitive e trim', () => {
  assert.equal(freightStatusToBucket(' Finalizado '), EXECUTION_BUCKET.COMPLETED);
});

test('IN_EXECUTION_STATUSES lista os 4 status ativos', () => {
  assert.deepEqual([...IN_EXECUTION_STATUSES].sort(), ['ativo', 'em_andamento', 'em_viagem', 'pendente']);
});

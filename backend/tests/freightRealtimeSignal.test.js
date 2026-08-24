'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bus = require('../services/realtimeBus');
const { publicarStatusFrete } = require('../services/campaign/freightRealtimeSignal');

test('publica evento de status por empresa, com freight_id', () => {
  const recebidos = [];
  const off = bus.subscribe('emp-1', (e) => recebidos.push(e));
  publicarStatusFrete({ id: 'f1', empresa_id: 'emp-1', status: 'finalizado' });
  off();
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].type, 'freight.status');
  assert.equal(recebidos[0].freight_id, 'f1');
  assert.equal(recebidos[0].entity_type, 'freight');
});

test('não vaza entre empresas (canal por tenant)', () => {
  const outra = [];
  const off = bus.subscribe('emp-2', (e) => outra.push(e));
  publicarStatusFrete({ id: 'f1', empresa_id: 'emp-1', status: 'cancelado' });
  off();
  assert.equal(outra.length, 0);
});

test('best-effort: dados inválidos não lançam nem publicam', () => {
  const recebidos = [];
  const off = bus.subscribe('emp-1', (e) => recebidos.push(e));
  assert.doesNotThrow(() => publicarStatusFrete(null));
  assert.doesNotThrow(() => publicarStatusFrete({ id: 'f1' })); // sem empresa_id
  off();
  assert.equal(recebidos.length, 0);
});

// RealtimeBus — barramento em memória. Isolamento por empresa, unsubscribe idempotente,
// sem entrega cross-tenant, sem leak de listener.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bus = require('../services/realtimeBus');

test('publish entrega ao assinante da mesma empresa', () => {
  const recebidos = [];
  const off = bus.subscribe('emp-A', (e) => recebidos.push(e));
  bus.publish({ empresa_id: 'emp-A', type: 'launch.created', entity_id: 'x' });
  off();
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].type, 'launch.created');
});

test('não entrega cross-tenant', () => {
  const a = [];
  const b = [];
  const offA = bus.subscribe('emp-A', (e) => a.push(e));
  const offB = bus.subscribe('emp-B', (e) => b.push(e));
  bus.publish({ empresa_id: 'emp-A', type: 'launch.approved' });
  offA(); offB();
  assert.equal(a.length, 1);
  assert.equal(b.length, 0, 'empresa B não recebe evento de A');
});

test('unsubscribe para de receber e é idempotente', () => {
  const recebidos = [];
  const off = bus.subscribe('emp-C', (e) => recebidos.push(e));
  bus.publish({ empresa_id: 'emp-C', type: 'x' });
  off();
  off(); // idempotente: não lança
  bus.publish({ empresa_id: 'emp-C', type: 'y' });
  assert.equal(recebidos.length, 1, 'só o evento antes do unsubscribe');
});

test('subscriberCount reflete assinantes ativos (sem leak após unsubscribe)', () => {
  const base = bus.subscriberCount('emp-D');
  const off1 = bus.subscribe('emp-D', () => {});
  const off2 = bus.subscribe('emp-D', () => {});
  assert.equal(bus.subscriberCount('emp-D'), base + 2);
  off1(); off2();
  assert.equal(bus.subscriberCount('emp-D'), base, 'cleanup remove os listeners');
});

test('publish sem empresa_id é ignorado (não lança)', () => {
  assert.doesNotThrow(() => bus.publish({ type: 'sem-empresa' }));
  assert.equal(bus.publish(null), false);
});

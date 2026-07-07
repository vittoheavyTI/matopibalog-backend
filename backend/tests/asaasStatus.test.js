const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizarStatusAsaas } = require('../utils/asaasStatus');

test('PENDING vira pendente (bug auditado)', () => {
  assert.equal(normalizarStatusAsaas('PENDING'), 'pendente');
});

test('RECEIVED e CONFIRMED viram pago', () => {
  assert.equal(normalizarStatusAsaas('RECEIVED'), 'pago');
  assert.equal(normalizarStatusAsaas('CONFIRMED'), 'pago');
  assert.equal(normalizarStatusAsaas('RECEIVED_IN_CASH'), 'pago');
});

test('OVERDUE vira vencido', () => {
  assert.equal(normalizarStatusAsaas('OVERDUE'), 'vencido');
});

test('DELETED vira cancelado', () => {
  assert.equal(normalizarStatusAsaas('DELETED'), 'cancelado');
});

test('REFUNDED e REFUND_REQUESTED viram estornado', () => {
  assert.equal(normalizarStatusAsaas('REFUNDED'), 'estornado');
  assert.equal(normalizarStatusAsaas('REFUND_REQUESTED'), 'estornado');
});

test('é tolerante a caixa e espaços', () => {
  assert.equal(normalizarStatusAsaas('  pending  '), 'pendente');
  assert.equal(normalizarStatusAsaas('received'), 'pago');
});

test('status desconhecido ou ausente cai no default seguro pendente', () => {
  assert.equal(normalizarStatusAsaas('ALGO_NOVO'), 'pendente');
  assert.equal(normalizarStatusAsaas(''), 'pendente');
  assert.equal(normalizarStatusAsaas(null), 'pendente');
  assert.equal(normalizarStatusAsaas(undefined), 'pendente');
});

test('nunca devolve valor fora do CHECK de faturas.status', () => {
  const permitidos = new Set(['pendente', 'pago', 'vencido', 'cancelado', 'estornado']);
  for (const s of ['PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'DELETED', 'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'AWAITING_RISK_ANALYSIS', 'QUALQUER', '', null]) {
    assert.ok(permitidos.has(normalizarStatusAsaas(s)), `status inválido para ${s}`);
  }
});

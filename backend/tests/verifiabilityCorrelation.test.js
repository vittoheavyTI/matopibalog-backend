'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCorrelationContext,
  sanitizeCorrelationId,
} = require('../services/verifiability/correlationContext');

test('correlation context creates a new request id for legacy requests', () => {
  const ctx = buildCorrelationContext({ headers: {} });
  assert.match(ctx.request_id, /^req_/);
  assert.equal(ctx.correlation_id, ctx.request_id);
  assert.equal(ctx.operation_id, null);
  assert.equal(ctx.causation_id, null);
});

test('correlation context preserves safe correlation and operation ids', () => {
  const ctx = buildCorrelationContext({
    headers: {
      'x-request-id': 'req-client-1',
      'x-correlation-id': 'corr-42',
      'x-operation-id': 'op:frete/123',
      'x-causation-id': 'evt_abc',
    },
  });
  assert.equal(ctx.request_id, 'req-client-1');
  assert.equal(ctx.correlation_id, 'corr-42');
  assert.equal(ctx.operation_id, 'op:frete/123');
  assert.equal(ctx.causation_id, 'evt_abc');
});

test('correlation context rejects unsafe ids and never carries tenant scope', () => {
  const ctx = buildCorrelationContext({
    headers: {
      'x-request-id': 'bad id with spaces',
      'x-correlation-id': '<script>',
      'x-empresa-id': 'tenant-a',
    },
  });
  assert.match(ctx.request_id, /^req_/);
  assert.equal(ctx.correlation_id, ctx.request_id);
  assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'empresa_id'), false);
  assert.equal(sanitizeCorrelationId('a'.repeat(129)), null);
});

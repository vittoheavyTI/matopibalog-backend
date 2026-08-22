'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventEnvelope, sanitizeMetadata } = require('../services/verifiability/eventEnvelope');

test('event envelope includes actor/source/correlation without raw sensitive metadata', () => {
  const envelope = createEventEnvelope({
    event_type: 'checked',
    domain: 'documents',
    empresa_id: 'empresa-1',
    entity_type: 'frete_documento',
    entity_id: 'doc-1',
    correlation: {
      correlation_id: 'corr-1',
      operation_id: 'op-1',
      causation_id: 'evt-1',
    },
    actor_id: 'u-1',
    actor_role: 'admin',
    source: 'api',
    metadata: {
      ok: true,
      authorization: 'Bearer secret',
      nested: { otp: '123456', visible: 'yes' },
    },
  });

  assert.equal(envelope.correlation_id, 'corr-1');
  assert.equal(envelope.actor_role, 'admin');
  assert.equal(envelope.metadata.authorization, '[redacted]');
  assert.equal(envelope.metadata.nested.otp, '[redacted]');
  assert.equal(envelope.metadata.nested.visible, 'yes');
});

test('event envelope requires event type and domain', () => {
  assert.throws(() => createEventEnvelope({ domain: 'x' }), /event_type_required/);
  assert.throws(() => createEventEnvelope({ event_type: 'x' }), /domain_required/);
});

test('metadata sanitizer truncates long values and nested depth', () => {
  const sanitized = sanitizeMetadata({
    text: 'a'.repeat(700),
    deep: { a: { b: { c: { d: { e: 'too-deep' } } } } },
  });
  assert.equal(sanitized.text.length, 500);
  assert.equal(sanitized.deep.a.b.c.d, '[truncated]');
});

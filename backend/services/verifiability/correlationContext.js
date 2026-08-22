'use strict';

const crypto = require('crypto');

const MAX_ID_LENGTH = 128;
const SAFE_ID_RE = /^[A-Za-z0-9._:/@+-]+$/;

function generateId(prefix = 'req') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sanitizeCorrelationId(value) {
  if (value == null) return null;
  const id = String(value).trim();
  if (!id || id.length > MAX_ID_LENGTH) return null;
  if (!SAFE_ID_RE.test(id)) return null;
  return id;
}

function readHeader(headers, name) {
  if (!headers) return null;
  return headers[name] || headers[name.toLowerCase()] || null;
}

function buildCorrelationContext(input = {}) {
  const headers = input.headers || {};
  const requestId = sanitizeCorrelationId(readHeader(headers, 'x-request-id')) || generateId('req');
  const correlationId =
    sanitizeCorrelationId(readHeader(headers, 'x-correlation-id')) || requestId;
  const operationId = sanitizeCorrelationId(readHeader(headers, 'x-operation-id'));
  const causationId = sanitizeCorrelationId(readHeader(headers, 'x-causation-id'));

  return {
    request_id: requestId,
    correlation_id: correlationId,
    operation_id: operationId,
    causation_id: causationId,
  };
}

function attachCorrelationContext(req, res, next) {
  req.correlation = buildCorrelationContext({ headers: req.headers });
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-Request-Id', req.correlation.request_id);
    res.setHeader('X-Correlation-Id', req.correlation.correlation_id);
  }
  return next();
}

module.exports = {
  MAX_ID_LENGTH,
  buildCorrelationContext,
  attachCorrelationContext,
  sanitizeCorrelationId,
};

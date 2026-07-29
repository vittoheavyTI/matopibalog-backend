const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { ipKeyGenerator } = require('express-rate-limit');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const { chaveRateLimit } = require('../middlewares/rateLimitKey');

const IP = '203.0.113.7';
const req = (over = {}) => ({ headers: {}, cookies: {}, ip: IP, ...over });

test('token válido no header Bearer → chave por usuário', () => {
  const token = jwt.sign({ uid: 'u-123' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal(chaveRateLimit(req({ headers: { authorization: 'Bearer ' + token } })), 'user:u-123');
});

test('token válido no cookie → chave por usuário', () => {
  const token = jwt.sign({ uid: 'u-cookie' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal(chaveRateLimit(req({ cookies: { token } })), 'user:u-cookie');
});

test('sem token → fallback por IP (normalizado)', () => {
  assert.equal(chaveRateLimit(req()), ipKeyGenerator(IP));
});

test('token inválido → fallback por IP', () => {
  assert.equal(chaveRateLimit(req({ headers: { authorization: 'Bearer nao-e-um-jwt' } })), ipKeyGenerator(IP));
});

test('token expirado → fallback por IP', () => {
  const token = jwt.sign({ uid: 'u-exp' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal(chaveRateLimit(req({ cookies: { token } })), ipKeyGenerator(IP));
});

test('token assinado com OUTRO segredo → fallback por IP (verify falha)', () => {
  const token = jwt.sign({ uid: 'u-x' }, 'outro-segredo', { expiresIn: '1h' });
  assert.equal(chaveRateLimit(req({ headers: { authorization: 'Bearer ' + token } })), ipKeyGenerator(IP));
});

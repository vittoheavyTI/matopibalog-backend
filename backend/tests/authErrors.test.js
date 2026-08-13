// Testes do modelo de erros de domínio de auth (SEC-1).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../services/auth/authErrors');

test('erroDeResultadoRotacao mapeia resultado → erro/HTTP corretos', () => {
  assert.equal(E.erroDeResultadoRotacao('ok'), null);
  assert.ok(E.erroDeResultadoRotacao('refresh_already_rotated') instanceof E.RefreshAlreadyRotated);
  assert.equal(E.erroDeResultadoRotacao('refresh_already_rotated').httpStatus, 409);
  assert.ok(E.erroDeResultadoRotacao('reuse_detected') instanceof E.RefreshReuseDetected);
  assert.equal(E.erroDeResultadoRotacao('reuse_detected').httpStatus, 401);
  assert.ok(E.erroDeResultadoRotacao('expirado') instanceof E.RefreshExpired);
  assert.ok(E.erroDeResultadoRotacao('revogado') instanceof E.RefreshRevoked);
  assert.ok(E.erroDeResultadoRotacao('invalido') instanceof E.RefreshInvalid);
  assert.ok(E.erroDeResultadoRotacao('sessao_invalida') instanceof E.SessionInvalid);
  // resultado desconhecido → RefreshInvalid (fail-closed), nunca sucesso
  assert.ok(E.erroDeResultadoRotacao('zzz') instanceof E.RefreshInvalid);
});

test('cada erro tem code, httpStatus e mensagem pública sanitizada', () => {
  const instancias = [
    new E.RefreshInvalid(), new E.RefreshExpired(), new E.RefreshRevoked(),
    new E.RefreshAlreadyRotated(), new E.RefreshReuseDetected(),
    new E.SessionNotFound(), new E.SessionRevoked(), new E.SessionIdleExpired(),
    new E.SessionAbsoluteExpired(), new E.SessionInvalid(), new E.SessionConflict(),
    new E.SessionDependencyUnavailable(),
  ];
  for (const e of instancias) {
    assert.ok(e instanceof E.AuthError);
    assert.equal(typeof e.code, 'string');
    assert.ok([401, 403, 404, 409, 503].includes(e.httpStatus), `${e.code} http=${e.httpStatus}`);
    assert.ok(e.publicMessage.length > 0);
    // mensagem pública não pode vazar termos técnicos/segredos
    const m = e.publicMessage.toLowerCase();
    for (const p of ['select', 'insert', 'update', 'sql', 'token_hash', 'hash', 'pepper', 'jwt_secret', 'auth_sessions', 'auth_refresh']) {
      assert.ok(!m.includes(p), `${e.code}: mensagem pública não pode conter "${p}"`);
    }
  }
});

test('SessionDependencyUnavailable → 503', () => {
  assert.equal(new E.SessionDependencyUnavailable().httpStatus, 503);
});

test('internalCause NÃO é enumerável (não serializa) e toPublic é seguro', () => {
  const e = new E.RefreshReuseDetected('detalhe interno com token abc123 e sql secreto');
  const pub = e.toPublic();
  assert.deepEqual(Object.keys(pub).sort(), ['error', 'message']);
  const json = JSON.stringify(e);
  assert.ok(!json.includes('token abc123'), 'causa interna não pode serializar');
  assert.ok(!json.includes('sql secreto'));
  // mas acessível internamente para log controlado
  assert.ok(String(e.internalCause).includes('detalhe interno'));
});

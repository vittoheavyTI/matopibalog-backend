// sseConnections — limites de conexão SSE por usuário e por empresa (E1.6A).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const conns = require('../services/sseConnections');

beforeEach(() => conns._reset());

test('acquire incrementa; release decrementa; stats reflete', () => {
  assert.equal(conns.tryAcquire('u1', 'e1').ok, true);
  assert.equal(conns.tryAcquire('u1', 'e1').ok, true);
  let s = conns.stats();
  assert.equal(s.conexoes_ativas, 2);
  assert.equal(s.usuarios_conectados, 1);
  assert.equal(s.empresas_conectadas, 1);
  conns.release('u1', 'e1');
  conns.release('u1', 'e1');
  s = conns.stats();
  assert.equal(s.conexoes_ativas, 0);
  assert.equal(s.usuarios_conectados, 0, 'limpa a chave ao chegar a zero (sem leak)');
});

test('limite por usuário bloqueia a partir do teto', () => {
  const max = conns.MAX_POR_USUARIO;
  for (let i = 0; i < max; i++) assert.equal(conns.tryAcquire('u1', 'e1').ok, true);
  const r = conns.tryAcquire('u1', 'e1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'user_limit');
  // outro usuário da mesma empresa ainda entra
  assert.equal(conns.tryAcquire('u2', 'e1').ok, true);
});

test('limite por empresa bloqueia mesmo com usuários distintos', () => {
  const max = conns.MAX_POR_EMPRESA;
  for (let i = 0; i < max; i++) {
    // usuários distintos para não bater o limite por usuário antes
    assert.equal(conns.tryAcquire('u' + i, 'e1').ok, true);
  }
  const r = conns.tryAcquire('uX', 'e1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empresa_limit');
  // outra empresa não é afetada
  assert.equal(conns.tryAcquire('uY', 'e2').ok, true);
});

test('rejeição NÃO infla contador (só incrementa quando ok)', () => {
  const max = conns.MAX_POR_USUARIO;
  for (let i = 0; i < max; i++) conns.tryAcquire('u1', 'e1');
  conns.tryAcquire('u1', 'e1'); // rejeitado
  conns.tryAcquire('u1', 'e1'); // rejeitado
  // libera um: deve haver exatamente max-1 e permitir 1 novo
  conns.release('u1', 'e1');
  assert.equal(conns.tryAcquire('u1', 'e1').ok, true);
  const r = conns.tryAcquire('u1', 'e1');
  assert.equal(r.ok, false, 'de volta ao teto — a rejeição anterior não vazou vaga');
});

test('release abaixo de zero é seguro (nunca negativo)', () => {
  conns.release('u1', 'e1'); // sem acquire prévio
  const s = conns.stats();
  assert.equal(s.conexoes_ativas, 0);
  assert.equal(s.usuarios_conectados, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { plano_idValido, normalizarPlanoId } = require('../utils/plano');

test('plano_idValido aceita UUID canônico', () => {
  assert.equal(plano_idValido('21e4160b-1111-2222-3333-444455556666'), true);
  assert.equal(plano_idValido('E5AFECD6-AAAA-BBBB-CCCC-DDDDEEEE0000'), true); // maiúsculas
});

test('plano_idValido apara espaços em volta', () => {
  assert.equal(plano_idValido('  21e4160b-1111-2222-3333-444455556666  '), true);
});

test('plano_idValido rejeita texto que não é UUID', () => {
  assert.equal(plano_idValido('Plano Básico'), false);
  assert.equal(plano_idValido('123'), false);
  assert.equal(plano_idValido('21e4160b-1111-2222-3333'), false); // incompleto
  assert.equal(plano_idValido('zzzz160b-1111-2222-3333-444455556666'), false); // hex inválido
});

test('plano_idValido rejeita vazio, null, undefined e não-string', () => {
  assert.equal(plano_idValido(''), false);
  assert.equal(plano_idValido('   '), false);
  assert.equal(plano_idValido(null), false);
  assert.equal(plano_idValido(undefined), false);
  assert.equal(plano_idValido(123), false);
  assert.equal(plano_idValido({}), false);
});

test('normalizarPlanoId converte vazio/null/undefined em null', () => {
  assert.equal(normalizarPlanoId(''), null);
  assert.equal(normalizarPlanoId('   '), null);
  assert.equal(normalizarPlanoId(null), null);
  assert.equal(normalizarPlanoId(undefined), null);
});

test('normalizarPlanoId apara e preserva valor não-vazio', () => {
  assert.equal(normalizarPlanoId('  abc  '), 'abc');
  assert.equal(normalizarPlanoId('21e4160b-1111-2222-3333-444455556666'), '21e4160b-1111-2222-3333-444455556666');
});

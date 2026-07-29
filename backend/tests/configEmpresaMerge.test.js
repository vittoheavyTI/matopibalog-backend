const test = require('node:test');
const assert = require('node:assert/strict');

const { mesclarConfigEmpresa } = require('../utils/configEmpresaMerge');

test('preserva chaves existentes que não vieram no patch (logo + dados convivem)', () => {
  const atual = { nome: 'Alfa', cnpj: '00', logomarca: 'data:image/png;base64,AAA' };
  // salvar só os dados da empresa NÃO apaga a logomarca
  const r = mesclarConfigEmpresa(atual, { nome: 'Alfa LTDA', cnpj: '11' });
  assert.equal(r.nome, 'Alfa LTDA');
  assert.equal(r.cnpj, '11');
  assert.equal(r.logomarca, 'data:image/png;base64,AAA');
});

test('salvar só a logomarca NÃO apaga os dados da empresa', () => {
  const atual = { nome: 'Alfa', cnpj: '00' };
  const r = mesclarConfigEmpresa(atual, { logomarca: 'data:image/png;base64,BBB' });
  assert.equal(r.nome, 'Alfa');
  assert.equal(r.cnpj, '00');
  assert.equal(r.logomarca, 'data:image/png;base64,BBB');
});

test('null/undefined no patch são ignorados (não apagam)', () => {
  const atual = { logomarca: 'x', nome: 'Alfa' };
  const r = mesclarConfigEmpresa(atual, { logomarca: null, nome: undefined });
  assert.equal(r.logomarca, 'x');
  assert.equal(r.nome, 'Alfa');
});

test("string vazia '' é preservada (remoção intencional da logomarca)", () => {
  const atual = { logomarca: 'x', nome: 'Alfa' };
  const r = mesclarConfigEmpresa(atual, { logomarca: '' });
  assert.equal(r.logomarca, '');
  assert.equal(r.nome, 'Alfa');
});

test('config atual ausente/ inválida → trata como objeto vazio', () => {
  assert.deepEqual(mesclarConfigEmpresa(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mesclarConfigEmpresa(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(mesclarConfigEmpresa([], { a: 1 }), { a: 1 });
});

test('patch ausente → devolve cópia do atual', () => {
  const atual = { nome: 'Alfa' };
  const r = mesclarConfigEmpresa(atual, null);
  assert.deepEqual(r, { nome: 'Alfa' });
  assert.notEqual(r, atual); // cópia, não a mesma referência
});

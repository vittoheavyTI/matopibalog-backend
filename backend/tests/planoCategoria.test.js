// Helper puro de compatibilidade categoria×tipo (utils/planoCategoria) — a trava
// de servidor que impede autônomo em plano de empresa (e vice-versa).

const test = require('node:test');
const assert = require('node:assert/strict');

const { categoriaCompativelComTipo, mensagemIncompatibilidade } = require('../utils/planoCategoria');

test("categoria 'ambos' aceita qualquer tipo", () => {
  for (const tipo of ['autonomo', 'transportadora', 'fazenda', undefined, null]) {
    assert.equal(categoriaCompativelComTipo(tipo, 'ambos'), true, `tipo=${tipo}`);
  }
});

test("categoria 'autonomo' só aceita empresa autônoma", () => {
  assert.equal(categoriaCompativelComTipo('autonomo', 'autonomo'), true);
  assert.equal(categoriaCompativelComTipo('transportadora', 'autonomo'), false);
  assert.equal(categoriaCompativelComTipo('fazenda', 'autonomo'), false);
});

test("categoria 'empresa' recusa autônomo (caso José) e aceita os demais", () => {
  assert.equal(categoriaCompativelComTipo('autonomo', 'empresa'), false); // caso José
  assert.equal(categoriaCompativelComTipo('transportadora', 'empresa'), true);
  assert.equal(categoriaCompativelComTipo('fazenda', 'empresa'), true);
});

test('categoria ausente/desconhecida conta como ambos (compatível)', () => {
  for (const cat of [null, undefined, '', 'xyz']) {
    assert.equal(categoriaCompativelComTipo('autonomo', cat), true, `cat=${cat}`);
    assert.equal(categoriaCompativelComTipo('transportadora', cat), true, `cat=${cat}`);
  }
});

test('mensagem de incompatibilidade orienta o tipo correto', () => {
  assert.match(mensagemIncompatibilidade('autonomo'), /autônomo/i);
  assert.match(mensagemIncompatibilidade('transportadora'), /empresa/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { classificarResponsavelRegularizacao } = require('../utils/billingProfile');

test('admin de empresa regulariza pelo painel', () => {
  assert.equal(classificarResponsavelRegularizacao({ role: 'admin', empresaTipo: 'transportadora', temAdminAtivo: true }), 'painel');
});

test('admin de autônomo regulariza pelo painel', () => {
  assert.equal(classificarResponsavelRegularizacao({ role: 'admin', empresaTipo: 'autonomo', temAdminAtivo: true }), 'painel');
});

test('motorista vinculado procura o administrador da empresa', () => {
  assert.equal(classificarResponsavelRegularizacao({ role: 'motorista', empresaTipo: 'transportadora', temAdminAtivo: true }), 'admin_empresa');
});

test('autônomo com admin delega regularização ao administrador', () => {
  assert.equal(classificarResponsavelRegularizacao({ role: 'motorista', empresaTipo: 'autonomo', temAdminAtivo: true }), 'admin_autonomo');
});

test('autônomo puro regulariza pelo suporte no app', () => {
  assert.equal(classificarResponsavelRegularizacao({ role: 'motorista', empresaTipo: 'autonomo', temAdminAtivo: false }), 'autonomo');
});

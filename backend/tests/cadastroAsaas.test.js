// Helper puro de pré-validação do cadastro mínimo Asaas (utils/cadastroAsaas):
// a regra que impede a reserva órfã (fatura local sem asaas_id) nos fluxos de
// regularização e recorrência.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validarCadastroAsaasEmpresa,
  podeCriarCobranca,
  MOTIVO_CADASTRO_INCOMPLETO,
} = require('../utils/cadastroAsaas');

const COMPLETA = { nome: 'José Motora', cnpj: '390.533.447-05', email_contato: 'jose@example.com' };

test('cadastro completo (CPF mascarado conta 11 dígitos) → ok', () => {
  const r = validarCadastroAsaasEmpresa(COMPLETA);
  assert.deepEqual(r, { ok: true, motivo: null, camposFaltantes: [] });
});

test('CNPJ com 14 dígitos → ok', () => {
  const r = validarCadastroAsaasEmpresa({ ...COMPLETA, cnpj: '11.222.333/0001-81' });
  assert.equal(r.ok, true);
});

test('sem CPF/CNPJ → falta cpf_cnpj (caso José)', () => {
  for (const cnpj of [null, '', '   ', '123', '123456789012345']) {
    const r = validarCadastroAsaasEmpresa({ ...COMPLETA, cnpj });
    assert.equal(r.ok, false, String(cnpj));
    assert.equal(r.motivo, MOTIVO_CADASTRO_INCOMPLETO);
    assert.deepEqual(r.camposFaltantes, ['cpf_cnpj']);
  }
});

test('sem e-mail válido → falta email_contato', () => {
  for (const email of [null, '', 'sem-arroba', 'a@b']) {
    const r = validarCadastroAsaasEmpresa({ ...COMPLETA, email_contato: email });
    assert.equal(r.ok, false, String(email));
    assert.deepEqual(r.camposFaltantes, ['email_contato']);
  }
});

test('sem nome → falta nome; tudo vazio → lista os três', () => {
  assert.deepEqual(validarCadastroAsaasEmpresa({ ...COMPLETA, nome: '  ' }).camposFaltantes, ['nome']);
  assert.deepEqual(validarCadastroAsaasEmpresa({}).camposFaltantes, ['nome', 'cpf_cnpj', 'email_contato']);
  assert.deepEqual(validarCadastroAsaasEmpresa(null).camposFaltantes, ['nome', 'cpf_cnpj', 'email_contato']);
});

test('podeCriarCobranca: customer existente dispensa validação de cadastro', () => {
  const r = podeCriarCobranca({ asaas_customer_id: 'cus_1' }); // resto vazio
  assert.equal(r.ok, true);
});

test('podeCriarCobranca: sem customer aplica a validação', () => {
  const r = podeCriarCobranca({ asaas_customer_id: null, ...COMPLETA, cnpj: '' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, MOTIVO_CADASTRO_INCOMPLETO);
});

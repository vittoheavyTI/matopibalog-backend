// Hardening — validação de input das promoções (Zod → 422).
const test = require('node:test');
const assert = require('node:assert/strict');

const { criarPromocaoSchema, editarPromocaoSchema, gerarCodigoSchema, validar } = require('../schemas/promocao');

const BASE = {
  nome: 'Feira', tipo: 'desconto_percentual_mensalidade', percentual: 20,
  data_inicio: '2026-07-01T00:00:00Z', data_fim: '2026-12-31T00:00:00Z',
};

test('criar válido → ok', () => {
  const r = validar(criarPromocaoSchema, BASE);
  assert.equal(r.ok, true);
  assert.equal(r.data.percentual, 20);
});

test('nome vazio → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, nome: '' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
});

test('tipo inválido → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, tipo: 'hackerman' });
  assert.equal(r.ok, false);
});

test('percentual > 100 → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, percentual: 150 });
  assert.equal(r.ok, false);
  assert.equal(r.body.errors[0].campo, 'percentual');
});

test('coerência: tipo percentual sem percentual → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, percentual: null });
  assert.equal(r.ok, false);
  assert.match(r.body.errors[0].mensagem, /percentual/i);
});

test('coerência: tipo fixo sem valor → 422', () => {
  const r = validar(criarPromocaoSchema, { nome: 'X', tipo: 'desconto_fixo_mensalidade', data_inicio: BASE.data_inicio, data_fim: BASE.data_fim });
  assert.equal(r.ok, false);
});

test('isencao_implantacao não exige valor → ok', () => {
  const r = validar(criarPromocaoSchema, { nome: 'X', tipo: 'isencao_implantacao', data_inicio: BASE.data_inicio, data_fim: BASE.data_fim });
  assert.equal(r.ok, true);
});

test('data_fim < data_inicio → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, data_inicio: '2026-12-31T00:00:00Z', data_fim: '2026-01-01T00:00:00Z' });
  assert.equal(r.ok, false);
  assert.equal(r.body.errors[0].campo, 'data_fim');
});

test('plano_alvo_id não-UUID → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, plano_alvo_id: 'nao-e-uuid' });
  assert.equal(r.ok, false);
});

test('plano_alvo_id UUID legado (00000...0002) → ok', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, plano_alvo_id: '00000000-0000-0000-0000-000000000002' });
  assert.equal(r.ok, true);
});

test('limite_usos_total negativo → 422', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, limite_usos_total: -5 });
  assert.equal(r.ok, false);
});

test('coerce: percentual como string "20" → ok', () => {
  const r = validar(criarPromocaoSchema, { ...BASE, percentual: '20' });
  assert.equal(r.ok, true);
  assert.equal(r.data.percentual, 20);
});

test('editar parcial (só ativo) → ok', () => {
  const r = validar(editarPromocaoSchema, { ativo: false });
  assert.equal(r.ok, true);
});

test('editar com data_fim < data_inicio → 422', () => {
  const r = validar(editarPromocaoSchema, { data_inicio: '2026-12-01T00:00:00Z', data_fim: '2026-01-01T00:00:00Z' });
  assert.equal(r.ok, false);
});

test('código válido → ok', () => {
  const r = validar(gerarCodigoSchema, { codigo: 'FEIRA2026' });
  assert.equal(r.ok, true);
});

test('código curto demais → 422', () => {
  const r = validar(gerarCodigoSchema, { codigo: 'A' });
  assert.equal(r.ok, false);
});

test('código com caractere inseguro → 422', () => {
  const r = validar(gerarCodigoSchema, { codigo: 'DROP;TABLE' });
  assert.equal(r.ok, false);
});

test('código com limite_usos negativo → 422', () => {
  const r = validar(gerarCodigoSchema, { codigo: 'FEIRA', limite_usos: -1 });
  assert.equal(r.ok, false);
});

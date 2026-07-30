const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularAcertoMotoristas } = require('../utils/acertoMotorista');

const mot = (extra = {}) => ({
  usuarios: { nome: 'Motorista Teste' },
  percentual_comissao: 12,
  empresas: { tipo: 'transportadora', nome: 'Empresa Teste' },
  ...extra,
});
const frete = (id, valor, extra = {}) => ({
  id,
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  data: '2026-07-10',
  origem: 'A',
  destino: 'B',
  status: 'finalizado',
  valor_frete: valor,
  motoristas: mot(),
  ...extra,
});
const despesa = (valor, quem_pagou, extra = {}) => ({
  id: `d-${valor}-${quem_pagou}`,
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  frete_id: 'f1',
  data: '2026-07-10',
  tipo: 'geral',
  descricao: 'Despesa',
  valor,
  quem_pagou,
  status: 'aprovado',
  ...extra,
});
const abastecimento = (valor_total, quem_pagou, extra = {}) => ({
  id: `a-${valor_total}-${quem_pagou}`,
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  frete_id: 'f1',
  data: '2026-07-10',
  posto: 'Posto',
  valor_total,
  quem_pagou,
  status: 'aprovado',
  ...extra,
});
const vale = (valor, quem_pagou, extra = {}) => ({
  id: `v-${valor}-${quem_pagou}`,
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  frete_id: 'f1',
  data: '2026-07-10',
  descricao: 'Adiantamento',
  valor,
  quem_pagou,
  status: 'aprovado',
  ...extra,
});

test('somente comissão gera crédito e saldo a pagar', () => {
  const r = calcularAcertoMotoristas({ fretes: [frete('f1', 1000)] });
  assert.equal(r.resumo.total_creditos, 120);
  assert.equal(r.resumo.total_debitos, 0);
  assert.equal(r.resumo.saldo_acerto, 120);
  assert.equal(r.resumo.situacao, 'A pagar ao motorista');
  assert.equal(r.resumo.viagens_consideradas, 1);
});

test('despesa e abastecimento pagos pelo motorista entram como reembolso/crédito', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000)],
    despesas: [despesa(80, 'motorista')],
    abastecimentos: [abastecimento(200, 'motorista')],
  });
  assert.equal(r.resumo.total_creditos, 400);
  assert.equal(r.resumo.total_debitos, 0);
  assert.equal(r.resumo.saldo_acerto, 400);
});

test('despesa e abastecimento pagos pela empresa são informativos e não reduzem acerto', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000)],
    despesas: [despesa(80, 'proprietario')],
    abastecimentos: [abastecimento(200, 'proprietario')],
  });
  assert.equal(r.resumo.total_creditos, 120);
  assert.equal(r.resumo.total_debitos, 0);
  assert.equal(r.resumo.total_informativo, 280);
  assert.equal(r.resumo.saldo_acerto, 120);
});

test('vale pago pelo proprietário entra como débito do motorista', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000)],
    vales: [vale(50, 'proprietario'), vale(25, 'proprietario')],
  });
  assert.equal(r.resumo.total_creditos, 120);
  assert.equal(r.resumo.total_debitos, 75);
  assert.equal(r.resumo.saldo_acerto, 45);
});

test('saldo negativo fica como saldo a compensar, sem cobrança automática', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000)],
    vales: [vale(200, 'proprietario')],
  });
  assert.equal(r.resumo.saldo_acerto, -80);
  assert.equal(r.resumo.situacao, 'Saldo a compensar');
});

test('pendentes, rejeitados e frete cancelado não entram no acerto', () => {
  const r = calcularAcertoMotoristas({
    fretes: [
      frete('f1', 1000),
      frete('f2', 10000, { status: 'cancelado' }),
      frete('f3', 5000, { status: 'ativo' }),
    ],
    despesas: [
      despesa(100, 'motorista', { status: 'pendente' }),
      despesa(100, 'motorista', { status: 'rejeitado' }),
      despesa(100, 'motorista', { frete_id: 'f3' }),
    ],
  });
  assert.equal(r.resumo.total_creditos, 120);
  assert.equal(r.resumo.viagens_consideradas, 1);
  assert.equal(r.motoristas[0].itens.length, 1);
});

test('quem_pagou ausente gera item incompleto sem alterar saldo', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000)],
    despesas: [despesa(10, null)],
  });
  assert.equal(r.resumo.itens_incompletos, 1);
  assert.equal(r.resumo.saldo_acerto, 120);
  assert.equal(r.motoristas[0].itens.some((i) => i.classificacao === 'incompleto'), true);
});

test('múltiplos motoristas agregam resumo igual à soma dos itens', () => {
  const f2 = frete('f2', 2000, {
    motorista_id: 'mot-2',
    motoristas: mot({ usuarios: { nome: 'Motorista Dois' }, percentual_comissao: 10 }),
  });
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 1000), f2],
    vales: [vale(20, 'proprietario')],
  });
  const soma = r.motoristas.reduce((s, m) => s + m.resumo.saldo_acerto, 0);
  assert.equal(r.resumo.motoristas, 2);
  assert.equal(r.resumo.saldo_acerto, soma);
});

test('recorte Alfa validado: despesas da empresa não reduzem o saldo do motorista', () => {
  const r = calcularAcertoMotoristas({
    fretes: [frete('f1', 44391)],
    despesas: [despesa(312, 'proprietario')],
    abastecimentos: [abastecimento(5623, 'proprietario')],
  });
  assert.equal(r.resumo.total_creditos, 5326.92);
  assert.equal(r.resumo.total_informativo, 5935);
  assert.equal(r.resumo.saldo_acerto, 5326.92);
});

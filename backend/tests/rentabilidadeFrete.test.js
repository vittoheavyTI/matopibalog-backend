const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularRentabilidadeFrete,
  resumirRentabilidade,
  arred2,
} = require('../utils/rentabilidadeFrete');

const freteFin = (valor, extra = {}) => ({ id: 'f1', status: 'finalizado', valor_frete: valor, ...extra });
const ab = (valor_total, status = 'aprovado') => ({ valor_total, status });
const dp = (valor, tipo = 'geral', status = 'aprovado') => ({ valor, tipo, status });

test('arred2: evita erro de ponto flutuante', () => {
  assert.equal(arred2(0.1 + 0.2), 0.3);
  assert.equal(arred2(1000 * 1.1), 1100);
  assert.equal(arred2(null), 0);
});

test('valor fixo finalizado: receita = valor_frete, sem custos', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {}, 'transportadora', 0);
  assert.equal(r.receita_realizada, 1000);
  assert.equal(r.custos.total, 0);
  assert.equal(r.resultado_operacional, 1000);
  assert.equal(r.margem_percentual, 100);
  assert.equal(r.realizada, true);
});

test('em andamento (ativo): receita 0, resultado/margem null, alerta em_andamento', () => {
  const r = calcularRentabilidadeFrete({ id: 'f', status: 'ativo', valor_frete: 1000 }, {}, 'transportadora', 10);
  assert.equal(r.receita_realizada, 0);
  assert.equal(r.resultado_operacional, null);
  assert.equal(r.margem_percentual, null);
  assert.equal(r.realizada, false);
  assert.ok(r.alertas.includes('em_andamento'));
});

test('combustível: soma valor_total de múltiplos abastecimentos efetivados', () => {
  const r = calcularRentabilidadeFrete(freteFin(2000), {
    abastecimentos: [ab(300.5), ab(199.5), ab(100, 'pendente')], // pendente não conta
  }, 'transportadora', 0);
  assert.equal(r.custos.combustivel, 500);
  assert.ok(r.alertas.includes('lancamentos_pendentes'));
});

test('pedágio separado de outras despesas, sem duplicidade', () => {
  const r = calcularRentabilidadeFrete(freteFin(2000), {
    despesas: [dp(80, 'pedagio'), dp(20, 'pedagio'), dp(150, 'alimentacao'), dp(50, 'geral')],
  }, 'transportadora', 0);
  assert.equal(r.custos.pedagio, 100);
  assert.equal(r.custos.outras_despesas, 200);
  assert.equal(r.custos.total, 300);
});

test('comissão canônica (vinculado) entra uma única vez; não é despesa', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {}, 'transportadora', 12);
  assert.equal(r.custos.comissao, 120);
  assert.equal(r.custos.total, 120);
  assert.equal(r.resultado_operacional, 880);
});

test('autônomo: comissão 0 (regra canônica)', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {}, 'autonomo', 12);
  assert.equal(r.custos.comissao, 0);
});

test('tipo de empresa desconhecido: comissão 0 (nunca assume 12%)', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {}, '', 12);
  assert.equal(r.custos.comissao, 0);
});

test('margem negativa (prejuízo): custo > receita', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {
    abastecimentos: [ab(800)], despesas: [dp(400, 'geral')],
  }, 'transportadora', 0);
  assert.equal(r.custos.total, 1200);
  assert.equal(r.resultado_operacional, -200);
  assert.equal(r.margem_percentual, -20);
});

test('receita zero finalizado: margem null (não Infinity/NaN) + alertas', () => {
  const r = calcularRentabilidadeFrete(freteFin(0), { despesas: [dp(100, 'geral')] }, 'transportadora', 12);
  assert.equal(r.receita_realizada, 0);
  assert.equal(r.margem_percentual, null);
  assert.equal(r.resultado_operacional, -100);
  assert.ok(r.alertas.includes('receita_zero'));
  assert.ok(r.alertas.includes('custo_sem_receita'));
});

test('custo zero: margem 100', () => {
  const r = calcularRentabilidadeFrete(freteFin(500), {}, 'autonomo', 0);
  assert.equal(r.custos.total, 0);
  assert.equal(r.margem_percentual, 100);
});

test('valores nulos/strings: parse seguro, sem NaN', () => {
  const r = calcularRentabilidadeFrete(
    { id: 'f', status: 'finalizado', valor_frete: '1.000,00'.replace('.', '').replace(',', '.') },
    { abastecimentos: [ab(null), ab('abc')], despesas: [dp(undefined, 'pedagio')] },
    'transportadora', null,
  );
  assert.ok(Number.isFinite(r.receita_realizada));
  assert.ok(Number.isFinite(r.custos.total));
  assert.equal(r.custos.combustivel, 0);
  assert.equal(r.custos.pedagio, 0);
  assert.equal(r.custos.comissao, 0);
});

test('dados_completos = false quando há lançamento pendente', () => {
  const r = calcularRentabilidadeFrete(freteFin(1000), {
    despesas: [dp(50, 'geral', 'pendente')],
  }, 'transportadora', 0);
  assert.equal(r.dados_completos, false);
  assert.equal(r.custos.outras_despesas, 0); // pendente não soma
});

test('resumo: só realizado soma; em andamento contado à parte; div/0 → null', () => {
  const itens = [
    calcularRentabilidadeFrete(freteFin(1000), { despesas: [dp(200, 'geral')] }, 'transportadora', 10),
    calcularRentabilidadeFrete({ id: 'f2', status: 'ativo', valor_frete: 500 }, {}, 'transportadora', 10),
  ];
  const resumo = resumirRentabilidade(itens);
  assert.equal(resumo.receita_realizada, 1000);
  assert.equal(resumo.custo_direto, 300); // 200 outras + 100 comissão
  assert.equal(resumo.resultado_operacional, 700);
  assert.equal(resumo.margem_percentual, 70);
  assert.equal(resumo.viagens_finalizadas, 1);
  assert.equal(resumo.viagens_em_andamento, 1);

  const vazio = resumirRentabilidade([]);
  assert.equal(vazio.margem_percentual, null);
  assert.equal(vazio.receita_realizada, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS_FRETE_RECEITA_REALIZADA,
  STATUS_FRETE_EXCLUIDOS,
  STATUS_LANCAMENTO_EFETIVADO,
  STATUS_LANCAMENTO_NAO_COMPOE,
  freteContaComoReceita,
  freteEstaCancelado,
  lancamentoVinculadoAFreteCancelado,
  lancamentoEfetivado,
  lancamentoNaoCompoe,
  somarReceitaRealizada,
} = require('../utils/agregacaoFinanceiraFretes');

// ─── Constantes da regra oficial (decisão A) ─────────────────────────────────
test('constantes: receita realizada = finalizado; excluídos = [cancelado]', () => {
  assert.equal(STATUS_FRETE_RECEITA_REALIZADA, 'finalizado');
  assert.deepEqual(STATUS_FRETE_EXCLUIDOS, ['cancelado']);
});

// ─── freteContaComoReceita: SÓ finalizado conta ──────────────────────────────
test('freteContaComoReceita: finalizado → true', () => {
  assert.equal(freteContaComoReceita({ status: 'finalizado' }), true);
});
test('freteContaComoReceita: ativo/pendente/cancelado → false', () => {
  assert.equal(freteContaComoReceita({ status: 'ativo' }), false);
  assert.equal(freteContaComoReceita({ status: 'pendente' }), false);
  assert.equal(freteContaComoReceita({ status: 'cancelado' }), false);
});
test('freteContaComoReceita: status ausente/nulo → false (nunca conta)', () => {
  assert.equal(freteContaComoReceita({}), false);
  assert.equal(freteContaComoReceita(null), false);
});

// ─── freteEstaCancelado ──────────────────────────────────────────────────────
test('freteEstaCancelado: cancelado → true; demais → false', () => {
  assert.equal(freteEstaCancelado({ status: 'cancelado' }), true);
  assert.equal(freteEstaCancelado({ status: 'finalizado' }), false);
  assert.equal(freteEstaCancelado({ status: 'ativo' }), false);
});

// ─── somarReceitaRealizada: casos reais da auditoria ─────────────────────────
test('agregado: frete ATIVO R$234,56 → receita realizada 0 (caso Codex Transportadora)', () => {
  assert.equal(somarReceitaRealizada([{ status: 'ativo', valor_frete: 234.56 }]), 0);
});
test('agregado: frete FINALIZADO R$1.000 → receita realizada 1000', () => {
  assert.equal(somarReceitaRealizada([{ status: 'finalizado', valor_frete: 1000 }]), 1000);
});
test('agregado: frete CANCELADO R$37.800.000 → receita realizada 0 (outlier Alfa)', () => {
  assert.equal(somarReceitaRealizada([{ status: 'cancelado', valor_frete: 37800000 }]), 0);
});
test('agregado misto: só os finalizados somam', () => {
  const fretes = [
    { status: 'finalizado', valor_frete: 6500 },
    { status: 'finalizado', valor_frete: '3500' }, // string também soma
    { status: 'ativo', valor_frete: 234.56 },
    { status: 'pendente', valor_frete: 999 },
    { status: 'cancelado', valor_frete: 37800000 },
  ];
  assert.equal(somarReceitaRealizada(fretes), 10000);
});
test('somarReceitaRealizada: valor inválido/null não quebra (vira 0)', () => {
  assert.equal(somarReceitaRealizada([{ status: 'finalizado', valor_frete: null }]), 0);
  assert.equal(somarReceitaRealizada([]), 0);
  assert.equal(somarReceitaRealizada(undefined), 0);
});

// ─── lancamentoVinculadoAFreteCancelado: deduções de cancelados NÃO entram ───
test('lançamento vinculado a frete cancelado → excluído', () => {
  const cancelados = new Set(['frete-cancelado-1']);
  assert.equal(lancamentoVinculadoAFreteCancelado({ frete_id: 'frete-cancelado-1', valor: 5000 }, cancelados), true);
});
test('lançamento vinculado a frete NÃO cancelado (ex.: finalizado) → entra', () => {
  const cancelados = new Set(['frete-cancelado-1']);
  assert.equal(lancamentoVinculadoAFreteCancelado({ frete_id: 'frete-finalizado-9', valor: 300 }, cancelados), false);
});
test('lançamento SOLTO (sem frete_id) → nunca excluído por este critério', () => {
  const cancelados = new Set(['frete-cancelado-1']);
  assert.equal(lancamentoVinculadoAFreteCancelado({ frete_id: null }, cancelados), false);
  assert.equal(lancamentoVinculadoAFreteCancelado({ frete_id: '' }, cancelados), false);
  assert.equal(lancamentoVinculadoAFreteCancelado({}, cancelados), false);
});

// ─── E1.3 (D-035): fonte ÚNICA das regras de status de LANÇAMENTO ────────────
test('E1.3 constantes de lançamento: efetivado=[aprovado,finalizado]; não compõe=[cancelado,rejeitado]', () => {
  assert.deepEqual(STATUS_LANCAMENTO_EFETIVADO, ['aprovado', 'finalizado']);
  assert.deepEqual(STATUS_LANCAMENTO_NAO_COMPOE, ['cancelado', 'rejeitado']);
});

test('lancamentoEfetivado: aprovado/finalizado → true; pendente/cancelado/rejeitado/ausente → false', () => {
  assert.equal(lancamentoEfetivado({ status: 'aprovado' }), true);
  assert.equal(lancamentoEfetivado({ status: 'finalizado' }), true);
  assert.equal(lancamentoEfetivado({ status: 'pendente' }), false);
  assert.equal(lancamentoEfetivado({ status: 'cancelado' }), false);
  assert.equal(lancamentoEfetivado({ status: 'rejeitado' }), false);
  assert.equal(lancamentoEfetivado({}), false);
  assert.equal(lancamentoEfetivado(null), false);
});

test('lancamentoNaoCompoe: cancelado/rejeitado → true; aprovado/finalizado/pendente → false', () => {
  assert.equal(lancamentoNaoCompoe({ status: 'cancelado' }), true);
  assert.equal(lancamentoNaoCompoe({ status: 'rejeitado' }), true);
  assert.equal(lancamentoNaoCompoe({ status: 'aprovado' }), false);
  assert.equal(lancamentoNaoCompoe({ status: 'finalizado' }), false);
  assert.equal(lancamentoNaoCompoe({ status: 'pendente' }), false);
  assert.equal(lancamentoNaoCompoe({}), false);
});

test('E1.3 fonte única == valores legados que estavam espalhados nos consumidores', () => {
  // Equivalência com os literais que antes viviam em dashboard/rentabilidade/acerto/relatorios.
  assert.deepEqual([...STATUS_LANCAMENTO_EFETIVADO].sort(), ['aprovado', 'finalizado'].sort());
  assert.deepEqual([...STATUS_LANCAMENTO_NAO_COMPOE].sort(), ['cancelado', 'rejeitado'].sort());
});

test('regressão Q4: R$5.512 de deduções vinculadas a fretes cancelados não vazam', () => {
  // Espelha o dado real: 7 lançamentos vinculados aos fretes cancelados da Alfa.
  const cancelados = new Set(['c1', 'c2']);
  const lancamentos = [
    { frete_id: 'c1', valor: 100 },    // despesa vinculada a cancelado
    { frete_id: 'c1', valor: 5212 },   // abastecimento vinculado a cancelado
    { frete_id: 'c2', valor: 200 },    // vale vinculado a cancelado
    { frete_id: 'ok-finalizado', valor: 999 }, // válido, deve permanecer
    { frete_id: null, valor: 50 },     // solto, deve permanecer
  ];
  const total = lancamentos
    .filter((l) => !lancamentoVinculadoAFreteCancelado(l, cancelados))
    .reduce((s, l) => s + l.valor, 0);
  // Só sobra o válido (999) + o solto (50). Os 5.512 (100+5212+200) ficam de fora.
  assert.equal(total, 1049);
});

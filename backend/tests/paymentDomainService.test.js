const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarStatusAsaas,
  normalizarEventoAsaas,
  decidirAtualizacaoFatura,
  decidirTransicaoContaPorPagamento,
  avaliarElegibilidadeSuspensao,
} = require('../services/paymentDomainService');

test('pagamento: trial + RECEIVED/CONFIRMED/RECEIVED_IN_CASH -> ativo', () => {
  for (const status of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
    assert.equal(normalizarStatusAsaas(status).status, 'pago');
    const decisao = decidirTransicaoContaPorPagamento('trial', 'pago');
    assert.equal(decisao.deveAtualizar, true);
    assert.equal(decisao.novoStatus, 'ativo');
  }
});

test('pagamento: ativo permanece ativo e estados restritos nao reativam', () => {
  assert.equal(decidirTransicaoContaPorPagamento('ativo', 'pago').novoStatus, 'ativo');
  assert.equal(decidirTransicaoContaPorPagamento('ativo', 'pago').deveAtualizar, false);

  for (const status of ['suspenso', 'bloqueado', 'expirado']) {
    const decisao = decidirTransicaoContaPorPagamento(status, 'pago');
    assert.equal(decisao.deveAtualizar, false);
    assert.equal(decisao.novoStatus, status);
  }
});

test('status da fatura: mapeia pago, vencido, pendente, cancelado e estornado', () => {
  assert.equal(normalizarStatusAsaas('RECEIVED').status, 'pago');
  assert.equal(normalizarStatusAsaas('OVERDUE').status, 'vencido');
  assert.equal(normalizarStatusAsaas('PENDING').status, 'pendente');
  assert.equal(normalizarStatusAsaas('DELETED').status, 'cancelado');
  assert.equal(normalizarStatusAsaas('REFUNDED').status, 'estornado');
  assert.equal(normalizarEventoAsaas('PAYMENT_CONFIRMED').status, 'pago');
});

test('status desconhecido preserva estado anterior e fica ignorado', () => {
  const decisao = normalizarStatusAsaas('MYSTERY', 'pago');
  assert.equal(decisao.status, 'pago');
  assert.equal(decisao.conhecido, false);
  assert.equal(decisao.ignorado, true);
});

test('fatura paga nao rebaixa para vencida ou cancelada por evento fora de ordem', () => {
  for (const statusNovo of ['vencido', 'cancelado']) {
    const decisao = decidirAtualizacaoFatura({ statusAtual: 'pago', statusNovo, pagoEmAtual: '2026-07-10T00:00:00Z' });
    assert.equal(decisao.ignorar, true);
    assert.equal(decisao.statusFinal, 'pago');
  }
});

function empresa(overrides = {}) {
  return { id: 'empresa-1', status: 'trial', trial_ends_at: '2026-07-09T00:00:00.000Z', ...overrides };
}

function fatura(overrides = {}) {
  return {
    id: 'f1',
    empresa_id: 'empresa-1',
    status: 'pendente',
    due_date: '2026-07-09',
    invoice_url: 'https://example.com/pay',
    bank_slip_url: null,
    ...overrides,
  };
}

test('suspensao: vencimento ontem + fatura pendente + link -> elegivel', () => {
  const r = avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura(), hoje: '2026-07-10' });
  assert.equal(r.elegivel, true);
});

test('suspensao: vencimento hoje ou futuro nao e elegivel', () => {
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura({ due_date: '2026-07-10' }), hoje: '2026-07-10' }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura({ due_date: '2026-07-11' }), hoje: '2026-07-10' }).elegivel, false);
});

test('suspensao: sem fatura, outro tenant, sem link, erro ou trial ativo nao suspendem', () => {
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: null, hoje: '2026-07-10' }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura({ empresa_id: 'outra' }), hoje: '2026-07-10' }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura({ invoice_url: null, bank_slip_url: null }), hoje: '2026-07-10' }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa(), fatura: fatura(), hoje: '2026-07-10', erroConsulta: new Error('db') }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa({ trial_ends_at: '2026-07-10T23:59:59.000Z' }), fatura: fatura(), hoje: '2026-07-10' }).elegivel, false);
});

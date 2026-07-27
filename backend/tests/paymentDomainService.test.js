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

// Empresa ATIVA (trial já convertido) para isolar a regra de CARÊNCIA do trial.
// due_date = 2026-07-09 (D0). Carência padrão = 3 → suspende só a partir de D+3.
function empresaAtiva(overrides = {}) {
  return { id: 'empresa-1', status: 'ativo', ...overrides };
}

test('carencia D+3: D+0/D+1/D+2 NAO suspendem (dentro_carencia); D+3 suspende', () => {
  const base = { empresa: empresaAtiva(), fatura: fatura() }; // due 2026-07-09
  const d0 = avaliarElegibilidadeSuspensao({ ...base, hoje: '2026-07-09' });
  const d1 = avaliarElegibilidadeSuspensao({ ...base, hoje: '2026-07-10' });
  const d2 = avaliarElegibilidadeSuspensao({ ...base, hoje: '2026-07-11' });
  const d3 = avaliarElegibilidadeSuspensao({ ...base, hoje: '2026-07-12' });
  assert.equal(d0.elegivel, false); assert.equal(d0.razao, 'dentro_carencia');
  assert.equal(d1.elegivel, false); assert.equal(d1.razao, 'dentro_carencia');
  assert.equal(d2.elegivel, false); assert.equal(d2.razao, 'dentro_carencia');
  assert.equal(d3.elegivel, true);  assert.equal(d3.razao, 'elegivel_suspensao');
});

test('carencia configuravel: diasCarencia=0 suspende em D+1', () => {
  const r = avaliarElegibilidadeSuspensao({ empresa: empresaAtiva(), fatura: fatura(), hoje: '2026-07-10', diasCarencia: 0 });
  assert.equal(r.elegivel, true);
});

test('extensao manual ativa impede suspensao mesmo apos D+3 (prazo_estendido)', () => {
  const r = avaliarElegibilidadeSuspensao({
    empresa: empresaAtiva({ suspensao_prazo_ate: '2026-07-20' }),
    fatura: fatura(), hoje: '2026-07-12', // já seria D+3
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.razao, 'prazo_estendido');
});

test('extensao vencida volta a permitir suspensao', () => {
  const r = avaliarElegibilidadeSuspensao({
    empresa: empresaAtiva({ suspensao_prazo_ate: '2026-07-11' }), // ontem
    fatura: fatura(), hoje: '2026-07-12',
  });
  assert.equal(r.elegivel, true);
  assert.equal(r.razao, 'elegivel_suspensao');
});

test('suspensao: sem fatura, outro tenant, sem link (pos-carencia), erro ou trial ativo nao suspendem', () => {
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresaAtiva(), fatura: null, hoje: '2026-07-12' }).elegivel, false);
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresaAtiva(), fatura: fatura({ empresa_id: 'outra' }), hoje: '2026-07-12' }).elegivel, false);
  const semLink = avaliarElegibilidadeSuspensao({ empresa: empresaAtiva(), fatura: fatura({ invoice_url: null, bank_slip_url: null }), hoje: '2026-07-12' });
  assert.equal(semLink.elegivel, false); assert.equal(semLink.razao, 'sem_caminho_regularizacao');
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresaAtiva(), fatura: fatura(), hoje: '2026-07-12', erroConsulta: new Error('db') }).elegivel, false);
  // trial ainda ativo (trial_ends_at futuro) nunca suspende.
  assert.equal(avaliarElegibilidadeSuspensao({ empresa: empresa({ trial_ends_at: '2026-07-20T23:59:59.000Z' }), fatura: fatura(), hoje: '2026-07-12' }).elegivel, false);
});

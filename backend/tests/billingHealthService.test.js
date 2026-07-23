// Go-live PR2: agregação pura de billing health. Prova cada sinal a partir de
// listas controladas, sem I/O.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resumirBillingHealth } = require('../services/billingHealthService');

const HOJE = new Date('2026-07-22T12:00:00Z');

function fatura(over = {}) {
  return {
    id: 'f' + Math.random().toString(36).slice(2, 7),
    empresa_id: 'e1', status: 'pendente', valor: 149.9, origem: null,
    periodo_referencia: null, asaas_id: 'pay_x', invoice_url: 'https://s/i/x',
    bank_slip_url: null, due_date: '2026-08-01', pago_em: null, ...over,
  };
}

test('base saudável → ok=true e contadores zerados', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'pago', valor: 100 }), fatura({ status: 'pendente' })],
    empresas: [{ id: 'e1', nome: 'Alfa', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    webhookEvents: [{ event_type: 'PAYMENT_RECEIVED', status: 'processed', last_error: null }],
    hoje: HOJE,
  });
  assert.equal(r.ok, true);
  assert.equal(r.totais.total, 2);
  assert.equal(r.totais.pagas, 1);
  assert.equal(r.totais.total_pago, 100);
  assert.equal(r.totais.abertas, 1);
  for (const v of Object.values(r.contadores)) assert.equal(v, 0);
});

test('fatura sem asaas_id é sinalizada (reserva órfã)', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 1);
  assert.equal(r.detalhes.faturas_sem_asaas_id[0].origem, 'regularizacao');
  assert.equal(r.ok, false);
});

test('fatura aberta sem link (nem invoice_url nem boleto) é sinalizada', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ invoice_url: null, bank_slip_url: null })], hoje: HOJE });
  assert.equal(r.contadores.faturas_abertas_sem_link, 1);
});

test('vencida = aberta com due_date < hoje', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'vencido', due_date: '2026-07-01' }), fatura({ status: 'pendente', due_date: '2026-08-01' })],
    hoje: HOJE,
  });
  assert.equal(r.contadores.vencidas, 1);
  assert.equal(r.detalhes.vencidas[0].due_date, '2026-07-01');
});

test('duplicidade por empresa/origem/período > 1', () => {
  const r = resumirBillingHealth({
    faturas: [
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-07-01' }),
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-07-01' }),
      // mesma empresa, período diferente → não é duplicata
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-08-01' }),
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.duplicidade, 1);
  assert.equal(r.detalhes.duplicidade[0].qtd, 2);
});

test('regularizacao da mesma competência para empresas diferentes NÃO é duplicidade', () => {
  const r = resumirBillingHealth({
    faturas: [
      fatura({ empresa_id: 'e1', origem: 'regularizacao', periodo_referencia: '2026-07-01' }),
      fatura({ empresa_id: 'e2', origem: 'regularizacao', periodo_referencia: '2026-07-01' }),
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.duplicidade, 0);
});

test('suspensa sem fatura aberta é sinalizada; suspensa com fatura aberta não', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ empresa_id: 'e2', status: 'pendente' })],
    empresas: [
      { id: 'e1', nome: 'SemFatura', tipo: 'autonomo', status: 'suspenso', suspension_reason: 'financial' },
      { id: 'e2', nome: 'ComFatura', tipo: 'autonomo', status: 'suspenso', suspension_reason: 'financial' },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspensas_sem_fatura, 1);
  assert.equal(r.detalhes.suspensas_sem_fatura[0].nome, 'SemFatura');
});

test('suspensa com fatura PAGA é sinalizada (bug de reativação, deveria ser 0)', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ empresa_id: 'e1', status: 'pago' })],
    empresas: [{ id: 'e1', nome: 'Presa', tipo: 'autonomo', status: 'suspenso', suspension_reason: null }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspensas_com_fatura_paga, 1);
  assert.equal(r.ok, false);
});

test('categoria incompatível (autônomo em plano empresa) é sinalizada', () => {
  const r = resumirBillingHealth({
    empresas: [
      { id: 'e1', nome: 'José', tipo: 'autonomo', status: 'ativo', planos: { categoria: 'empresa' } },
      { id: 'e2', nome: 'OK', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } },
      { id: 'e3', nome: 'SemPlano', tipo: 'autonomo', status: 'ativo', planos: null },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.categoria_incompativel, 1);
  assert.equal(r.detalhes.categoria_incompativel[0].nome, 'José');
});

test('webhook com erro é contado; contagem por status agregada', () => {
  const r = resumirBillingHealth({
    webhookEvents: [
      { event_type: 'PAYMENT_RECEIVED', status: 'processed', last_error: null },
      { event_type: 'PAYMENT_RECEIVED', status: 'failed', last_error: 'erro_atualizar_fatura', asaas_payment_id: 'pay_1' },
      { event_type: 'PAYMENT_CREATED', status: 'ignored', last_error: 'evento_sem_pagamento' },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.webhook_com_erro, 1);
  assert.equal(r.detalhes.webhook_com_erro[0].asaas_payment_id, 'pay_1');
  assert.equal(r.detalhes.webhook_por_status.processed, 1);
  assert.equal(r.detalhes.webhook_por_status.failed, 1);
  assert.equal(r.detalhes.webhook_por_status.ignored, 1);
});

test('entradas vazias não quebram (retorna estrutura zerada)', () => {
  const r = resumirBillingHealth({});
  assert.equal(r.ok, true);
  assert.equal(r.totais.total, 0);
});

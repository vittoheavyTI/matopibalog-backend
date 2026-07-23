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

test('fatura ABERTA sem asaas_id é sinalizada (reserva órfã crítica)', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'pendente' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 1);
  assert.equal(r.detalhes.faturas_sem_asaas_id[0].origem, 'regularizacao');
  assert.equal(r.ok, false);
});

test('fatura VENCIDA sem asaas_id também entra no alerta crítico', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'vencido', due_date: '2026-07-01' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 1);
  assert.equal(r.ok, false);
});

test('fatura CANCELADA sem asaas_id NÃO entra no alerta crítico (vai p/ informativo)', () => {
  // Espelha a limpeza da migration 034: órfã soft-cancelada é inofensiva.
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'cancelado' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 0, 'cancelada não é problema crítico');
  assert.equal(r.contadores.faturas_canceladas_sem_asaas_id, 1, 'entra no contador informativo');
  assert.equal(r.detalhes.faturas_canceladas_sem_asaas_id[0].status, 'cancelado');
  assert.equal(r.ok, true, 'órfã cancelada não derruba o ok');
});

test('cenário pós-034: 9 canceladas sem asaas_id + 0 abertas órfãs → ok=true', () => {
  const faturas = [];
  for (let i = 0; i < 9; i++) faturas.push(fatura({ asaas_id: null, origem: 'regularizacao', status: 'cancelado' }));
  // 4 regularizações reais com asaas_id, abertas
  for (let i = 0; i < 4; i++) faturas.push(fatura({ status: 'pendente', origem: 'regularizacao', asaas_id: 'pay_' + i }));
  const r = resumirBillingHealth({ faturas, hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 0);
  assert.equal(r.contadores.faturas_canceladas_sem_asaas_id, 9);
  assert.equal(r.ok, true);
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

// ─── Sinais INFORMATIVOS (não derrubam `ok`) ─────────────────────────────────

test('empresa ativa sem plano → informativo, ok NÃO cai', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'SemPlano', tipo: 'transportadora', status: 'ativo', plano_id: null, planos: null }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_sem_plano, 1);
  assert.equal(r.detalhes.empresa_sem_plano[0].nome, 'SemPlano');
  assert.equal(r.ok, true, 'sinal informativo não derruba o ok');
});

test('empresa suspensa sem plano NÃO conta como empresa_sem_plano (não é cobrável esperado)', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'Susp', tipo: 'transportadora', status: 'suspenso', plano_id: null, planos: null, suspension_reason: 'financial' }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_sem_plano, 0);
});

test('plano inativo/arquivado vinculado a conta cobrável → informativo', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'A', tipo: 'transportadora', status: 'ativo', plano_id: 'p1', planos: { id: 'p1', nome: 'Velho', categoria: 'empresa', ativo: false, arquivado_em: null } },
      { id: 'e2', nome: 'B', tipo: 'transportadora', status: 'trial', plano_id: 'p2', planos: { id: 'p2', nome: 'Arq', categoria: 'empresa', ativo: true, arquivado_em: '2026-01-01T00:00:00Z' } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.plano_inativo_ou_arquivado, 2);
  assert.equal(r.ok, true);
});

test('trial vencido sem fatura aberta → informativo; com fatura aberta NÃO conta', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e2', status: 'pendente' }],
    empresas: [
      { id: 'e1', nome: 'TrialVenc', tipo: 'autonomo', status: 'trial', trial_ends_at: '2026-07-01', plano_id: 'p1', planos: { id: 'p1', categoria: 'autonomo', ativo: true, arquivado_em: null } },
      { id: 'e2', nome: 'TrialVencComFat', tipo: 'autonomo', status: 'trial', trial_ends_at: '2026-07-01', plano_id: 'p1', planos: { id: 'p1', categoria: 'autonomo', ativo: true, arquivado_em: null } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.trial_vencido_sem_fatura, 1);
  assert.equal(r.detalhes.trial_vencido_sem_fatura[0].nome, 'TrialVenc');
  assert.equal(r.ok, true);
});

test('assinatura Asaas ativa é informativa', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'ComAssinatura', tipo: 'transportadora', status: 'ativo', plano_id: 'p1', asaas_subscription_id: 'sub_123', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.assinatura_asaas_ativa, 1);
  assert.equal(r.detalhes.assinatura_asaas_ativa[0].asaas_subscription_id, 'sub_123');
  assert.equal(r.ok, true);
});

test('suspensa sem motivo registrado → suspension_reason_inconsistente (informativo)', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'SemMotivo', tipo: 'transportadora', status: 'suspenso', suspension_reason: null, plano_id: 'p1', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspension_reason_inconsistente, 1);
  assert.equal(r.ok, true, 'informativo não derruba ok');
});

test('suspensa com motivo válido (financial) NÃO é inconsistente', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'ComMotivo', tipo: 'transportadora', status: 'suspenso', suspension_reason: 'financial', plano_id: 'p1', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspension_reason_inconsistente, 0);
});

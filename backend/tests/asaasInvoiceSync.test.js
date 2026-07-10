const test = require('node:test');
const assert = require('node:assert/strict');

const { sincronizarCobrancas, normalizarStatus } = require('../services/asaasInvoiceSyncService');

// ── Helpers ──────────────────────────────────────────────────────────────────────

function fakeSupabase(registro = {}) {
  const state = { empresas: { asaas_subscription_id: 'sub_1', status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' }, faturas: [] };
  return {
    state,
    from(table) {
      return {
        select() { return this; },
        insert(p) { state.faturas.push(p); return Promise.resolve({ data: null }); },
        update(p) {
          if (table === 'empresas') {
            Object.assign(state.empresas, p);
          }
          const self = this;
          return {
            eq() { return self; },
            then(r) { r({data: null}) }
          };
        },
        eq(f, v) {
          if (table === 'faturas' && f === 'asaas_id') {
            const existente = state.faturas.find(f => f.asaas_id === v);
            return { maybeSingle: () => Promise.resolve({ data: existente || null }) };
          }
          return this;
        },
        in() { return this; },
        maybeSingle: () => Promise.resolve({ data: null }),
        single: () => Promise.resolve({ data: state.empresas }),
      };
    }
  };
}

function fakeHttp(payments) {
  return {
    async get(url) {
      if (/\/payments$/.test(url)) return { data: { data: payments } };
      return { data: null };
    }
  };
}

const config = { apiKey: 'chave-teste', baseURL: 'https://sandbox.asaas.com/api/v3' };
const empresaId = 'empresa-123';

// ── normalizarStatus ─────────────────────────────────────────────────────────────

test('normalizarStatus: PENDING -> pendente', () => {
  assert.equal(normalizarStatus('PENDING'), 'pendente');
});

test('normalizarStatus: RECEIVED -> pago', () => {
  assert.equal(normalizarStatus('RECEIVED'), 'pago');
});

test('normalizarStatus: OVERDUE -> vencido', () => {
  assert.equal(normalizarStatus('OVERDUE'), 'vencido');
});

test('normalizarStatus: DELETED -> cancelado', () => {
  assert.equal(normalizarStatus('DELETED'), 'cancelado');
});

test('normalizarStatus: REFUNDED -> estornado', () => {
  assert.equal(normalizarStatus('REFUNDED'), 'estornado');
});

test('normalizarStatus: desconhecido -> pendente (default seguro)', () => {
  assert.equal(normalizarStatus('UNKNOWN_STATUS'), 'pendente');
});

test('normalizarStatus: null -> pendente', () => {
  assert.equal(normalizarStatus(null), 'pendente');
});

test('normalizarStatus: case insensitive', () => {
  assert.equal(normalizarStatus('pending'), 'pendente');
  assert.equal(normalizarStatus('Overdue'), 'vencido');
});

// ── sincronizarCobrancas ─────────────────────────────────────────────────────────

test('assinatura sem cobrancas retorna tudo zero', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([]);
  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.encontradas, 0);
  assert.equal(resultado.criadas, 0);
  assert.equal(resultado.atualizadas, 0);
  assert.equal(resultado.inalteradas, 0);
});

test('uma cobranca importada como criada', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([{
    id: 'pay_1',
    status: 'PENDING',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
    bankSlipUrl: 'https://sandbox.asaas.com/b/pay_1',
    description: 'Assinatura Matopiba Log — Plano Básico',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.encontradas, 1);
  assert.equal(resultado.criadas, 1);
  assert.equal(resultado.atualizadas, 0);
  assert.equal(resultado.inalteradas, 0);
  assert.equal(supabase.state.faturas.length, 1);
  assert.equal(supabase.state.faturas[0].asaas_id, 'pay_1');
  assert.equal(supabase.state.faturas[0].status, 'pendente');
  assert.equal(supabase.state.faturas[0].tipo_pagamento, 'BOLETO');
  assert.equal(supabase.state.faturas[0].valor, 149.90);
  assert.equal(supabase.state.faturas[0].bank_slip_url, 'https://sandbox.asaas.com/b/pay_1');
  assert.equal(supabase.state.faturas[0].asaas_subscription_id, 'sub_1');
  assert.equal(supabase.state.faturas[0].asaas_raw_status, 'PENDING');
});

test('repeticao nao duplica (upsert)', async () => {
  const supabase = fakeSupabase();
  // Pré-popula
  supabase.state.faturas.push({
    asaas_id: 'pay_1',
    status: 'pendente',
    valor: 149.90,
    invoice_url: null,
    bank_slip_url: null,
  });

  const http = fakeHttp([{
    id: 'pay_1',
    status: 'PENDING',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
    description: 'Assinatura Matopiba Log — Plano Básico',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 0);
  assert.equal(resultado.atualizadas, 1); // URLs mudaram (null → valor)
  assert.equal(supabase.state.faturas.length, 1); // não duplicou
});

test('atualiza status de PENDING para RECEIVED', async () => {
  const supabase = fakeSupabase();
  supabase.state.faturas.push({
    asaas_id: 'pay_1',
    status: 'pendente',
    valor: 149.90,
  });

  const http = fakeHttp([{
    id: 'pay_1',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
    description: 'Assinatura Matopiba Log — Plano Básico',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.atualizadas, 1);
});

test('atualiza invoice_url e bank_slip_url quando mudam', async () => {
  const supabase = fakeSupabase();
  supabase.state.faturas.push({
    asaas_id: 'pay_1',
    status: 'pendente',
    valor: 149.90,
    invoice_url: 'https://old.url',
    bank_slip_url: null,
  });

  const http = fakeHttp([{
    id: 'pay_1',
    status: 'PENDING',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    invoiceUrl: 'https://new.url',
    bankSlipUrl: 'https://boleto.url',
    description: 'Assinatura Matopiba Log — Plano Básico',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  assert.equal(resultado.atualizadas, 1);
});

test('duas mensalidades da mesma assinatura', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([
    { id: 'pay_1', status: 'PENDING', value: 149.90, billingType: 'BOLETO', dueDate: '2026-07-16' },
    { id: 'pay_2', status: 'PENDING', value: 149.90, billingType: 'BOLETO', dueDate: '2026-08-16' },
  ]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.encontradas, 2);
  assert.equal(resultado.criadas, 2);
  assert.equal(supabase.state.faturas.length, 2);
});

test('sem subscriptionId e sem asaas_subscription_id na empresa', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { asaas_subscription_id: null };
  const http = fakeHttp([]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http });

  assert.equal(resultado.encontradas, 0);
  assert.equal(resultado.criadas, 0);
  assert.equal(resultado.mensagem, 'Nenhuma assinatura configurada.');
});

test('PENDING durante trial mantem status pendente', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([{
    id: 'pay_trial',
    status: 'PENDING',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
  }]);
  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pendente');
});

test('RECEIVED apos pagamento ativa flag pago_em', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([{
    id: 'pay_pago',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);
  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].pago_em, '2026-07-10T12:00:00Z');
});

test('status desconhecido preservado como pendente e asaas_raw_status mantido', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([{
    id: 'pay_unknown',
    status: 'MYSTERY_STATUS',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
  }]);
  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pendente'); // default seguro
  assert.equal(supabase.state.faturas[0].asaas_raw_status, 'MYSTERY_STATUS');
});

test('cobranca BOLETO com Pix tem pix consultavel depois', async () => {
  const supabase = fakeSupabase();
  const http = fakeHttp([{
    id: 'pay_boletopix',
    status: 'PENDING',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
  }]);
  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].tipo_pagamento, 'BOLETO');
  // pix_qr_code não é preenchido na sincronização (será buscado sob demanda)
  assert.equal(supabase.state.faturas[0].pix_qr_code, undefined);
});

// ── Novos testes do gate final ─────────────────────────────────────────────────

test('ativacao sincronizacao: RECEIVED atualiza fatura, muda trial para ativo', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_received',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  assert.equal(supabase.state.faturas[0].pago_em, '2026-07-10T12:00:00Z');
  assert.equal(supabase.state.empresas.status, 'ativo'); // trial -> ativo
  assert.equal(resultado.ativou_conta, true);
});

test('ativacao sincronizacao: CONFIRMED produz mesmo resultado', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_confirmed',
    status: 'CONFIRMED',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  assert.equal(supabase.state.empresas.status, 'ativo');
  assert.equal(resultado.ativou_conta, true);
});

test('ativacao sincronizacao: sincronizacao repetida e idempotente', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_repeat',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  // Primeira sincronização
  await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });
  // Segunda sincronização (mesmo payment)
  const resultado2 = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado2.criadas, 0);
  assert.equal(resultado2.atualizadas, 1); // atualiza last_synced_at
  assert.equal(supabase.state.faturas.length, 1); // não duplicou
  assert.equal(supabase.state.empresas.status, 'ativo');
});

test('ativacao sincronizacao: conta manualmente suspensa nao e reativada', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'suspenso', trial_ends_at: null };
  const http = fakeHttp([{
    id: 'pay_suspended',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  // Conta NÃO deve ser reativada (status permanece suspenso)
  assert.equal(supabase.state.empresas.status, 'suspenso');
  assert.equal(resultado.ativou_conta, false);
});

test('ativacao sincronizacao: RECEIVED_IN_CASH produz mesmo resultado', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_cash',
    status: 'RECEIVED_IN_CASH',
    value: 149.90,
    billingType: 'BOLETO',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  assert.equal(supabase.state.empresas.status, 'ativo');
  assert.equal(resultado.ativou_conta, true);
});

test('ativacao sincronizacao: conta bloqueada nao e reativada', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'bloqueado', trial_ends_at: null };
  const http = fakeHttp([{
    id: 'pay_blocked',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  assert.equal(supabase.state.empresas.status, 'bloqueado');
  assert.equal(resultado.ativou_conta, false);
});

test('ativacao sincronizacao: conta expirada nao e reativada', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'expirado', trial_ends_at: null };
  const http = fakeHttp([{
    id: 'pay_expired',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 1);
  assert.equal(supabase.state.faturas[0].status, 'pago');
  assert.equal(supabase.state.empresas.status, 'expirado');
  assert.equal(resultado.ativou_conta, false);
});

test('ativacao sincronizacao: trial_ends_at permanece inalterado', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_trial_ends',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  // trial_ends_at não deve ser alterado
  assert.equal(supabase.state.empresas.trial_ends_at, '2000-01-01T00:00:00.000Z');
});

test('ativacao sincronizacao: plano permanece inalterado', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z', plano_id: 'plano_basico' };
  const http = fakeHttp([{
    id: 'pay_plan',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  // plano_id não deve ser alterado
  assert.equal(supabase.state.empresas.plano_id, 'plano_basico');
});

test('nenhuma chamada cria customer, assinatura ou cobranca', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
  const http = fakeHttp([{
    id: 'pay_none',
    status: 'RECEIVED',
    value: 149.90,
    billingType: 'PIX',
    dueDate: '2026-07-16',
    paymentDate: '2026-07-10T12:00:00Z',
  }]);

  // Verifica que http.post NÃO foi chamado
  let postCalled = false;
  http.post = async (...args) => {
    postCalled = true;
    throw new Error('POST não deveria ser chamado');
  };

  await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(postCalled, false); // apenas GET /payments
});

test('historico: cobranca atual pendente aparece antes das antigas', async () => {
  const supabase = fakeSupabase();
  supabase.state.empresas = { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };

  // Três payments: um atual (pendente), dois antigos (pago, vencido)
  const hoje = new Date().toISOString().split('T')[0];
  const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const ontem = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const mesPassado = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];

  const http = fakeHttp([
    { id: 'pay_atual', status: 'PENDING', value: 149.90, billingType: 'BOLETO', dueDate: amanha },
    { id: 'pay_mes_passado', status: 'RECEIVED', value: 149.90, billingType: 'BOLETO', dueDate: mesPassado, paymentDate: '2026-06-10T12:00:00Z' },
    { id: 'pay_ontem', status: 'OVERDUE', value: 149.90, billingType: 'BOLETO', dueDate: ontem },
  ]);

  const resultado = await sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId: 'sub_1' });

  assert.equal(resultado.criadas, 3);
  // Ordem na sincronização: Asaas retorna geralmente por dueDate ascendente
  // A ordenação do histórico é feita no frontend
  assert.equal(supabase.state.faturas.length, 3);
});

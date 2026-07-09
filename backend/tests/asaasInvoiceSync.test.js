const test = require('node:test');
const assert = require('node:assert/strict');

const { sincronizarCobrancas, normalizarStatus } = require('../services/asaasInvoiceSyncService');

// ── Helpers ──────────────────────────────────────────────────────────────────────

function fakeSupabase(registro = {}) {
  const state = { empresas: { asaas_subscription_id: 'sub_1' }, faturas: [] };
  return {
    state,
    from(table) {
      return {
        select() { return this; },
        insert(p) { state.faturas.push(p); return Promise.resolve({ data: null }); },
        update(p) { const self = this; return { eq() { return self; }, then(r) { r({data: null}) } }; },
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

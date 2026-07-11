const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inserirOuReivindicar,
  marcarProcessado,
  marcarFalhou,
  normalizarParaHash,
  sanitizar,
} = require('../services/asaasWebhookEventRepository');
const { calcularPayloadHash } = require('../utils/webhookHash');

function criarSupabaseCaptura() {
  const eventos = new Map();
  const capturas = { inserts: [], updates: [] };

  return {
    capturas,
    from(tabela) {
      const ctx = { tabela, filtros: {}, payload: null, op: 'select' };
      const api = {
        insert(payload) {
          ctx.op = 'insert';
          ctx.payload = payload;
          capturas.inserts.push({ tabela, payload });
          return api;
        },
        update(payload) {
          ctx.op = 'update';
          ctx.payload = payload;
          capturas.updates.push({ tabela, payload });
          return api;
        },
        select() {
          return api;
        },
        eq(campo, valor) {
          ctx.filtros[campo] = valor;
          return api;
        },
        single() {
          if (ctx.op === 'insert') {
            const evento = {
              id: `id_${eventos.size + 1}`,
              ...ctx.payload,
            };
            eventos.set(evento.event_id, evento);
            return Promise.resolve({ data: { ...evento }, error: null });
          }
          if (ctx.op === 'update') {
            const evento = eventos.get(ctx.filtros.event_id);
            if (!evento) {
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            for (const [campo, valor] of Object.entries(ctx.filtros)) {
              if (evento[campo] !== valor) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
            }
            Object.assign(evento, ctx.payload);
            return Promise.resolve({ data: { ...evento }, error: null });
          }
          return Promise.resolve({ data: eventos.get(ctx.filtros.event_id) || null, error: null });
        },
      };
      return api;
    },
  };
}

function payloadSensivel(overrides = {}) {
  return {
    id: 'evt_123',
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_123',
      status: 'CONFIRMED',
      billingType: 'PIX',
      dueDate: '2026-07-10',
      confirmedDate: '2026-07-10',
      paymentDate: '2026-07-10',
      customer: {
        id: 'cus_123',
        email: 'cliente@example.com',
        phone: '11999998888',
        cpfCnpj: '12345678901',
        address: 'Rua Teste, 123',
      },
      subscription: 'sub_123',
      externalReference: 'empresa-externa',
      creditCard: { creditCardNumber: '4111111111111111' },
      invoiceUrl: 'https://sandbox.asaas.com/i/pay_123',
      pixQrCode: '00020101021226880014br.gov.bcb.pix',
      ...overrides.payment,
    },
    token: 'Bearer segredo-super-longo-123',
    ...overrides,
  };
}

test('normalizacao e insert do evento nao armazenam payload bruto nem PII', async () => {
  const supabase = criarSupabaseCaptura();
  const body = payloadSensivel();

  const resultado = await inserirOuReivindicar(supabase, body, normalizarParaHash(body));

  assert.equal(resultado.code, 'inserted');
  const insert = supabase.capturas.inserts.find((item) => item.tabela === 'asaas_webhook_events');
  assert.ok(insert);
  assert.deepEqual(Object.keys(insert.payload).sort(), [
    'asaas_payment_id',
    'attempts',
    'event_id',
    'event_type',
    'payload_hash',
    'processing_started_at',
    'status',
  ]);

  const serializado = JSON.stringify(insert.payload);
  for (const proibido of [
    'cliente@example.com',
    '11999998888',
    '12345678901',
    'Rua Teste',
    'externalReference',
    '4111111111111111',
    '000201010212',
    'segredo-super-longo',
    'cus_123',
  ]) {
    assert.equal(serializado.includes(proibido), false, proibido);
  }
});

test('sanitizar remove identificadores externos, documentos, telefone, URL, e-mail e segredo', () => {
  const mensagem = [
    'erro em pay_123 para cus_999 sub_abc',
    'email cliente@example.com',
    'cpf 12345678901 telefone 11999998888',
    'url https://sandbox.asaas.com/i/pay_123',
    'Authorization Bearer token-super-secreto',
    'apiKey=outra-chave-secreta',
  ].join(' ');

  const resultado = sanitizar(mensagem);

  for (const proibido of [
    'pay_123',
    'cus_999',
    'sub_abc',
    'cliente@example.com',
    '12345678901',
    '11999998888',
    'https://',
    'token-super-secreto',
    'outra-chave-secreta',
  ]) {
    assert.equal(resultado.includes(proibido), false, proibido);
  }
});

test('last_error gravado em failed e limitado e sanitizado', async () => {
  const supabase = criarSupabaseCaptura();
  const body = payloadSensivel({ id: 'evt_failed' });
  await inserirOuReivindicar(supabase, body, normalizarParaHash(body));

  const resultado = await marcarFalhou(
    supabase,
    'evt_failed',
    `falha ${'x'.repeat(900)} pay_123 cliente@example.com 12345678901 https://sandbox.asaas.com/i/pay_123`
  );

  assert.equal(resultado.code, 'marked_failed');
  assert.ok(resultado.evento.last_error.length <= 500);
  assert.equal(resultado.evento.last_error.includes('pay_123'), false);
  assert.equal(resultado.evento.last_error.includes('cliente@example.com'), false);
  assert.equal(resultado.evento.last_error.includes('12345678901'), false);
  assert.equal(resultado.evento.last_error.includes('https://'), false);
});

test('hash canonico ignora PII extra e muda com campo canonico', () => {
  const base = normalizarParaHash(payloadSensivel());
  const ordemDiferente = normalizarParaHash({
    payment: {
      pixQrCode: 'pix diferente',
      externalReference: 'outra-ref',
      id: 'pay_123',
      confirmedDate: '2026-07-10',
      dueDate: '2026-07-10',
      billingType: 'PIX',
      status: 'CONFIRMED',
      paymentDate: '2026-07-10',
      customer: { email: 'outro@example.com' },
      subscription: 'sub_123',
    },
    event: 'PAYMENT_CONFIRMED',
    id: 'evt_123',
  });
  const alteradoCanonico = normalizarParaHash(payloadSensivel({ payment: { status: 'RECEIVED' } }));

  assert.equal(calcularPayloadHash(base), calcularPayloadHash(ordemDiferente));
  assert.notEqual(calcularPayloadHash(base), calcularPayloadHash(alteradoCanonico));
  assert.match(calcularPayloadHash(base), /^[a-f0-9]{64}$/);
});

test('lease impede worker antigo de finalizar evento reclaimado por outra tentativa', async () => {
  const supabase = criarSupabaseCaptura();
  const body = payloadSensivel({ id: 'evt_lease' });
  await inserirOuReivindicar(supabase, body, normalizarParaHash(body));

  const evento = supabase.capturas.inserts[0].payload;
  const resultado = await marcarProcessado(supabase, 'evt_lease', {
    faturaId: 'fat_1',
    empresaId: 'empresa_1',
    lease: {
      attempts: (evento.attempts || 1) + 1,
      processing_started_at: evento.processing_started_at,
    },
  });

  assert.equal(resultado.code, 'db_error');
});

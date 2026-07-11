const test = require('node:test');
const assert = require('node:assert/strict');

const {
  processarWebhook,
  validarBody,
  EVENTOS_VALIDOS,
} = require('../services/asaasWebhookService');

function criarBody(overrides = {}) {
  return {
    id: 'evt_1',
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_1',
      status: 'CONFIRMED',
      confirmedDate: '2026-07-10',
      externalReference: 'empresa-errada',
      customer: 'cus_sensivel',
      subscription: 'sub_sensivel',
      ...overrides.payment,
    },
    tenant: 'tenant-falso',
    ...overrides,
  };
}

function criarFatura(overrides = {}) {
  return {
    id: 'fat_1',
    empresa_id: 'empresa_local',
    asaas_id: 'pay_1',
    status: 'pendente',
    pago_em: null,
    due_date: '2000-01-01',
    invoice_url: 'https://sandbox.asaas.com/i/pay_1',
    bank_slip_url: null,
    ...overrides,
  };
}

function criarEmpresa(overrides = {}) {
  return {
    id: 'empresa_local',
    status: 'trial',
    suspension_reason: null,
    suspension_source: null,
    trial_ends_at: '2000-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function criarSupabaseMock(cenario = {}) {
  const eventos = new Map((cenario.eventos || []).map((evento) => [evento.event_id, { ...evento }]));
  const registro = {
    inserts: [],
    updates: [],
    selects: [],
  };

  function clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  function encontrarEvento(filtros) {
    if (filtros.event_id) return eventos.get(filtros.event_id) || null;
    if (filtros.id) return Array.from(eventos.values()).find((evento) => evento.id === filtros.id) || null;
    return null;
  }

  function builder(tabela) {
    const ctx = { tabela, op: 'select', payload: null, filtros: {} };
    const api = {
      select() {
        return api;
      },
      insert(payload) {
        ctx.op = 'insert';
        ctx.payload = payload;
        registro.inserts.push({ tabela, payload: clone(payload) });
        return api;
      },
      update(payload) {
        ctx.op = 'update';
        ctx.payload = payload;
        registro.updates.push({ tabela, payload: clone(payload), filtros: ctx.filtros });
        return api;
      },
      eq(campo, valor) {
        ctx.filtros[campo] = valor;
        return api;
      },
      single() {
        return resolver();
      },
      maybeSingle() {
        return resolver(true);
      },
      then(resolve) {
        resolver().then(resolve);
      },
    };

    async function resolver(maybe = false) {
      if (ctx.op === 'insert') {
        if (tabela === 'asaas_webhook_events') {
          if (cenario.insertWebhookError) return { data: null, error: cenario.insertWebhookError };
          if (eventos.has(ctx.payload.event_id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          const evento = {
            id: `webhook_${eventos.size + 1}`,
            received_at: new Date().toISOString(),
            ...clone(ctx.payload),
          };
          eventos.set(evento.event_id, evento);
          return { data: clone(evento), error: null };
        }
      }

      if (ctx.op === 'update') {
        if (tabela === 'asaas_webhook_events') {
          if (cenario.eventUpdateError) return { data: null, error: cenario.eventUpdateError };
          const evento = encontrarEvento(ctx.filtros);
          if (!evento) return { data: null, error: { code: 'PGRST116' } };
          for (const [campo, valor] of Object.entries(ctx.filtros)) {
            if (evento[campo] !== valor) return { data: null, error: { code: 'PGRST116' } };
          }
          Object.assign(evento, clone(ctx.payload));
          return { data: clone(evento), error: null };
        }
        if (tabela === 'faturas') {
          if (cenario.updateFaturaError) return { data: null, error: cenario.updateFaturaError };
          const statusAtualNoUpdate = cenario.faturaStatusNoUpdate || cenario.fatura?.status;
          if (ctx.filtros.status && statusAtualNoUpdate !== ctx.filtros.status) {
            return { data: null, error: null };
          }
          return { data: { ...clone(cenario.fatura), ...clone(ctx.payload) }, error: null };
        }
        if (tabela === 'empresas') {
          if (cenario.updateEmpresaError) return { data: null, error: cenario.updateEmpresaError };
          return { data: { ...clone(cenario.empresa), ...clone(ctx.payload) }, error: null };
        }
      }

      registro.selects.push({ tabela, filtros: clone(ctx.filtros) });
      if (tabela === 'asaas_webhook_events') {
        const evento = encontrarEvento(ctx.filtros);
        if (evento) return { data: clone(evento), error: null };
        return { data: null, error: maybe ? null : { code: 'PGRST116' } };
      }
      if (tabela === 'faturas') {
        if (cenario.fetchFaturaError) return { data: null, error: cenario.fetchFaturaError };
        const fatura = cenario.fatura || null;
        if (fatura && (!ctx.filtros.asaas_id || fatura.asaas_id === ctx.filtros.asaas_id)) {
          return { data: clone(fatura), error: null };
        }
        return { data: null, error: maybe ? null : { code: 'PGRST116' } };
      }
      if (tabela === 'empresas') {
        if (cenario.fetchEmpresaError) return { data: null, error: cenario.fetchEmpresaError };
        const empresa = cenario.empresa || null;
        if (empresa && (!ctx.filtros.id || empresa.id === ctx.filtros.id)) {
          return { data: clone(empresa), error: null };
        }
        return { data: null, error: { code: 'PGRST116' } };
      }
      return { data: null, error: null };
    }

    return api;
  }

  return { from: builder, __registro: registro, __eventos: eventos };
}

test('validarBody cobre payloads invalidos e tolera atributos extras', () => {
  const invalidos = [
    null,
    [],
    'texto',
    {},
    { id: '', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } },
    { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } },
    { id: 'evt_1' },
    { id: 'evt_1', event: '' },
    { id: 'evt_1', event: 'PAYMENT_CONFIRMED' },
    { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: 'pay_1' },
    { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: {} },
    { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: '' } },
  ];

  for (const body of invalidos) {
    assert.equal(validarBody(body).valido, false, JSON.stringify(body));
  }

  assert.equal(validarBody(criarBody({ campoNovo: { aninhado: true } })).valido, true);
  assert.equal(validarBody({ id: 'evt_unknown', event: 'PAYMENT_FUTURO' }).valido, true);
  assert.equal(validarBody({ id: 'evt_unknown', event: 'PAYMENT_FUTURO', payment: { id: 'pay_1' } }).valido, true);
});

test('eventos reconhecidos batem com a lista oficial usada no piloto', () => {
  assert.equal(EVENTOS_VALIDOS.has('PAYMENT_RECEIVED_IN_CASH'), false);
  assert.equal(EVENTOS_VALIDOS.has('PAYMENT_CANCELED'), false);
  for (const evento of [
    'PAYMENT_CONFIRMED',
    'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE',
    'PAYMENT_DELETED',
    'PAYMENT_RESTORED',
    'PAYMENT_REFUNDED',
    'PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_REFUND_IN_PROGRESS',
    'PAYMENT_REFUND_DENIED',
    'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    'PAYMENT_CHARGEBACK_REQUESTED',
    'PAYMENT_CHARGEBACK_DISPUTE',
    'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  ]) {
    assert.equal(EVENTOS_VALIDOS.has(evento), true, evento);
  }
});

test('pagamento confirmado resolve tenant pela fatura local e ativa trial', async () => {
  const supabase = criarSupabaseMock({
    fatura: criarFatura({ empresa_id: 'empresa_local' }),
    empresa: criarEmpresa({ id: 'empresa_local', status: 'trial' }),
  });

  const resultado = await processarWebhook({
    supabase,
    body: criarBody({
      empresa_id: 'empresa_falsa',
      payment: {
        id: 'pay_1',
        status: 'CONFIRMED',
        confirmedDate: '2026-07-10',
        externalReference: 'empresa_falsa',
        customer: 'cus_falso',
        subscription: 'sub_falso',
      },
    }),
  });

  assert.equal(resultado.httpStatus, 200);
  const buscaFatura = supabase.__registro.selects.find((s) => s.tabela === 'faturas' && s.filtros.asaas_id === 'pay_1');
  assert.ok(buscaFatura);
  const buscaEmpresa = supabase.__registro.selects.find((s) => s.tabela === 'empresas');
  assert.equal(buscaEmpresa.filtros.id, 'empresa_local');

  const updateFatura = supabase.__registro.updates.find((u) => u.tabela === 'faturas');
  assert.equal(updateFatura.payload.status, 'pago');
  assert.equal(updateFatura.payload.asaas_raw_status, 'CONFIRMED');

  const updateEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.equal(updateEmpresa.payload.status, 'ativo');
});

test('pagamento reativa apenas suspensao financeira automatica e limpa metadados', async () => {
  const supabase = criarSupabaseMock({
    fatura: criarFatura({ status: 'vencido' }),
    empresa: criarEmpresa({
      status: 'suspenso',
      suspension_reason: 'financial',
      suspension_source: 'automatic',
    }),
  });

  const resultado = await processarWebhook({
    supabase,
    body: criarBody({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', paymentDate: '2026-07-10' } }),
  });

  assert.equal(resultado.httpStatus, 200);
  const updateEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.deepEqual(updateEmpresa.payload, {
    status: 'ativo',
    suspension_reason: null,
    suspension_source: null,
    suspended_at: null,
    suspended_by: null,
  });
});

test('pagamento preserva suspensoes protegidas e motivo nulo', async () => {
  for (const suspension_reason of ['administrative', 'security', 'legacy_unknown', null]) {
    const supabase = criarSupabaseMock({
      fatura: criarFatura({ status: 'vencido' }),
      empresa: criarEmpresa({ status: 'suspenso', suspension_reason, suspension_source: 'manual' }),
    });

    const resultado = await processarWebhook({
      supabase,
      body: criarBody({ id: `evt_${suspension_reason || 'nulo'}`, event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED' } }),
    });

    assert.equal(resultado.httpStatus, 200);
    assert.equal(supabase.__registro.updates.some((u) => u.tabela === 'empresas'), false, String(suspension_reason));
  }
});

test('overdue suspende somente fatura vencida com caminho de regularizacao', async () => {
  const supabase = criarSupabaseMock({
    fatura: criarFatura({ status: 'pendente', due_date: '2000-01-01', invoice_url: 'https://sandbox.asaas.com/i/pay_1' }),
    empresa: criarEmpresa({ status: 'ativo', trial_ends_at: null }),
  });

  const resultado = await processarWebhook({
    supabase,
    body: criarBody({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', status: 'OVERDUE' } }),
  });

  assert.equal(resultado.httpStatus, 200);
  const updateEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.equal(updateEmpresa.payload.status, 'suspenso');
  assert.equal(updateEmpresa.payload.suspension_reason, 'financial');
  assert.equal(updateEmpresa.payload.suspension_source, 'automatic');
  assert.equal(updateEmpresa.payload.suspended_by, null);
  assert.ok(updateEmpresa.payload.suspended_at);
});

test('eventos de refund parcial, refund pendente e chargeback nao alteram fatura nem conta', async () => {
  for (const event of [
    'PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_REFUND_IN_PROGRESS',
    'PAYMENT_REFUND_DENIED',
    'PAYMENT_CHARGEBACK_REQUESTED',
    'PAYMENT_CHARGEBACK_DISPUTE',
    'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  ]) {
    const supabase = criarSupabaseMock({
      fatura: criarFatura({ status: 'pago', pago_em: '2026-07-10T00:00:00.000Z' }),
      empresa: criarEmpresa({ status: 'ativo' }),
    });

    const resultado = await processarWebhook({
      supabase,
      body: criarBody({ id: `evt_${event}`, event, payment: { id: 'pay_1', status: 'REFUND_IN_PROGRESS' } }),
    });

    assert.equal(resultado.httpStatus, 200, event);
    assert.equal(supabase.__registro.updates.some((u) => u.tabela === 'faturas' && u.payload.status), false, event);
    assert.equal(supabase.__registro.updates.some((u) => u.tabela === 'empresas'), false, event);
  }
});

test('cobranca desconhecida vira ignored e nao cria fatura nem empresa', async () => {
  const supabase = criarSupabaseMock({ fatura: null, empresa: null });
  const resultado = await processarWebhook({
    supabase,
    body: criarBody({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_desconhecido', status: 'CONFIRMED' } }),
  });

  assert.equal(resultado.httpStatus, 200);
  assert.equal(supabase.__registro.inserts.filter((i) => i.tabela === 'faturas').length, 0);
  assert.equal(supabase.__registro.inserts.filter((i) => i.tabela === 'empresas').length, 0);
  const eventoFinal = supabase.__eventos.get('evt_1');
  assert.equal(eventoFinal.status, 'ignored');
  assert.match(eventoFinal.last_error, /payment_not_managed/);
});

test('erro de banco na fatura marca failed e retry reprocessa uma unica vez', async () => {
  const body = criarBody({ id: 'evt_retry', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', status: 'CONFIRMED' } });
  const falha = criarSupabaseMock({
    fatura: criarFatura(),
    empresa: criarEmpresa(),
    updateFaturaError: { message: 'falha temporaria' },
  });

  const primeira = await processarWebhook({ supabase: falha, body });
  assert.equal(primeira.httpStatus, 500);
  assert.equal(falha.__eventos.get('evt_retry').status, 'failed');
  assert.equal(falha.__eventos.get('evt_retry').attempts, 1);

  const sucesso = criarSupabaseMock({
    eventos: [falha.__eventos.get('evt_retry')],
    fatura: criarFatura(),
    empresa: criarEmpresa(),
  });
  const segunda = await processarWebhook({ supabase: sucesso, body });
  assert.equal(segunda.httpStatus, 200);
  assert.equal(sucesso.__eventos.get('evt_retry').status, 'processed');
  assert.equal(sucesso.__eventos.get('evt_retry').attempts, 2);

  const terceira = await processarWebhook({ supabase: sucesso, body });
  assert.equal(terceira.httpStatus, 200);
  assert.equal(terceira.resultado.idempotente, true);
  assert.equal(sucesso.__registro.updates.filter((u) => u.tabela === 'faturas' && u.payload.status === 'pago').length, 1);
  assert.equal(sucesso.__registro.updates.filter((u) => u.tabela === 'empresas' && u.payload.status === 'ativo').length, 1);
});

test('duas requisicoes simultaneas processam o fluxo completo uma unica vez', async () => {
  const supabase = criarSupabaseMock({
    fatura: criarFatura(),
    empresa: criarEmpresa(),
  });
  const body = criarBody({ id: 'evt_concorrente', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', status: 'CONFIRMED' } });

  const [a, b] = await Promise.all([
    processarWebhook({ supabase, body }),
    processarWebhook({ supabase, body }),
  ]);

  assert.equal(a.httpStatus, 200);
  assert.equal(b.httpStatus, 200);
  assert.equal(supabase.__registro.updates.filter((u) => u.tabela === 'faturas' && u.payload.status === 'pago').length, 1);
  assert.equal(supabase.__registro.updates.filter((u) => u.tabela === 'empresas' && u.payload.status === 'ativo').length, 1);
  assert.equal(supabase.__registro.updates.filter((u) => u.tabela === 'asaas_webhook_events' && u.payload.status === 'processed').length, 1);
});

test('update da fatura usa CAS por status e falha retryable se leitura ficou obsoleta', async () => {
  const supabase = criarSupabaseMock({
    fatura: criarFatura({ status: 'pendente' }),
    faturaStatusNoUpdate: 'pago',
    empresa: criarEmpresa({ status: 'ativo' }),
  });
  const body = criarBody({ id: 'evt_stale', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', status: 'OVERDUE' } });

  const resultado = await processarWebhook({ supabase, body });

  assert.equal(resultado.httpStatus, 500);
  assert.equal(supabase.__eventos.get('evt_stale').status, 'failed');
});

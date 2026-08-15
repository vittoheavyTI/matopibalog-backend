const { test } = require('node:test');
const assert = require('node:assert/strict');

const { FakeAsaasProvider } = require('../services/billing/fakeAsaasProvider');
const { processarOutbox } = require('../services/billing/billingOutboxWorker');
const { montarDedupeKey } = require('../services/billing/billingTriggers');
const { aplicarEvento } = require('../services/billing/billingWebhookApplyDomainService');

// ── Outbox in-memory FIEL ao contrato do billingOutboxRepository ──────────────
// Reproduz idempotência de enfileiramento (dedupe_key) e claim atômico (cada
// evento reivindicado UMA vez). Prova a LÓGICA do worker/idempotência multi-passo;
// a garantia no nível do banco (CAS real) é validada pelo pgtest no CI.
function criarOutboxMemoria() {
  const eventos = new Map(); // id -> evento
  const porDedupe = new Map(); // dedupe_key -> id
  let seq = 0;
  return {
    _eventos: eventos,
    async enfileirar(_supabase, { empresaId, eventType, dedupeKey, payload }) {
      if (porDedupe.has(dedupeKey)) return { enfileirado: false, code: 'duplicate' };
      const id = `ob_${++seq}`;
      const ev = { id, empresa_id: empresaId, event_type: eventType, dedupe_key: dedupeKey, status: 'pending', attempts: 0, max_attempts: 8, payload: payload || {} };
      eventos.set(id, ev); porDedupe.set(dedupeKey, id);
      return { enfileirado: true, code: 'inserted', evento: ev };
    },
    async reivindicarProximo() {
      // Pega o primeiro pending/failed e marca processing (claim atômico single-thread).
      for (const ev of eventos.values()) {
        if (ev.status === 'pending' || ev.status === 'failed') {
          ev.status = 'processing'; ev.attempts += 1;
          return { evento: { ...ev }, code: 'claimed' };
        }
      }
      return { evento: null, code: 'empty' };
    },
    async marcarProcessado(_supabase, id) {
      const ev = eventos.get(id); if (ev) ev.status = 'processed';
      return { code: 'processed', evento: ev };
    },
    async marcarFalhou(_supabase, evento, razao) {
      const ev = eventos.get(evento.id);
      if (ev) { ev.status = ev.attempts >= ev.max_attempts ? 'dead' : 'failed'; ev.last_error = razao; }
      return { code: ev?.status === 'dead' ? 'dead' : 'failed', evento: ev };
    },
    sanitizarErro: (m) => (m ? String(m).slice(0, 100) : null),
  };
}

// Deps in-memory (empresa/snapshot/situação/add-ons/persist).
function criarDepsMemoria({ situacao, snapshot, empresa = {} } = {}) {
  const estado = { asaas_customer_id: null, asaas_subscription_id: null, implantacao_cobrada: false, next_due_date: null, ...empresa };
  return {
    estado,
    deps: {
      carregarSituacao: async () => situacao || { situacao: 'conversao_aguardando_pagamento', trial_ends_at: '2026-08-20T00:00:00.000Z' },
      carregarEmpresaBilling: async () => ({ ...estado }),
      carregarSnapshot: async () => snapshot || { valor_mensal: 299.9, valor_implantacao: 0, trial_dias: 14 },
      carregarAddOns: async () => [],
      persist: async (_id, patch) => { if (!patch.__addon) Object.assign(estado, patch); },
    },
  };
}

test('E2E automático: EVENTO de negócio → outbox → worker → provider → billing local (§19/§33)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const { deps, estado } = criarDepsMemoria();
  const provider = new FakeAsaasProvider();

  // Começa pelo EVENTO DE NEGÓCIO (não chama billing direto).
  const empresaId = 'emp-e2e';
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'contrato_assinado', dedupeKey: montarDedupeKey({ empresaId, tipo: 'contrato_assinado' }), payload: {} });

  // Worker processa a fila.
  const resumo = await processarOutbox({ supabase: {}, provider, deps, outboxRepo, limite: 5 });
  assert.equal(resumo.processados, 1);
  assert.equal(estado.asaas_customer_id, 'cus_000001');
  assert.equal(estado.asaas_subscription_id, 'sub_000001');
  assert.equal(estado.next_due_date, '2026-08-20'); // 1ª mensalidade = trial_end

  // Simula pagamento via webhook → estado local pago.
  const charge = await provider.createCharge({ customerId: estado.asaas_customer_id, value: 299.9, dueDate: '2026-08-20' });
  const evt = provider.emitWebhook(charge.id, 'PAYMENT_RECEIVED');
  const t = aplicarEvento({ faturaAtual: { status: 'pendente' }, evento: evt });
  assert.equal(t.novoStatus, 'pago');
});

test('E2E automático idempotente: enfileirar 10x o mesmo evento → 1 processamento, 1 customer', async () => {
  const outboxRepo = criarOutboxMemoria();
  const { deps, estado } = criarDepsMemoria();
  const provider = new FakeAsaasProvider();
  const empresaId = 'emp-idem';
  const dk = montarDedupeKey({ empresaId, tipo: 'contratacao_apta' });
  for (let i = 0; i < 10; i += 1) {
    await outboxRepo.enfileirar(null, { empresaId, eventType: 'contratacao_apta', dedupeKey: dk });
  }
  const resumo = await processarOutbox({ supabase: {}, provider, deps, outboxRepo, limite: 20 });
  assert.equal(resumo.processados, 1, 'dedupe_key → 1 evento processado');
  assert.equal(provider.calls.createCustomer, 1);
  assert.equal(estado.asaas_customer_id, 'cus_000001');
});

test('E2E automático: eventos concorrentes reivindicados uma vez (claim atômico)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const provider = new FakeAsaasProvider();
  // 3 empresas distintas, 1 evento cada.
  for (const e of ['a', 'b', 'c']) {
    await outboxRepo.enfileirar(null, { empresaId: `emp-${e}`, eventType: 'contrato_assinado', dedupeKey: `emp-${e}:contrato_assinado` });
  }
  // 4 workers concorrentes: nenhum evento processado em duplicado.
  const depsCompart = {
    carregarSituacao: async () => ({ situacao: 'conversao_aguardando_pagamento', trial_ends_at: '2026-08-20T00:00:00.000Z' }),
    carregarEmpresaBilling: async () => ({ asaas_customer_id: null, asaas_subscription_id: null }),
    carregarSnapshot: async () => ({ valor_mensal: 99.9, valor_implantacao: 0 }),
    carregarAddOns: async () => [],
    persist: async () => {},
  };
  const resultados = await Promise.all(Array.from({ length: 4 }, () => processarOutbox({ supabase: {}, provider, deps: depsCompart, outboxRepo, limite: 10 })));
  const totalProcessados = resultados.reduce((s, r) => s + r.processados, 0);
  assert.equal(totalProcessados, 3, 'cada evento processado exatamente 1 vez');
  assert.equal(provider.calls.createCustomer, 3);
});

test('E2E crash recovery: provider criou customer mas processo caiu antes de marcar → retomada não duplica (§20)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const provider = new FakeAsaasProvider();
  const empresaId = 'emp-crash';
  // Estado que já tem o customer criado no provider mas o outbox ficou 'failed'
  // (simulando crash pós-criação, pré-marcação). O mapping local JÁ foi gravado
  // (persist ocorre logo após create no executor), então a retomada é idempotente.
  const estado = { asaas_customer_id: 'cus_000001', asaas_subscription_id: null, implantacao_cobrada: false };
  provider.customers.set('cus_000001', { id: 'cus_000001' });
  provider._seq.cus = 1; // próximo customer seria cus_000002 se recriasse (não deve)
  const deps = {
    carregarSituacao: async () => ({ situacao: 'conversao_aguardando_pagamento', trial_ends_at: '2026-08-20T00:00:00.000Z' }),
    carregarEmpresaBilling: async () => ({ ...estado }),
    carregarSnapshot: async () => ({ valor_mensal: 299.9, valor_implantacao: 0 }),
    carregarAddOns: async () => [],
    persist: async (_id, patch) => { if (!patch.__addon) Object.assign(estado, patch); },
  };
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'reconciliacao', dedupeKey: `${empresaId}:reconciliacao` });
  await processarOutbox({ supabase: {}, provider, deps, outboxRepo, limite: 5 });
  // Não recriou o customer (idempotência por mapping já gravado).
  assert.equal(provider.calls.createCustomer, 0);
  assert.equal(estado.asaas_customer_id, 'cus_000001');
  // Criou a assinatura que faltava.
  assert.equal(estado.asaas_subscription_id, 'sub_000001');
});

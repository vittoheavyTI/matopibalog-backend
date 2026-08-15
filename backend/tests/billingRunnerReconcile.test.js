const { test } = require('node:test');
const assert = require('node:assert/strict');

const { FakeAsaasProvider } = require('../services/billing/fakeAsaasProvider');
const { iniciarRunner, executarUmaRodada } = require('../services/billing/billingOutboxRunner');
const { resolveRunnerConfig, parseBoolEstrito, parseIntEmFaixa, BillingRunnerConfigurationError } = require('../services/billing/billingRunnerConfig');
const { selecionarParaReconciliar } = require('../services/billing/billingReconcileJobDomainService');
const { montarDedupeKey } = require('../services/billing/billingTriggers');
const { planejarBilling } = require('../services/billing/billingOrchestratorDomainService');

// Outbox in-memory FIEL (claim atômico single-thread).
function criarOutboxMemoria() {
  const eventos = new Map();
  const porDedupe = new Map();
  let seq = 0;
  return {
    _eventos: eventos,
    async enfileirar(_s, { empresaId, eventType, dedupeKey, payload }) {
      if (porDedupe.has(dedupeKey)) return { enfileirado: false, code: 'duplicate' };
      const id = `ob_${++seq}`;
      eventos.set(id, { id, empresa_id: empresaId, event_type: eventType, dedupe_key: dedupeKey, status: 'pending', attempts: 0, max_attempts: 8, payload: payload || {} });
      porDedupe.set(dedupeKey, id);
      return { enfileirado: true, code: 'inserted', evento: eventos.get(id) };
    },
    async reivindicarProximo() {
      for (const ev of eventos.values()) {
        if (ev.status === 'pending' || ev.status === 'failed') { ev.status = 'processing'; ev.attempts += 1; return { evento: { ...ev }, code: 'claimed' }; }
      }
      return { evento: null, code: 'empty' };
    },
    async marcarProcessado(_s, id) { const ev = eventos.get(id); if (ev) ev.status = 'processed'; return { code: 'processed' }; },
    async marcarFalhou(_s, evento, razao) { const ev = eventos.get(evento.id); if (ev) { ev.status = ev.attempts >= ev.max_attempts ? 'dead' : 'failed'; ev.last_error = razao; } return { code: ev?.status === 'dead' ? 'dead' : 'failed' }; },
    sanitizarErro: (m) => (m ? String(m).slice(0, 80) : null),
  };
}
function depsDe(estado, over = {}) {
  return {
    carregarSituacao: async () => over.situacao || { situacao: 'trial_ativo', trial_ends_at: '2026-08-20T00:00:00.000Z' },
    carregarEmpresaBilling: async () => ({ ...estado }),
    carregarSnapshot: async () => over.snapshot || { valor_mensal: 299.9, valor_implantacao: 0 },
    carregarAddOns: async () => over.addOns || [],
    persist: async (_id, patch) => {
      if (patch.__addon || patch.__addon_removido) return;
      Object.assign(estado, patch);
    },
  };
}

// ── GAP3: config ESTRITA fail-closed (§3) ────────────────────────────────────
test('config boolean estrito: só true/false; ausente=default; outro=ERRO', () => {
  assert.equal(parseBoolEstrito('true', false), true);
  assert.equal(parseBoolEstrito('FALSE', true), false);
  assert.equal(parseBoolEstrito('  True ', false), true);
  assert.equal(parseBoolEstrito(undefined, true), true); // ausente → default
  for (const v of ['1', '0', 'yes', 'no', 'sim', 'nao', 'abc']) {
    assert.throws(() => parseBoolEstrito(v, false), BillingRunnerConfigurationError, `deveria falhar: ${v}`);
  }
});

test('config inteiro estrito: ausente=default; fora da faixa/inválido=ERRO (sem clamp)', () => {
  assert.equal(parseIntEmFaixa(undefined, 30, 5, 3600), 30);
  assert.equal(parseIntEmFaixa('60', 30, 5, 3600), 60);
  assert.throws(() => parseIntEmFaixa('4', 30, 5, 3600), BillingRunnerConfigurationError); // abaixo do mínimo
  assert.throws(() => parseIntEmFaixa('999999', 30, 5, 3600), BillingRunnerConfigurationError); // acima do máximo
  assert.throws(() => parseIntEmFaixa('abc', 30, 5, 3600), BillingRunnerConfigurationError);
  assert.throws(() => parseIntEmFaixa('1.5', 30, 5, 3600), BillingRunnerConfigurationError);
});

test('resolveRunnerConfig: default OFF; env válida ok; env inválida lança', () => {
  assert.equal(resolveRunnerConfig({}).enabled, false);
  assert.equal(resolveRunnerConfig({ BILLING_OUTBOX_ENABLED: 'true', BILLING_OUTBOX_INTERVAL_SECONDS: '60', BILLING_OUTBOX_BATCH_SIZE: '5' }).enabled, true);
  assert.throws(() => resolveRunnerConfig({ BILLING_OUTBOX_ENABLED: 'sim' }), BillingRunnerConfigurationError);
  assert.throws(() => resolveRunnerConfig({ BILLING_OUTBOX_INTERVAL_SECONDS: '2' }), BillingRunnerConfigurationError);
  assert.throws(() => resolveRunnerConfig({ BILLING_OUTBOX_BATCH_SIZE: '100' }), BillingRunnerConfigurationError);
});

// ── GAP2: E2E processa pelo TICK REAL do runner (sem chamada manual) (§2) ─────
test('E2E pelo TICK do runner: evento → outbox → tick → provider (sem executarUmaRodada manual)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const estado = { asaas_customer_id: null, asaas_subscription_id: null, implantacao_cobrada: false };
  const provider = new FakeAsaasProvider();
  const empresaId = 'emp-tick';
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'contrato_assinado', dedupeKey: montarDedupeKey({ empresaId, tipo: 'contrato_assinado' }) });

  let tickFn;
  const ctrl = iniciarRunner({
    supabase: {}, provider, deps: depsDe(estado, { situacao: { situacao: 'ativa' } }), outboxRepo,
    config: { enabled: true, intervalSeconds: 5, batchSize: 10 },
    setIntervalFn: (fn) => { tickFn = fn; return { unref() {} }; },
    clearIntervalFn: () => {},
  });
  assert.equal(ctrl.ativo, true);
  await tickFn(); // é o TIMER que processa — nada de executarUmaRodada manual
  assert.equal(estado.asaas_customer_id, 'cus_000001');
  assert.equal(estado.asaas_subscription_id, 'sub_000001');
  ctrl.parar();
});

test('multi-runner (2 ticks concorrentes) → cada evento 1 vez (claim CAS)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const provider = new FakeAsaasProvider();
  for (const e of ['a', 'b', 'c', 'd']) {
    await outboxRepo.enfileirar(null, { empresaId: `emp-${e}`, eventType: 'contrato_assinado', dedupeKey: `emp-${e}:contrato_assinado` });
  }
  // Deps por-empresa: cada empresa começa sem customer; persist é no-op (o foco é
  // provar que o claim CAS entrega cada evento a UM único runner).
  const depsPorEmpresa = {
    carregarSituacao: async () => ({ situacao: 'ativa' }),
    carregarEmpresaBilling: async () => ({ asaas_customer_id: null, asaas_subscription_id: null }),
    carregarSnapshot: async () => ({ valor_mensal: 99.9, valor_implantacao: 0 }),
    carregarAddOns: async () => [],
    persist: async () => {},
  };
  const ticks = [];
  for (let i = 0; i < 2; i += 1) {
    let tickFn;
    iniciarRunner({ supabase: {}, provider, deps: depsPorEmpresa, outboxRepo, config: { enabled: true, intervalSeconds: 5, batchSize: 10 }, setIntervalFn: (fn) => { tickFn = fn; return { unref() {} }; }, clearIntervalFn: () => {} });
    ticks.push(tickFn);
  }
  await Promise.all(ticks.map((t) => t()));
  assert.equal(provider.calls.createCustomer, 4, 'cada evento processado 1 vez → 4 customers');
});

test('runner: erro de uma rodada NÃO propaga', async () => {
  const outboxRepo = { reivindicarProximo: async () => { throw new Error('db down'); } };
  const r = await executarUmaRodada({ supabase: {}, provider: new FakeAsaasProvider(), deps: depsDe({}), outboxRepo });
  assert.ok(r.erro_rodada);
});

// ── GAP1: reconcile decisor cobre convergência (§1.2–§1.5) ───────────────────
test('decisor: trial vencido / customer ausente / subscription ausente / cancelamento pendente', () => {
  const agora = new Date('2026-08-21T00:00:00.000Z');
  const sel = selecionarParaReconciliar({
    agora,
    empresas: [
      { id: 'e-trial', status: 'trial', commercial_flow_version: 'v2', trial_ends_at: '2026-08-20T00:00:00.000Z', asaas_customer_id: 'cus', asaas_subscription_id: 'sub' },
      { id: 'e-cust', status: 'ativo', commercial_flow_version: 'v2', trial_ends_at: null, asaas_customer_id: null, asaas_subscription_id: null },
      { id: 'e-sub', status: 'ativo', commercial_flow_version: 'v2', trial_ends_at: null, asaas_customer_id: 'cus', asaas_subscription_id: null },
      { id: 'e-cancel', status: 'cancelada', commercial_flow_version: 'v2', trial_ends_at: null, asaas_customer_id: 'cus', asaas_subscription_id: 'sub', assinatura_cancelada: false },
      { id: 'e-revalidar', status: 'ativo', commercial_flow_version: 'v2', trial_ends_at: null, asaas_customer_id: 'cus', asaas_subscription_id: 'sub' },
      { id: 'e-legado', status: 'ativo', commercial_flow_version: null, trial_ends_at: null, asaas_customer_id: null }, // legado → não
    ],
  });
  const porId = Object.fromEntries(sel.map((s) => [s.empresaId, s.motivo]));
  assert.match(porId['e-trial'], /trial_finalizado/);
  assert.match(porId['e-cust'], /customer_ausente/);
  assert.match(porId['e-sub'], /subscription_ausente/);
  assert.match(porId['e-cancel'], /cancelamento_pendente/);
  assert.match(porId['e-revalidar'], /revalidar/);
  assert.equal(porId['e-legado'], undefined);
});

// ── GAP1: CONVERGÊNCIA no orquestrador (planejar) ────────────────────────────
test('convergência plano alterado: valor esperado != contratado → atualizar_assinatura_valor (§1.3)', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: 299.9 },
    snapshot: { valor_mensal: 499.9, valor_implantacao: 0 },
  });
  const upd = plano.acoes.find((a) => a.tipo === 'atualizar_assinatura_valor');
  assert.ok(upd);
  assert.equal(upd.valor_mensal, 499.9);
});

test('convergência plano: valor igual → nenhuma ação (§1.6 no-op idempotente)', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: 299.9 },
    snapshot: { valor_mensal: 299.9, valor_implantacao: 0 },
  });
  assert.equal(plano.acoes.length, 0);
});

test('add-on sem aceite financeiro explicito nao cobra nem cria payment avulso', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: 299.9 },
    snapshot: { valor_mensal: 299.9 },
    addOns: [
      { id: 'add-novo', status: 'ativa', preco_mensal_centavos: 5000, billing_component_id: null },
      { id: 'add-removido', status: 'inativa', preco_mensal_centavos: 5000, billing_component_id: 'pay_addon_1' },
    ],
  });
  assert.ok(plano.acoes.find((a) => a.tipo === 'addon_sem_aceite_billing' && a.addon_id === 'add-novo'));
  assert.equal(plano.acoes.find((a) => a.tipo === 'garantir_addon' || a.tipo === 'remover_addon'), undefined);
});

test('add-on mensal aceito compoe proximo valor da subscription', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: 299.9 },
    snapshot: { valor_mensal: 299.9 },
    addOns: [
      { id: 'add-aceito', status: 'ativa', preco_mensal_centavos: 5000, aditivo_id: 'aditivo-1', aditivo_billing_status: 'plenamente_assinado' },
    ],
    agora: new Date('2026-08-10T00:00:00.000Z'),
  });
  const upd = plano.acoes.find((a) => a.tipo === 'atualizar_assinatura_valor');
  assert.equal(upd.valor_mensal, 349.9);
});

test('convergência cancelamento: cancelada + assinatura ativa → cancelar_assinatura; já cancelada → nada (§1.5)', () => {
  const p1 = planejarBilling({ situacao: { situacao: 'cancelada' }, empresaBilling: { asaas_subscription_id: 'sub', assinatura_cancelada: false }, snapshot: {} });
  assert.ok(p1.acoes.find((a) => a.tipo === 'cancelar_assinatura'));
  const p2 = planejarBilling({ situacao: { situacao: 'cancelada' }, empresaBilling: { asaas_subscription_id: 'sub', assinatura_cancelada: true }, snapshot: {} });
  assert.equal(p2.acoes.length, 0);
});

test('suspensao financeira temporaria nao deleta subscription', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'suspensa_financeiramente' },
    empresaBilling: { asaas_subscription_id: 'sub', assinatura_cancelada: false },
    snapshot: { valor_mensal: 299.9 },
  });
  assert.equal(plano.requer_billing, false);
  assert.equal(plano.acoes.find((a) => a.tipo === 'cancelar_assinatura'), undefined);
});

// ── GAP1: convergência ponta a ponta via worker (§1.3/§1.4/§1.6) ─────────────
test('E2E convergência plano alterado: gatilho perdido → reconcile enfileira → runner atualiza valor', async () => {
  const outboxRepo = criarOutboxMemoria();
  // Assinatura já existe com valor antigo; plano mudou (snapshot novo).
  const estado = { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: 299.9, implantacao_cobrada: true };
  const provider = new FakeAsaasProvider();
  provider.subscriptions.set('sub', { id: 'sub', value: 299.9, status: 'ACTIVE' });
  const empresaId = 'emp-plano';
  // reconcile periódico selecionaria 'revalidar' → enfileira reconciliacao
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'reconciliacao', dedupeKey: `${empresaId}:reconciliacao:2026-08-10` });
  const r1 = await executarUmaRodada({ supabase: {}, provider, outboxRepo, deps: depsDe(estado, { situacao: { situacao: 'ativa' }, snapshot: { valor_mensal: 499.9 } }) });
  assert.equal(r1.processados, 1);
  assert.equal(provider.calls.updateSubscription, 1);
  assert.equal(estado.billing_valor_mensal, 499.9);

  // 2ª rodada (estado convergente) → nenhuma atualização nova (§1.6).
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'reconciliacao', dedupeKey: `${empresaId}:reconciliacao:2026-08-11` });
  await executarUmaRodada({ supabase: {}, provider, outboxRepo, deps: depsDe(estado, { situacao: { situacao: 'ativa' }, snapshot: { valor_mensal: 499.9 } }) });
  assert.equal(provider.calls.updateSubscription, 1, 'não atualiza de novo quando já convergente');
});

test('E2E convergência cancelamento: reconcile → runner cancela assinatura; 2ª vez idempotente (§1.5/§1.6)', async () => {
  const outboxRepo = criarOutboxMemoria();
  const estado = { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', assinatura_cancelada: false };
  const provider = new FakeAsaasProvider();
  provider.subscriptions.set('sub', { id: 'sub', value: 100, status: 'ACTIVE' });
  const empresaId = 'emp-cancel';
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'cancelamento', dedupeKey: `${empresaId}:cancelamento` });
  await executarUmaRodada({ supabase: {}, provider, outboxRepo, deps: depsDe(estado, { situacao: { situacao: 'cancelada' } }) });
  assert.equal(provider.calls.cancelSubscription, 1);
  assert.equal(estado.assinatura_cancelada, true);
  // De novo → idempotente (não cancela outra vez).
  await outboxRepo.enfileirar(null, { empresaId, eventType: 'reconciliacao', dedupeKey: `${empresaId}:reconciliacao:x` });
  await executarUmaRodada({ supabase: {}, provider, outboxRepo, deps: depsDe(estado, { situacao: { situacao: 'cancelada' } }) });
  assert.equal(provider.calls.cancelSubscription, 1);
});

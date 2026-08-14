const { test } = require('node:test');
const assert = require('node:assert/strict');

const { FakeAsaasProvider } = require('../services/billing/fakeAsaasProvider');
const {
  ensureBillingStateComDeps,
  executarPlano,
  comRetry,
} = require('../services/billing/billingOrchestratorService');
const { planejarBilling } = require('../services/billing/billingOrchestratorDomainService');
const { aplicarEvento } = require('../services/billing/billingWebhookApplyDomainService');

// Mundo em memória: empresa billing + situação + snapshot + add-ons + persist.
function criarMundo(over = {}) {
  const empresa = {
    asaas_customer_id: null,
    asaas_subscription_id: null,
    implantacao_cobrada: false,
    next_due_date: null,
    ...over.empresa,
  };
  const situacao = over.situacao || { situacao: 'trial_ativo', trial_ends_at: '2026-08-20T00:00:00.000Z' };
  const snapshot = over.snapshot || { valor_mensal: 299.9, valor_implantacao: 0, trial_dias: 14 };
  const addOns = over.addOns || [];
  const componentes = new Map(); // addon_id -> billing_component_id
  const deps = {
    carregarSituacao: async () => situacao,
    carregarEmpresaBilling: async () => ({ ...empresa }),
    carregarSnapshot: async () => snapshot,
    carregarAddOns: async () => addOns,
    persist: async (_empresaId, patch) => {
      if (patch.__addon) { componentes.set(patch.__addon.addon_id, patch.__addon.billing_component_id); return; }
      Object.assign(empresa, patch);
    },
  };
  return { empresa, situacao, snapshot, addOns, componentes, deps };
}

test('E2E: trial ativo → cria customer + assinatura com 1º vencimento = trial_end (não antecipa)', async () => {
  const mundo = criarMundo();
  const provider = new FakeAsaasProvider();
  const r = await ensureBillingStateComDeps({ empresaId: 'e1', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(r.requer_billing, true);
  assert.equal(mundo.empresa.asaas_customer_id, 'cus_000001');
  assert.equal(mundo.empresa.asaas_subscription_id, 'sub_000001');
  // 1º vencimento = trial_end (2026-08-20), NÃO antes.
  assert.equal(mundo.empresa.next_due_date, '2026-08-20');
  assert.equal(provider.calls.createSubscription, 1);
});

test('E2E idempotência: ensureBilling 10x concorrentes → 1 customer e 1 assinatura (§48)', async () => {
  const mundo = criarMundo();
  const provider = new FakeAsaasProvider();
  await Promise.all(Array.from({ length: 10 }, () => ensureBillingStateComDeps({
    empresaId: 'e-conc', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' },
  })));
  assert.equal(provider.calls.createCustomer, 1, 'só 1 customer');
  assert.equal(provider.calls.createSubscription, 1, 'só 1 assinatura');
  assert.equal(provider.customers.size, 1);
  assert.equal(provider.subscriptions.size, 1);
});

test('E2E trial + pagamento: pagar durante trial NÃO encerra trial (§13/§47)', async () => {
  // A situação comercial é a autoridade do trial; o billing não a altera. Aqui
  // provamos que garantir billing + registrar pagamento NÃO muda a situação de trial.
  const mundo = criarMundo();
  const provider = new FakeAsaasProvider();
  await ensureBillingStateComDeps({ empresaId: 'e2', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  // Simula uma cobrança paga.
  const charge = await provider.createCharge({ customerId: mundo.empresa.asaas_customer_id, value: 299.9, dueDate: '2026-08-20' });
  const evtPago = provider.emitWebhook(charge.id, 'PAYMENT_RECEIVED');
  const t = aplicarEvento({ faturaAtual: { status: 'pendente' }, evento: evtPago });
  assert.equal(t.novoStatus, 'pago');
  // A situação segue trial_ativo (o billing não mexe nela).
  assert.equal(mundo.situacao.situacao, 'trial_ativo');
});

test('E2E trial ativo + add-on aceito prepara composicao sem antecipar vencimento', async () => {
  const mundo = criarMundo({
    addOns: [{ id: 'ad-trial', funcionalidade_id: 'f1', status: 'ativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado' }],
  });
  const provider = new FakeAsaasProvider();
  await ensureBillingStateComDeps({ empresaId: 'e-trial-addon', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  const sub = provider.subscriptions.get(mundo.empresa.asaas_subscription_id);
  assert.equal(sub.value, 349.9);
  assert.equal(sub.nextDueDate, '2026-08-20');
  assert.equal(mundo.empresa.next_due_date, '2026-08-20');
});

test('E2E implantação: política "imediato" cobra; "nao_cobrar" não cobra', async () => {
  const comImpl = criarMundo({ snapshot: { valor_mensal: 299.9, valor_implantacao: 500, trial_dias: 14 }, situacao: { situacao: 'ativa' } });
  const p1 = new FakeAsaasProvider();
  await ensureBillingStateComDeps({ empresaId: 'e-impl', deps: comImpl.deps, provider: p1, policyOverrides: { provider_mode: 'fake', implantacao_timing: 'imediato' } });
  assert.equal(p1.calls.createCharge, 1, 'cobrou implantação');
  assert.equal(comImpl.empresa.implantacao_cobrada, true);

  const semImpl = criarMundo({ snapshot: { valor_mensal: 299.9, valor_implantacao: 500, trial_dias: 14 }, situacao: { situacao: 'ativa' } });
  const p2 = new FakeAsaasProvider();
  await ensureBillingStateComDeps({ empresaId: 'e-impl2', deps: semImpl.deps, provider: p2, policyOverrides: { provider_mode: 'fake', implantacao_timing: 'nao_cobrar' } });
  assert.equal(p2.calls.createCharge, 0, 'não cobrou implantação');
});

test('E2E implantação idempotente: rodar 2x com "imediato" cobra só 1x', async () => {
  const mundo = criarMundo({ snapshot: { valor_mensal: 299.9, valor_implantacao: 500 }, situacao: { situacao: 'ativa' } });
  const provider = new FakeAsaasProvider();
  const pol = { provider_mode: 'fake', implantacao_timing: 'imediato' };
  await ensureBillingStateComDeps({ empresaId: 'e-i', deps: mundo.deps, provider, policyOverrides: pol });
  await ensureBillingStateComDeps({ empresaId: 'e-i', deps: mundo.deps, provider, policyOverrides: pol });
  assert.equal(provider.calls.createCharge, 1, 'implantação cobrada uma única vez');
});

test('E2E webhook duplicado: mesmo evento 20x → 1 efeito (§49)', () => {
  let fatura = { status: 'pendente' };
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_x', { id: 'cus_x' });
  // cria charge manualmente
  const evt = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED' } };
  let mudancas = 0;
  for (let i = 0; i < 20; i += 1) {
    const t = aplicarEvento({ faturaAtual: fatura, evento: evt });
    if (t.mudou) { mudancas += 1; fatura = { status: t.novoStatus }; }
  }
  assert.equal(mudancas, 1, 'apenas a 1ª aplicação muda o estado');
  assert.equal(fatura.status, 'pago');
});

test('E2E webhook fora de ordem: RECEBIDO depois PENDING (atrasado) não regride (§50)', () => {
  let fatura = { status: 'pendente' };
  // recebe pagamento
  let t = aplicarEvento({ faturaAtual: fatura, evento: { event: 'PAYMENT_RECEIVED', payment: { status: 'RECEIVED' } } });
  fatura = { status: t.novoStatus };
  assert.equal(fatura.status, 'pago');
  // chega tardiamente um PENDING antigo
  t = aplicarEvento({ faturaAtual: fatura, evento: { event: 'PAYMENT_CREATED', payment: { status: 'PENDING' } } });
  assert.equal(t.mudou, false);
  assert.equal(t.novoStatus, 'pago', 'não regride para pendente');
  // um OVERDUE antigo também não regride
  t = aplicarEvento({ faturaAtual: fatura, evento: { event: 'PAYMENT_OVERDUE', payment: { status: 'OVERDUE' } } });
  assert.equal(t.novoStatus, 'pago');
  // estorno (correção terminal) PODE aplicar mesmo sobre "pago"
  t = aplicarEvento({ faturaAtual: fatura, evento: { event: 'PAYMENT_REFUNDED', payment: { status: 'REFUNDED' } } });
  assert.equal(t.novoStatus, 'estornado');
});

test('E2E recuperação: provider criou customer mas local não gravou → reconciliação repara sem duplicar (§51)', async () => {
  const { reconciliar } = require('../services/billing/billingReconcileDomainService');
  const local = { asaas_customer_id: null, asaas_subscription_id: null, faturas: [] };
  const remoto = { customer: { id: 'cus_orfa' }, subscription: null, charges: [] };
  const r = reconciliar({ local, remoto });
  assert.ok(r.divergencias.includes('customer_mapping_ausente'));
  const gravar = r.acoes.find((a) => a.tipo === 'gravar_customer_mapping');
  assert.equal(gravar.customer_id, 'cus_orfa');
  // Após gravar, reconciliar de novo → sem divergência (não duplica).
  const r2 = reconciliar({ local: { asaas_customer_id: 'cus_orfa', faturas: [] }, remoto });
  assert.equal(r2.ok, true);
});

test('E2E retry: 2 falhas transitórias (500) antes de suceder → createCustomer completa', async () => {
  const provider = new FakeAsaasProvider({ faults: { failTimes: 2, status: 500, onlyFor: new Set(['createCustomer']) } });
  const mundo = criarMundo();
  const r = await executarPlano({
    acoes: [{ tipo: 'garantir_customer' }],
    empresa: { id: 'e-retry' },
    snapshot: mundo.snapshot,
    provider,
    persist: null,
    retry: (fn) => comRetry(fn, { tentativas: 5, baseMs: 1 }),
  });
  assert.equal(r.patch.asaas_customer_id, 'cus_000001');
  assert.equal(provider.calls.createCustomer, 3, '2 falhas + 1 sucesso');
});

test('E2E cancelamento idempotente: cancelar 2x não falha (§53)', async () => {
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_c', { id: 'cus_c' });
  const sub = await provider.createSubscription({ customerId: 'cus_c', value: 100, nextDueDate: '2026-09-01' });
  const c1 = await provider.cancelSubscription({ subscriptionId: sub.id });
  const c2 = await provider.cancelSubscription({ subscriptionId: sub.id });
  assert.equal(c1.status, 'CANCELLED');
  assert.equal(c2.status, 'CANCELLED');
});

test('E2E add-on mensal aceito atualiza subscription para proximo ciclo sem payment avulso', async () => {
  const mundo = criarMundo({
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 299.9 },
    addOns: [{ id: 'ad1', funcionalidade_id: 'f1', status: 'ativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado' }],
  });
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_a', { id: 'cus_a' });
  provider.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
  const r = await ensureBillingStateComDeps({ empresaId: 'e-ad', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(provider.calls.updateSubscription, 1);
  assert.equal(provider.calls.createCharge, 0);
  assert.equal(provider.subscriptions.get('sub_a').value, 349.9);
  assert.equal(provider.subscriptions.get('sub_a').updatePendingPayments, false);
  assert.equal(r.resultados.find((x) => x.tipo === 'garantir_addon' || x.tipo === 'remover_addon'), undefined);
});

test('E2E add-on sem aceite explicito = zero billing', async () => {
  const mundo = criarMundo({
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 299.9 },
    addOns: [{ id: 'ad1', funcionalidade_id: 'f1', status: 'ativa', preco_mensal_centavos: 5000 }],
  });
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_a', { id: 'cus_a' });
  provider.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
  const r = await ensureBillingStateComDeps({ empresaId: 'e-ad', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(provider.calls.createCharge, 0);
  assert.equal(provider.calls.updateSubscription, 0);
  assert.ok(r.resultados.find((x) => x.tipo === 'addon_sem_aceite_billing'));
});

test('E2E add-on aprovado_por sem contrato/aditivo concluido = zero billing', async () => {
  const mundo = criarMundo({
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 299.9 },
    addOns: [{ id: 'ad1', funcionalidade_id: 'f1', status: 'ativa', origem: 'adicional', preco_mensal_centavos: 5000, aprovado_por: 'admin-1' }],
  });
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_a', { id: 'cus_a' });
  provider.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
  const r = await ensureBillingStateComDeps({ empresaId: 'e-ad-admin', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(provider.calls.updateSubscription, 0);
  assert.ok(r.resultados.find((x) => x.tipo === 'addon_sem_aceite_billing'));
});

test('E2E add-on respeita vigencia real de inicio/fim', async () => {
  const base = {
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 299.9 },
  };
  const futuro = criarMundo({
    ...base,
    addOns: [{ id: 'ad-futuro', status: 'ativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado', vigencia_inicio: '2026-09-01T00:00:00.000Z' }],
  });
  const p1 = new FakeAsaasProvider();
  p1.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
  await ensureBillingStateComDeps({ empresaId: 'e-ad-futuro', deps: futuro.deps, provider: p1, policyOverrides: { provider_mode: 'fake' }, agora: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(p1.calls.updateSubscription, 0);

  const vigente = criarMundo({
    ...base,
    addOns: [{ id: 'ad-vigente', status: 'ativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado', vigencia_inicio: '2026-08-01T00:00:00.000Z', vigencia_fim: '2026-09-01T00:00:00.000Z' }],
  });
  const p2 = new FakeAsaasProvider();
  p2.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
  await ensureBillingStateComDeps({ empresaId: 'e-ad-vigente', deps: vigente.deps, provider: p2, policyOverrides: { provider_mode: 'fake' }, agora: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(p2.subscriptions.get('sub_a').value, 349.9);

  const expirado = criarMundo({
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 349.9 },
    addOns: [{ id: 'ad-expirado', status: 'ativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado', vigencia_fim: '2026-08-01T00:00:00.000Z' }],
  });
  const p3 = new FakeAsaasProvider();
  p3.subscriptions.set('sub_a', { id: 'sub_a', value: 349.9, status: 'ACTIVE' });
  await ensureBillingStateComDeps({ empresaId: 'e-ad-expirado', deps: expirado.deps, provider: p3, policyOverrides: { provider_mode: 'fake' }, agora: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(p3.subscriptions.get('sub_a').value, 299.9);
});

test('E2E add-on preco_mensal_centavos e total negociado; quantidade nao multiplica', async () => {
  const casos = [
    { id: 'q1', quantidade: 1, esperado: 349.9, acaoInvalida: false },
    { id: 'q3', quantidade: 3, esperado: 349.9, acaoInvalida: false },
    { id: 'qnull', quantidade: null, esperado: 349.9, acaoInvalida: false },
    { id: 'q0', quantidade: 0, esperado: 299.9, acaoInvalida: true },
  ];
  for (const caso of casos) {
    const mundo = criarMundo({
      situacao: { situacao: 'ativa' },
      empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 299.9 },
      addOns: [{ id: caso.id, status: 'ativa', preco_mensal_centavos: 5000, quantidade: caso.quantidade, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado' }],
    });
    const provider = new FakeAsaasProvider();
    provider.subscriptions.set('sub_a', { id: 'sub_a', value: 299.9, status: 'ACTIVE' });
    const r = await ensureBillingStateComDeps({ empresaId: `e-ad-${caso.id}`, deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
    assert.equal(provider.subscriptions.get('sub_a').value, caso.esperado);
    assert.equal(Boolean(r.resultados.find((x) => x.tipo === 'addon_quantidade_invalida_billing')), caso.acaoInvalida);
  }
});

test('E2E add-on removido preserva historico pago e reduz proximo ciclo', async () => {
  const mundo = criarMundo({
    situacao: { situacao: 'ativa' },
    empresa: { asaas_customer_id: 'cus_a', asaas_subscription_id: 'sub_a', next_due_date: '2026-09-01', billing_valor_mensal: 349.9 },
    addOns: [{ id: 'ad1', funcionalidade_id: 'f1', status: 'inativa', preco_mensal_centavos: 5000, contrato_id: 'ct1', contrato_billing_status: 'plenamente_assinado', billing_component_id: 'pay_pago' }],
  });
  const provider = new FakeAsaasProvider();
  provider.customers.set('cus_a', { id: 'cus_a' });
  provider.subscriptions.set('sub_a', { id: 'sub_a', value: 349.9, status: 'ACTIVE' });
  provider.charges.set('pay_pago', { id: 'pay_pago', value: 50, status: 'RECEIVED' });
  await ensureBillingStateComDeps({ empresaId: 'e-ad', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(provider.calls.cancelComponent, 0);
  assert.equal(provider.charges.get('pay_pago').status, 'RECEIVED');
  assert.equal(provider.calls.updateSubscription, 1);
  assert.equal(provider.subscriptions.get('sub_a').value, 299.9);
});

test('E2E estado sem cobrança nova: suspensa não cria nada', async () => {
  const mundo = criarMundo({ situacao: { situacao: 'suspensa_financeiramente' } });
  const provider = new FakeAsaasProvider();
  const r = await ensureBillingStateComDeps({ empresaId: 'e-susp', deps: mundo.deps, provider, policyOverrides: { provider_mode: 'fake' } });
  assert.equal(r.requer_billing, false);
  assert.equal(provider.calls.createCustomer, 0);
});

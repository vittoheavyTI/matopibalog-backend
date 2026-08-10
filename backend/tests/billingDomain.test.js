const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolvePolicy, DEFAULTS, POLITICAS_IMPLANTACAO } = require('../services/billing/billingPolicyConfig');
const { planejarBilling, primeiroVencimentoMensalidade } = require('../services/billing/billingOrchestratorDomainService');
const { avaliarInadimplencia } = require('../services/billing/billingInadimplenciaDomainService');
const { reconciliar } = require('../services/billing/billingReconcileDomainService');
const { mapearStatusAsaas } = require('../services/billing/billingWebhookApplyDomainService');

// ── Política configurável (§15/§32) ──────────────────────────────────────────
test('policy: default é conservador (nao_cobrar, fake) e sobrescrevível', () => {
  const p = resolvePolicy({}, {});
  assert.equal(p.implantacao_timing, 'nao_cobrar');
  assert.equal(p.provider_mode, 'fake');
  assert.equal(p.grace_period_days, DEFAULTS.grace_period_days);
  const p2 = resolvePolicy({ implantacao_timing: 'fim_trial', grace_period_days: 10 }, {});
  assert.equal(p2.implantacao_timing, 'fim_trial');
  assert.equal(p2.grace_period_days, 10);
});

test('policy: env sobrescreve default; override vence env', () => {
  const env = { BILLING_IMPLANTACAO_TIMING: 'imediato', BILLING_GRACE_DAYS: '3' };
  assert.equal(resolvePolicy({}, env).implantacao_timing, 'imediato');
  assert.equal(resolvePolicy({}, env).grace_period_days, 3);
  assert.equal(resolvePolicy({ implantacao_timing: 'nao_cobrar' }, env).implantacao_timing, 'nao_cobrar');
});

test('policy: valores inválidos caem no default (sem hardcode escondido)', () => {
  assert.equal(resolvePolicy({ implantacao_timing: 'xyz' }, {}).implantacao_timing, DEFAULTS.implantacao_timing);
  assert.equal(resolvePolicy({ provider_mode: 'production' }, {}).provider_mode, DEFAULTS.provider_mode);
  assert.ok(POLITICAS_IMPLANTACAO.length === 4);
});

// ── primeiro vencimento respeita trial (§14) ─────────────────────────────────
test('primeiroVencimento: com trial futuro → trial_end; sem trial → hoje', () => {
  const agora = new Date('2026-08-09T00:00:00.000Z');
  assert.equal(primeiroVencimentoMensalidade({ trialEndsAt: '2026-08-20T00:00:00.000Z', agora }), '2026-08-20');
  assert.equal(primeiroVencimentoMensalidade({ trialEndsAt: null, agora }), '2026-08-09');
  // trial já vencido → hoje (não retroage)
  assert.equal(primeiroVencimentoMensalidade({ trialEndsAt: '2026-08-01T00:00:00.000Z', agora }), '2026-08-09');
});

// ── planejar billing respeita trial e idempotência ───────────────────────────
test('planejarBilling: trial ativo cria customer+assinatura com venc=trial_end, sem mensalidade antecipada', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'trial_ativo', trial_ends_at: '2026-08-20T00:00:00.000Z' },
    empresaBilling: {},
    snapshot: { valor_mensal: 299.9, valor_implantacao: 0 },
    policy: resolvePolicy({ provider_mode: 'fake' }),
    agora: new Date('2026-08-09T00:00:00.000Z'),
  });
  const assinatura = plano.acoes.find((a) => a.tipo === 'garantir_assinatura');
  assert.equal(assinatura.primeiro_vencimento, '2026-08-20');
  assert.equal(assinatura.respeita_trial, true);
});

test('planejarBilling: idempotente — com customer+subscription existentes não replaneja', () => {
  const plano = planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1' },
    snapshot: { valor_mensal: 299.9, valor_implantacao: 0 },
    policy: resolvePolicy({ provider_mode: 'fake' }),
  });
  assert.equal(plano.acoes.length, 0);
  assert.equal(plano.motivo, 'nada_a_fazer_idempotente');
});

test('planejarBilling: aguardando_assinatura → billing não aplicável (não cria estrutura antes da hora)', () => {
  const plano = planejarBilling({ situacao: { situacao: 'aguardando_assinatura' }, empresaBilling: {}, snapshot: {}, policy: resolvePolicy({}, {}) });
  assert.equal(plano.requer_billing, false);
});

// ── Inadimplência (§30/§31/§32) ──────────────────────────────────────────────
test('inadimplência: trial válido protege — overdue NÃO suspende (§31)', () => {
  const r = avaliarInadimplencia({
    faturas: [{ status: 'vencido', vencimento: '2026-08-01' }],
    trialEndsAt: '2026-08-20T00:00:00.000Z',
    gracaDias: 5,
    agora: new Date('2026-08-10T00:00:00.000Z'),
  });
  assert.equal(r.trial_protege, true);
  assert.equal(r.suspender, false);
});

test('inadimplência: pós-trial dentro da graça não suspende; fora da graça suspende', () => {
  const base = { faturas: [{ status: 'vencido', vencimento: '2026-08-01' }], trialEndsAt: '2026-07-20T00:00:00.000Z' };
  const dentro = avaliarInadimplencia({ ...base, gracaDias: 15, agora: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(dentro.suspender, false);
  assert.equal(dentro.em_graca, true);
  const fora = avaliarInadimplencia({ ...base, gracaDias: 3, agora: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(fora.suspender, true);
  assert.equal(fora.dias_atraso, 9);
});

test('inadimplência: sem faturas vencidas → não inadimplente', () => {
  const r = avaliarInadimplencia({ faturas: [{ status: 'pago' }], trialEndsAt: null, gracaDias: 5, agora: new Date() });
  assert.equal(r.inadimplente, false);
  assert.equal(r.suspender, false);
});

// ── Reconciliação (§23) ──────────────────────────────────────────────────────
test('reconciliar: detecta subscription ausente e cobrança local faltando', () => {
  const r = reconciliar({
    local: { asaas_customer_id: 'cus_1', asaas_subscription_id: null, faturas: [] },
    remoto: { customer: { id: 'cus_1' }, subscription: { id: 'sub_9', status: 'ACTIVE' }, charges: [{ id: 'pay_9', status: 'RECEIVED' }] },
  });
  assert.ok(r.divergencias.includes('subscription_mapping_ausente'));
  assert.ok(r.divergencias.includes('cobranca_local_faltando'));
  assert.equal(r.ok, false);
});

test('reconciliar: tudo consistente → ok', () => {
  const r = reconciliar({
    local: { asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1', faturas: [{ asaas_payment_id: 'pay_1', status: 'pago' }] },
    remoto: { customer: { id: 'cus_1' }, subscription: { id: 'sub_1', status: 'ACTIVE' }, charges: [{ id: 'pay_1', status: 'RECEIVED' }] },
  });
  assert.equal(r.ok, true);
});

// ── Mapa de status Asaas ─────────────────────────────────────────────────────
test('mapearStatusAsaas: cobre received/confirmed/overdue/refunded/deleted/pending', () => {
  assert.equal(mapearStatusAsaas('PAYMENT_RECEIVED'), 'pago');
  assert.equal(mapearStatusAsaas('PAYMENT_CONFIRMED'), 'pago');
  assert.equal(mapearStatusAsaas('PAYMENT_OVERDUE'), 'vencido');
  assert.equal(mapearStatusAsaas('PAYMENT_REFUNDED'), 'estornado');
  assert.equal(mapearStatusAsaas('PAYMENT_DELETED'), 'cancelado');
  assert.equal(mapearStatusAsaas('PAYMENT_CREATED'), 'pendente');
  assert.equal(mapearStatusAsaas('UNKNOWN_EVENT'), null);
});

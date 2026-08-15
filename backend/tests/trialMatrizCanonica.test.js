const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarSituacaoComercial,
  SITUACAO,
} = require('../services/situacaoComercialDomainService');

// §16/§30 — MATRIZ CANÔNICA DE TRIAL. Regra obrigatória do produto:
//   TRIAL ATIVO NÃO É CANCELADO POR PAGAMENTO, CONTRATO OU ACEITE ANTECIPADO.
// Durante trial válido → operar_escrita = true (salvo bloqueio duro independente).
// Contrato pendente SOZINHO não bloqueia trial válido.
//
// Estes testes são a barreira anti-regressão contra a lógica incorreta do PR #405
// (operacaoBloqueada = ... || contratoObrigatorioPendente).

const AGORA = new Date('2026-08-09T12:00:00.000Z');
const DEPOIS = new Date('2026-08-20T12:00:00.000Z'); // trial_ends no futuro
const ANTES = new Date('2026-08-01T12:00:00.000Z');  // trial_ends no passado

function empresaV2(over = {}) {
  return {
    status: 'trial',
    commercial_flow_version: 'v2',
    trial_started_at: '2026-08-05T12:00:00.000Z',
    trial_ends_at: DEPOIS.toISOString(),
    converted_at: null,
    decisao_pos_trial: null,
    bloqueio_motivo: null,
    ...over,
  };
}

const contratoAssinado = { status: 'plenamente_assinado', obrigatorio: true };
const contratoPendente = { status: 'aguardando_assinatura_cliente', obrigatorio: true };

function avaliar(empresa, contrato, extra = {}) {
  return avaliarSituacaoComercial({ empresa, contrato, agora: AGORA, ...extra });
}

// ── Núcleo da regra §16 ──────────────────────────────────────────────────────

test('trial ativo + contrato assinado → OPERA (escrita liberada)', () => {
  const r = avaliar(empresaV2(), contratoAssinado);
  assert.equal(r.acoes.operar_escrita, true);
  assert.ok([SITUACAO.TRIAL_ATIVO, SITUACAO.TRIAL_EXPIRANDO].includes(r.situacao));
});

test('trial ativo + contrato obrigatório PENDENTE → NÃO bloqueia trial válido... ', () => {
  const r = avaliar(empresaV2(), contratoPendente);
  assert.ok([SITUACAO.TRIAL_ATIVO, SITUACAO.TRIAL_EXPIRANDO].includes(r.situacao));
  assert.equal(r.acoes.operar_escrita, true);
  assert.equal(r.acoes.assinar_contrato, false);
});

test('trial ativo (contrato já concluído) + pendência residual não derruba escrita', () => {
  // trial válido no futuro implica contrato concluído no fluxo v2.
  const r = avaliar(empresaV2(), contratoAssinado);
  assert.equal(r.acoes.operar_escrita, true);
});

test('trial expirado + contrato pendente sem decisao -> aguardando decisao, nao divida', () => {
  const r = avaliar(empresaV2({ trial_ends_at: ANTES.toISOString() }), contratoPendente);
  assert.equal(r.situacao, SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO);
  assert.equal(r.acoes.operar_escrita, false);
  assert.equal(r.acoes.assinar_contrato, false);
  assert.equal(r.acoes.converter, true);
});

test('trial expirado sem decisão (contrato ok) → aguardando decisão, escrita bloqueada', () => {
  const r = avaliar(empresaV2({ trial_ends_at: ANTES.toISOString() }), contratoAssinado);
  assert.equal(r.situacao, SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO);
  assert.equal(r.acoes.operar_escrita, false);
  assert.equal(r.acoes.converter, true);
});

test('trial expirado + decisão continuar + pagamentos pagos → ATIVA (opera)', () => {
  const r = avaliar(
    empresaV2({ trial_ends_at: ANTES.toISOString(), converted_at: AGORA.toISOString(), decisao_pos_trial: 'continuar' }),
    contratoAssinado,
    { snapshot: { valor_mensal: 299.9, valor_implantacao: 0 }, faturasIniciais: [{ origem: 'mensalidade', status: 'pago' }] },
  );
  assert.equal(r.situacao, SITUACAO.ATIVA);
  assert.equal(r.acoes.operar_escrita, true);
});

// ── §30: pagamento/aceite DURANTE o trial NÃO consome o trial ────────────────

test('pagamento antecipado durante trial ativo → continua em trial, opera, NENHUMA cobrança forçada', () => {
  // Mesmo com uma fatura de mensalidade paga, se o trial ainda é válido a situação
  // permanece de trial (o pagamento não encurta o período de teste).
  const r = avaliar(empresaV2(), contratoAssinado, {
    snapshot: { valor_mensal: 299.9, valor_implantacao: 0 },
    faturasIniciais: [{ origem: 'mensalidade', status: 'pago' }],
  });
  assert.ok([SITUACAO.TRIAL_ATIVO, SITUACAO.TRIAL_EXPIRANDO].includes(r.situacao));
  assert.equal(r.acoes.operar_escrita, true);
});

test('aceite de contrato durante trial não encerra o trial (segue trial ativo)', () => {
  const r = avaliar(empresaV2(), contratoAssinado);
  assert.notEqual(r.situacao, SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO);
  assert.equal(r.acoes.operar_escrita, true);
});

// ── Bloqueios DUROS independentes têm prioridade sobre o trial ───────────────

test('bloqueio administrativo derruba escrita mesmo com trial válido', () => {
  const r = avaliar(empresaV2({ status: 'bloqueado', bloqueio_motivo: 'administrativo' }), contratoAssinado);
  assert.equal(r.situacao, SITUACAO.BLOQUEADA_ADMINISTRATIVAMENTE);
  assert.equal(r.acoes.operar_escrita, false);
});

// ── Conta LEGADA não é afetada pela regra v2 ─────────────────────────────────

test('conta legada ativa → opera pelo caminho antigo (contrato não bloqueia)', () => {
  const r = avaliar(
    { status: 'ativo', commercial_flow_version: null, trial_ends_at: null },
    contratoPendente,
  );
  assert.equal(r.situacao, SITUACAO.LEGADO);
  assert.equal(r.acoes.operar_escrita, true);
});

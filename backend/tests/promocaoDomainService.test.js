// MEGA-FRENTE Billing Comercial Avançado — FASE 5: motor de promoções.
// Casos exigidos pelo prompt: código válido, expirado, sem usos restantes, usado
// duas vezes, manual após expirar, desconto implantação, desconto mensalidade,
// snapshot preservado. + bordas (percentual em centavos, plano-alvo, trial).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarResgate,
  aplicarPromocao,
  montarResgate,
  normalizarCodigo,
  ajustarValorPorResgate,
  ALVO,
} = require('../services/promocaoDomainService');

const AGORA = new Date('2026-07-24T12:00:00Z');
const EMPRESA = { id: 'emp-1' };

// Campanha ativa, janela aberta, uso único, sem plano-alvo.
const PROMO_ATIVA = {
  id: 'promo-1',
  tipo: 'desconto_percentual_mensalidade',
  percentual: 20,
  data_inicio: '2026-07-01T00:00:00Z',
  data_fim: '2026-07-31T23:59:59Z',
  ativo: true,
  limite_usos_total: 100,
  usos_total: 0,
  uso_unico_por_empresa: true,
  plano_alvo_id: null,
};

const CODIGO_OK = { id: 'cod-1', codigo: 'FEIRA20', limite_usos: 10, usos: 0, ativo: true };

// ── Código válido ───────────────────────────────────────────────────────────
test('código válido dentro da janela → ok', () => {
  const r = avaliarResgate({ promocao: PROMO_ATIVA, codigoRegistro: CODIGO_OK, empresa: EMPRESA, resgatesDaEmpresa: [], agora: AGORA });
  assert.equal(r.ok, true);
});

// ── Código expirado ─────────────────────────────────────────────────────────
test('promoção expirada (automático) → recusa', () => {
  const r = avaliarResgate({ promocao: PROMO_ATIVA, codigoRegistro: CODIGO_OK, empresa: EMPRESA, agora: new Date('2026-08-05T12:00:00Z') });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'promocao_expirada');
});

// ── Código sem usos restantes ───────────────────────────────────────────────
test('código sem usos restantes → recusa', () => {
  const esgotado = { ...CODIGO_OK, limite_usos: 5, usos: 5 };
  const r = avaliarResgate({ promocao: PROMO_ATIVA, codigoRegistro: esgotado, empresa: EMPRESA, agora: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'codigo_esgotado');
});

test('campanha esgotada (limite total) → recusa', () => {
  const promo = { ...PROMO_ATIVA, limite_usos_total: 3, usos_total: 3 };
  const r = avaliarResgate({ promocao: promo, codigoRegistro: CODIGO_OK, empresa: EMPRESA, agora: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'promocao_esgotada');
});

// ── Código usado duas vezes (uso único por empresa) ─────────────────────────
test('empresa que já resgatou → recusa (uso único)', () => {
  const r = avaliarResgate({ promocao: PROMO_ATIVA, codigoRegistro: CODIGO_OK, empresa: EMPRESA, resgatesDaEmpresa: [{ id: 'r1' }], agora: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja_utilizada_pela_empresa');
});

// ── Promoção manual após expirar ────────────────────────────────────────────
test('super-admin aplica manual após expiração → ok (fura janela)', () => {
  const r = avaliarResgate({ promocao: PROMO_ATIVA, empresa: EMPRESA, agora: new Date('2026-08-05T12:00:00Z'), manual: true });
  assert.equal(r.ok, true);
});

test('manual NÃO fura limite total esgotado', () => {
  const promo = { ...PROMO_ATIVA, limite_usos_total: 1, usos_total: 1 };
  const r = avaliarResgate({ promocao: promo, empresa: EMPRESA, agora: AGORA, manual: true });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'promocao_esgotada');
});

// ── Plano-alvo ──────────────────────────────────────────────────────────────
test('plano-alvo divergente → recusa; igual → ok', () => {
  const promo = { ...PROMO_ATIVA, plano_alvo_id: 'plano-A' };
  const nao = avaliarResgate({ promocao: promo, codigoRegistro: CODIGO_OK, empresa: EMPRESA, planoEscolhidoId: 'plano-B', agora: AGORA });
  assert.equal(nao.motivo, 'plano_nao_elegivel');
  const sim = avaliarResgate({ promocao: promo, codigoRegistro: CODIGO_OK, empresa: EMPRESA, planoEscolhidoId: 'plano-A', agora: AGORA });
  assert.equal(sim.ok, true);
});

// ── Desconto de mensalidade ─────────────────────────────────────────────────
test('desconto percentual de mensalidade em centavos (20% de 499,90 = 399,92)', () => {
  const e = aplicarPromocao({ promocao: PROMO_ATIVA, precoMensalidade: 499.90 });
  assert.equal(e.ok, true);
  assert.equal(e.alvo, ALVO.MENSALIDADE);
  // 49990 * 20% = 9998 centavos de desconto → final 39992 = 399,92
  assert.equal(e.mensalidade_final, 399.92);
  assert.equal(e.desconto_mensalidade, 99.98);
});

test('desconto fixo de mensalidade não fica negativo', () => {
  const promo = { id: 'p', tipo: 'desconto_fixo_mensalidade', valor: 600 };
  const e = aplicarPromocao({ promocao: promo, precoMensalidade: 499.90 });
  assert.equal(e.mensalidade_final, 0);
  assert.equal(e.desconto_mensalidade, 499.90);
});

test('preço promocional fixa o valor da mensalidade', () => {
  const promo = { id: 'p', tipo: 'preco_promocional', valor: 199.90, duracao_meses: 3 };
  const e = aplicarPromocao({ promocao: promo, precoMensalidade: 499.90 });
  assert.equal(e.mensalidade_final, 199.90);
  assert.equal(e.desconto_mensalidade, 300.00);
});

// ── Desconto / isenção de implantação ───────────────────────────────────────
test('isenção de implantação zera a taxa', () => {
  const promo = { id: 'p', tipo: 'isencao_implantacao' };
  const e = aplicarPromocao({ promocao: promo, valorImplantacao: 500 });
  assert.equal(e.alvo, ALVO.IMPLANTACAO);
  assert.equal(e.implantacao_final, 0);
  assert.equal(e.desconto_implantacao, 500);
});

test('desconto percentual de implantação (50% de 500 = 250)', () => {
  const promo = { id: 'p', tipo: 'desconto_percentual_implantacao', percentual: 50 };
  const e = aplicarPromocao({ promocao: promo, valorImplantacao: 500 });
  assert.equal(e.implantacao_final, 250);
  assert.equal(e.desconto_implantacao, 250);
});

// ── Trial estendido ─────────────────────────────────────────────────────────
test('trial estendido soma dias', () => {
  const promo = { id: 'p', tipo: 'trial_estendido', dias_trial_extra: 15 };
  const e = aplicarPromocao({ promocao: promo, trialDiasBase: 7 });
  assert.equal(e.alvo, ALVO.TRIAL);
  assert.equal(e.trial_dias_final, 22);
});

// ── Snapshot preservado (auditoria) ─────────────────────────────────────────
test('montarResgate congela preço original/final, desconto, quem aplicou e motivo', () => {
  const efeito = aplicarPromocao({ promocao: PROMO_ATIVA, precoMensalidade: 499.90 });
  const r = montarResgate({
    promocao: PROMO_ATIVA,
    codigoRegistro: CODIGO_OK,
    empresa: EMPRESA,
    aplicadoPor: 'sa-1',
    manual: true,
    efeito,
    motivo: 'cortesia feira',
    precoOriginal: 499.90,
    faturaId: 'fat-9',
  });
  assert.equal(r.promocao_id, 'promo-1');
  assert.equal(r.codigo_id, 'cod-1');
  assert.equal(r.empresa_id, 'emp-1');
  assert.equal(r.aplicado_por, 'sa-1');
  assert.equal(r.manual, true);
  assert.equal(r.alvo, 'mensalidade');
  assert.equal(r.preco_original, 499.90);
  assert.equal(r.preco_final, 399.92);
  assert.equal(r.desconto_valor, 99.98);
  assert.equal(r.motivo, 'cortesia feira');
  assert.equal(r.fatura_id, 'fat-9');
});

// ── Normalização de código (case-insensitive, como o índice único) ──────────
test('normalizarCodigo: maiúsculas e trim', () => {
  assert.equal(normalizarCodigo(' feira20 '), 'FEIRA20');
  assert.equal(normalizarCodigo(null), '');
});

test('config inválida (percentual ausente) → recusa', () => {
  const promo = { id: 'p', tipo: 'desconto_percentual_mensalidade', percentual: null };
  const e = aplicarPromocao({ promocao: promo, precoMensalidade: 499.90 });
  assert.equal(e.ok, false);
  assert.equal(e.motivo, 'config_invalida');
});

// ─── FASE 1 (checkout) — desconto da promoção pendente na 1ª fatura ─────────
test('ajustarValorPorResgate: alvo mensalidade com preco_final desconta', () => {
  const r = ajustarValorPorResgate({ valorBase: 499.90, resgatePendente: { alvo: 'mensalidade', preco_final: 399.92, desconto_valor: 99.98 } });
  assert.equal(r.aplicou, true);
  assert.equal(r.valor, 399.92);
  assert.equal(r.desconto, 99.98);
});

test('ajustarValorPorResgate: sem resgate → valor base intacto', () => {
  const r = ajustarValorPorResgate({ valorBase: 499.90, resgatePendente: null });
  assert.equal(r.aplicou, false);
  assert.equal(r.valor, 499.90);
});

test('ajustarValorPorResgate: alvo implantacao NÃO altera mensalidade', () => {
  const r = ajustarValorPorResgate({ valorBase: 499.90, resgatePendente: { alvo: 'implantacao', preco_final: 0 } });
  assert.equal(r.aplicou, false);
  assert.equal(r.valor, 499.90);
});

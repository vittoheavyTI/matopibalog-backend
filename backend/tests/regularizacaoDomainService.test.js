// Domínio puro da fatura de regularização: matriz de elegibilidade, dedupe por
// fatura aberta, payload/snapshot e chave determinística. Sem I/O.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MOTIVOS_REG,
  ORIGEM_REGULARIZACAO,
  trialVencido,
  encontrarFaturaAberta,
  avaliarElegibilidadeRegularizacao,
  montarClientRequestIdRegularizacao,
  montarPayloadFaturaRegularizacao,
} = require('../services/regularizacaoDomainService');

const AGORA = new Date('2026-07-22T12:00:00Z');
const REF = '2026-07-22';

const PLANO_PAGO = { id: 'p1', nome: 'Plano Básico', ativo: true, arquivado_em: null, preco_mensal: 99.9, modelo_cobranca: 'fixo' };

function empresaSuspensaFinanceira(over = {}) {
  return { id: 'e1', status: 'suspenso', suspension_reason: 'financial', suspension_source: 'automatic', trial_ends_at: null, ...over };
}

// ── trialVencido ─────────────────────────────────────────────────────────────
test('trialVencido: só true para status trial com fim no passado', () => {
  assert.equal(trialVencido({ status: 'trial', trial_ends_at: '2026-07-01T00:00:00Z' }, AGORA), true);
  assert.equal(trialVencido({ status: 'trial', trial_ends_at: '2026-08-01T00:00:00Z' }, AGORA), false);
  assert.equal(trialVencido({ status: 'trial', trial_ends_at: null }, AGORA), false);
  assert.equal(trialVencido({ status: 'ativo', trial_ends_at: '2026-07-01T00:00:00Z' }, AGORA), false);
});

// ── encontrarFaturaAberta ────────────────────────────────────────────────────
test('encontrarFaturaAberta: só pendente/vencido, mais antiga primeiro', () => {
  const faturas = [
    { id: 'paga', status: 'pago', due_date: '2026-06-01' },
    { id: 'cancelada', status: 'cancelado', due_date: '2026-06-02' },
    { id: 'nova', status: 'pendente', due_date: '2026-07-30' },
    { id: 'velha', status: 'vencido', due_date: '2026-06-10' },
  ];
  assert.equal(encontrarFaturaAberta(faturas).id, 'velha');
  assert.equal(encontrarFaturaAberta([{ id: 'x', status: 'pago' }]), null);
  assert.equal(encontrarFaturaAberta([]), null);
  assert.equal(encontrarFaturaAberta(null), null);
});

// ── elegibilidade: estados ───────────────────────────────────────────────────
test('trial vencido com plano pago e sem fatura aberta → cobrar', () => {
  const d = avaliarElegibilidadeRegularizacao({
    empresa: { id: 'e1', status: 'trial', trial_ends_at: '2026-07-01T00:00:00Z' },
    plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF, agora: AGORA,
  });
  assert.equal(d.resultado, 'cobrar');
  assert.equal(d.periodo, '2026-07-01');
});

test('trial ainda ativo → pular (trial_ainda_ativo)', () => {
  const d = avaliarElegibilidadeRegularizacao({
    empresa: { id: 'e1', status: 'trial', trial_ends_at: '2026-08-01T00:00:00Z' },
    plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF, agora: AGORA,
  });
  assert.equal(d.resultado, 'pular');
  assert.equal(d.motivo, MOTIVOS_REG.TRIAL_ATIVO);
});

test('suspenso financeiro → cobrar; suspenso sem motivo (manual legado) → cobrar', () => {
  for (const empresa of [empresaSuspensaFinanceira(), empresaSuspensaFinanceira({ suspension_reason: null, suspension_source: null })]) {
    const d = avaliarElegibilidadeRegularizacao({ empresa, plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF, agora: AGORA });
    assert.equal(d.resultado, 'cobrar', `reason=${empresa.suspension_reason}`);
  }
});

test('suspensão administrativa/segurança/legacy_unknown → pular (não financeiro)', () => {
  for (const reason of ['administrative', 'security', 'legacy_unknown']) {
    const d = avaliarElegibilidadeRegularizacao({
      empresa: empresaSuspensaFinanceira({ suspension_reason: reason }),
      plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF, agora: AGORA,
    });
    assert.equal(d.resultado, 'pular', reason);
    assert.equal(d.motivo, MOTIVOS_REG.SUSPENSAO_NAO_FINANCEIRA);
  }
});

test('ativo/bloqueado/expirado → pular (sem pendência destravável)', () => {
  for (const status of ['ativo', 'bloqueado', 'expirado']) {
    const d = avaliarElegibilidadeRegularizacao({
      empresa: { id: 'e1', status }, plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF, agora: AGORA,
    });
    assert.equal(d.resultado, 'pular', status);
    assert.equal(d.motivo, MOTIVOS_REG.ESTADO_SEM_PENDENCIA);
  }
});

// ── elegibilidade: dedupe e plano ────────────────────────────────────────────
test('fatura aberta existente (qualquer origem) → fatura_aberta, nunca duplicar', () => {
  const aberta = { id: 'f-aberta', status: 'vencido', due_date: '2026-06-10', origem: 'recorrente' };
  const d = avaliarElegibilidadeRegularizacao({
    empresa: empresaSuspensaFinanceira(),
    plano: PLANO_PAGO, faturasExistentes: [aberta], dataReferencia: REF, agora: AGORA,
  });
  assert.equal(d.resultado, 'fatura_aberta');
  assert.equal(d.faturaAberta.id, 'f-aberta');
});

test('plano ausente/inativo/arquivado → pular plano_invalido; gratuito → plano_gratuito', () => {
  const empresa = empresaSuspensaFinanceira();
  const casos = [
    [null, MOTIVOS_REG.PLANO_INVALIDO],
    [{ ...PLANO_PAGO, ativo: false }, MOTIVOS_REG.PLANO_INVALIDO],
    [{ ...PLANO_PAGO, arquivado_em: '2026-01-01' }, MOTIVOS_REG.PLANO_INVALIDO],
    [{ ...PLANO_PAGO, preco_mensal: 0 }, MOTIVOS_REG.PLANO_GRATUITO],
    [{ ...PLANO_PAGO, preco_mensal: null }, MOTIVOS_REG.PLANO_GRATUITO],
  ];
  for (const [plano, motivo] of casos) {
    const d = avaliarElegibilidadeRegularizacao({ empresa, plano, faturasExistentes: [], dataReferencia: REF, agora: AGORA });
    assert.equal(d.resultado, 'pular');
    assert.equal(d.motivo, motivo);
  }
});

test('empresa ausente → erro; data inválida → erro', () => {
  assert.equal(avaliarElegibilidadeRegularizacao({ empresa: null, plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: REF }).resultado, 'erro');
  assert.equal(avaliarElegibilidadeRegularizacao({ empresa: empresaSuspensaFinanceira(), plano: PLANO_PAGO, faturasExistentes: [], dataReferencia: 'lixo' }).resultado, 'erro');
});

// ── payload ──────────────────────────────────────────────────────────────────
test('payload: origem regularizacao, período dia 1, due +7, chave determinística, snapshot', () => {
  const p = montarPayloadFaturaRegularizacao({ empresa: { id: 'e1' }, plano: PLANO_PAGO, dataReferencia: REF });
  assert.equal(p.empresa_id, 'e1');
  assert.equal(p.valor, 99.9);
  assert.equal(p.tipo_pagamento, 'PIX');
  assert.equal(p.status, 'pendente');
  assert.equal(p.origem, ORIGEM_REGULARIZACAO);
  assert.equal(p.periodo_referencia, '2026-07-01'); // CHECK dia-1 da 031
  assert.equal(p.due_date, '2026-07-29'); // referência + 7 dias
  assert.equal(p.client_request_id, 'regularizacao:e1:2026-07');
  assert.equal(p.plano_nome_snapshot, 'Plano Básico');
  assert.equal(p.modelo_cobranca_snapshot, 'fixo');
});

test('client_request_id: mesma empresa/mês → mesma chave (idempotência)', () => {
  assert.equal(
    montarClientRequestIdRegularizacao('e1', '2026-07-01'),
    'regularizacao:e1:2026-07',
  );
  assert.notEqual(
    montarClientRequestIdRegularizacao('e1', '2026-07-01'),
    montarClientRequestIdRegularizacao('e1', '2026-08-01'),
  );
});

test('payload por_motorista: snapshot com unitário e quantidade', () => {
  const plano = { ...PLANO_PAGO, modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 10, preco_mensal: 1000 };
  const p = montarPayloadFaturaRegularizacao({ empresa: { id: 'e1' }, plano, dataReferencia: REF });
  assert.equal(p.valor, 1000); // preco_mensal É o valor final (regra central)
  assert.equal(p.modelo_cobranca_snapshot, 'por_motorista');
  assert.equal(p.preco_unitario_snapshot, 100);
  assert.equal(p.quantidade_snapshot, 10);
});

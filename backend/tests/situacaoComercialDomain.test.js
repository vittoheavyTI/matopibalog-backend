const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SITUACAO,
  FLOW_V2,
  montarPagamentosIniciais,
  avaliarSituacaoComercial,
} = require('../services/situacaoComercialDomainService');

// Datas fixas para determinismo.
const AGORA = new Date('2026-08-04T12:00:00Z');
const FUTURO = new Date('2026-08-20T12:00:00Z').toISOString(); // +16 dias
const PROXIMO = new Date('2026-08-06T12:00:00Z').toISOString(); // +2 dias
const PASSADO = new Date('2026-07-30T12:00:00Z').toISOString(); // -5 dias

const SNAP_ZERO = { valor_mensal: 299.9, valor_implantacao: 0, implantacao_gratis: true, total_inicial: 0, trial_dias: 14 };
const SNAP_IMPLANT = { valor_mensal: 299.9, valor_implantacao: 500, implantacao_gratis: false, total_inicial: 500, trial_dias: 14 };
const CONTRATO_ASSINADO = { status: 'plenamente_assinado', obrigatorio: true };

const perto = (a, b) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.01, `esperava ~${b}, veio ${a}`);
const v2 = (over = {}) => ({ commercial_flow_version: FLOW_V2, status: 'trial', ...over });

// --- montarPagamentosIniciais ---
test('pagamentos: implantação zero → só mensalidade', () => {
  const r = montarPagamentosIniciais({ snapshot: SNAP_ZERO, faturasIniciais: [] });
  assert.deepEqual(r.necessarios.map((p) => p.tipo), ['mensalidade']);
  assert.equal(r.todosPagos, false);
});

test('pagamentos: implantação positiva → implantação + mensalidade separadas', () => {
  const r = montarPagamentosIniciais({ snapshot: SNAP_IMPLANT, faturasIniciais: [] });
  assert.deepEqual(r.necessarios.map((p) => p.tipo), ['implantacao', 'mensalidade']);
  perto(r.valorPendente, 799.9);
});

test('pagamentos: só implantação paga não zera pendência (cenário B)', () => {
  const r = montarPagamentosIniciais({ snapshot: SNAP_IMPLANT, faturasIniciais: [{ origem: 'implantacao', status: 'pago', valor: 500 }] });
  assert.equal(r.todosPagos, false);
  perto(r.valorPendente, 299.9);
});

test('pagamentos: todas pagas → todosPagos true, pendência zero', () => {
  const r = montarPagamentosIniciais({ snapshot: SNAP_IMPLANT, faturasIniciais: [
    { origem: 'implantacao', status: 'pago', valor: 500 },
    { origem: 'mensalidade', status: 'pago', valor: 299.9 },
  ] });
  assert.equal(r.todosPagos, true);
  assert.equal(r.valorPendente, 0);
});

test('pagamentos: fatura cancelada é ignorada', () => {
  const r = montarPagamentosIniciais({ snapshot: SNAP_ZERO, faturasIniciais: [{ origem: 'mensalidade', status: 'cancelado', valor: 299.9 }] });
  assert.equal(r.necessarios[0].status, 'ausente');
});

// --- bloqueios de prioridade máxima ---
test('bloqueio administrativo vence tudo e não é removido por pagamento', () => {
  const r = avaliarSituacaoComercial({
    empresa: v2({ status: 'bloqueado', converted_at: AGORA.toISOString() }),
    contrato: CONTRATO_ASSINADO,
    snapshot: SNAP_ZERO,
    faturasIniciais: [{ origem: 'mensalidade', status: 'pago', valor: 299.9 }],
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.BLOQUEADA_ADMINISTRATIVAMENTE);
  assert.equal(r.acoes.operar_escrita, false);
  assert.equal(r.acoes.consultar, true);
});

test('bloqueio_motivo=fraude → bloqueada mesmo em trial', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ bloqueio_motivo: 'fraude' }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.BLOQUEADA_ADMINISTRATIVAMENTE);
});

test('cancelada', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ status: 'cancelada' }), snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.CANCELADA);
  assert.equal(r.acoes.operar_escrita, false);
});

// --- conta legada não é afetada ---
test('legado ativo → escrita liberada, situação legado', () => {
  const r = avaliarSituacaoComercial({ empresa: { status: 'ativo' }, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.LEGADO);
  assert.equal(r.legado, true);
  assert.equal(r.acoes.operar_escrita, true);
});

test('legado trial não vencido → escrita liberada', () => {
  const r = avaliarSituacaoComercial({ empresa: { status: 'trial', trial_ends_at: FUTURO }, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.LEGADO);
  assert.equal(r.acoes.operar_escrita, true);
});

test('legado suspenso → escrita bloqueada, regularizar', () => {
  const r = avaliarSituacaoComercial({ empresa: { status: 'suspenso' }, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.LEGADO);
  assert.equal(r.acoes.operar_escrita, false);
  assert.equal(r.acoes.regularizar, true);
});

// --- fluxo novo (v2) ---
test('v2: contrato obrigatório pendente sem aquisição → aguarda ativação do trial, sem exigir assinatura', () => {
  const r = avaliarSituacaoComercial({ empresa: v2(), contrato: { status: 'aguardando_assinatura', obrigatorio: true }, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.AGUARDANDO_ATIVACAO_TRIAL);
  assert.equal(r.acoes.assinar_contrato, false);
  assert.equal(r.acoes.operar_escrita, false);
});

test('v2: trial vigente + contrato obrigatório pendente → trial preservado, escrita OK', () => {
  const r = avaliarSituacaoComercial({
    empresa: v2({ trial_started_at: PASSADO, trial_ends_at: FUTURO }),
    contrato: { status: 'aguardando_assinatura', obrigatorio: true },
    snapshot: SNAP_ZERO,
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.TRIAL_ATIVO);
  assert.equal(r.acoes.operar_escrita, true);
  assert.equal(r.acoes.assinar_contrato, false);
  assert.equal(r.proxima_acao, 'operar');
});

test('v2: compra iniciada durante trial permite assinar contrato sem encurtar o trial', () => {
  const r = avaliarSituacaoComercial({
    empresa: v2({ trial_started_at: PASSADO, trial_ends_at: FUTURO, decisao_pos_trial: 'continuar' }),
    contrato: { status: 'aguardando_assinatura', obrigatorio: true },
    snapshot: SNAP_ZERO,
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.TRIAL_ATIVO);
  assert.equal(r.acoes.operar_escrita, true);
  assert.equal(r.acoes.assinar_contrato, true);
  assert.equal(r.trial_ends_at, FUTURO);
});

test('v2: contrato assinado + trial vigente → trial_ativo, escrita OK, sem cobrança', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ trial_started_at: PASSADO, trial_ends_at: FUTURO }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.TRIAL_ATIVO);
  assert.equal(r.acoes.operar_escrita, true);
  assert.equal(r.acoes.regularizar, false);
});

test('v2: trial nos últimos dias → trial_expirando', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ trial_ends_at: PROXIMO }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.TRIAL_EXPIRANDO);
  assert.equal(r.acoes.operar_escrita, true);
  assert.equal(r.dias_restantes, 2);
});

test('v2: trial vencido sem decisão → aguardando_decisao, sem escrita, sem cobrança', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ trial_ends_at: PASSADO }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO);
  assert.equal(r.acoes.operar_escrita, false);
  assert.equal(r.acoes.converter, true);
  assert.equal(r.decisao_pos_trial, 'pendente');
});

test('v2: trial vencido + não continuar → encerrado_sem_contratacao, sem dívida', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ trial_ends_at: PASSADO, decisao_pos_trial: 'nao_continuar' }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.TRIAL_ENCERRADO_SEM_CONTRATACAO);
  assert.equal(r.acoes.regularizar, false);
  assert.equal(r.acoes.converter, true);
});

test('v2: trial vencido + continuar (não pago) → conversao_aguardando_pagamento', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ trial_ends_at: PASSADO, decisao_pos_trial: 'continuar' }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO);
  assert.equal(r.acoes.regularizar, true);
  perto(r.valor_pendente, 299.9);
});

test('v2: convertida + tudo pago → ativa', () => {
  const r = avaliarSituacaoComercial({
    empresa: v2({ status: 'ativo', converted_at: AGORA.toISOString(), trial_ends_at: PASSADO, decisao_pos_trial: 'continuar' }),
    contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO,
    faturasIniciais: [{ origem: 'mensalidade', status: 'pago', valor: 299.9 }], agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.ATIVA);
  assert.equal(r.acoes.operar_escrita, true);
});

test('v2: convertida cenário B só implantação paga → ainda aguardando pagamento', () => {
  const r = avaliarSituacaoComercial({
    empresa: v2({ converted_at: AGORA.toISOString(), trial_ends_at: PASSADO, decisao_pos_trial: 'continuar' }),
    contrato: CONTRATO_ASSINADO, snapshot: SNAP_IMPLANT,
    faturasIniciais: [{ origem: 'implantacao', status: 'pago', valor: 500 }], agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO);
  perto(r.valor_pendente, 299.9);
});

test('v2: suspensão financeira pós-ativação → suspensa, regularizar', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ status: 'suspenso', converted_at: AGORA.toISOString() }), contrato: CONTRATO_ASSINADO, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.SUSPENSA_FINANCEIRAMENTE);
  assert.equal(r.acoes.regularizar, true);
  assert.equal(r.acoes.operar_escrita, false);
});

test('v2: sem contrato concluído e sem trial → aguardando ativação por termos', () => {
  const r = avaliarSituacaoComercial({ empresa: v2({ status: 'trial' }), contrato: null, snapshot: SNAP_ZERO, agora: AGORA });
  assert.equal(r.situacao, SITUACAO.AGUARDANDO_ATIVACAO_TRIAL);
  assert.equal(r.acoes.assinar_contrato, false);
});

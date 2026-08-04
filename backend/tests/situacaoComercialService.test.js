const test = require('node:test');
const assert = require('node:assert/strict');
const {
  contratoGovernante,
  montarSituacaoComercial,
  situacaoNaoAplicavel,
} = require('../services/situacaoComercialService');
const { SITUACAO, FLOW_V2 } = require('../services/situacaoComercialDomainService');

const AGORA = new Date('2026-08-04T12:00:00Z');
const FUTURO = new Date('2026-08-20T12:00:00Z').toISOString();
const PASSADO = new Date('2026-07-30T12:00:00Z').toISOString();
const SNAP = { plano_nome: 'Empresa Start', valor_mensal: 299.9, valor_implantacao: 0, trial_dias: 14 };
const SNAP_IMPLANT = { plano_nome: 'Empresa Start', valor_mensal: 299.9, valor_implantacao: 500, trial_dias: 14 };

test('contratoGovernante: prioriza obrigatório pendente', () => {
  const c = contratoGovernante([
    { obrigatorio: true, status: 'plenamente_assinado' },
    { obrigatorio: true, status: 'aguardando_assinatura' },
  ]);
  assert.equal(c.status, 'aguardando_assinatura');
});

test('contratoGovernante: sem obrigatório → null', () => {
  assert.equal(contratoGovernante([{ obrigatorio: false, status: 'aguardando_assinatura' }]), null);
});

test('contratoGovernante: obrigatório cancelado é ignorado', () => {
  assert.equal(contratoGovernante([{ obrigatorio: true, status: 'cancelado' }]), null);
});

test('montar: conta legada (sem flow v2) → situação legado, escrita conforme status', () => {
  const r = montarSituacaoComercial({ empresa: { status: 'ativo' }, contratos: [], proposta: null, faturas: [], agora: AGORA });
  assert.equal(r.situacao, SITUACAO.LEGADO);
  assert.equal(r.commercial_flow_version, null);
  assert.equal(r.pode_operar, true);
});

test('montar: v2 trial ativo → echo de plano/valores e sem cobrança', () => {
  const r = montarSituacaoComercial({
    empresa: { commercial_flow_version: FLOW_V2, status: 'trial', trial_ends_at: FUTURO },
    contratos: [{ obrigatorio: true, status: 'plenamente_assinado' }],
    proposta: { snapshot: SNAP },
    faturas: [],
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.TRIAL_ATIVO);
  assert.equal(r.trial_ativo, true);
  assert.equal(r.plano_nome, 'Empresa Start');
  assert.equal(r.mensalidade, 299.9);
  assert.equal(r.implantacao, 0);
  assert.equal(r.implantacao_gratis, true);
  assert.equal(r.pode_operar, true);
});

test('montar: v2 trial expirado sem decisão → bloqueia escrita, motivo estruturado', () => {
  const r = montarSituacaoComercial({
    empresa: { commercial_flow_version: FLOW_V2, status: 'trial', trial_ends_at: PASSADO },
    contratos: [{ obrigatorio: true, status: 'plenamente_assinado' }],
    proposta: { snapshot: SNAP },
    faturas: [],
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO);
  assert.equal(r.pode_operar, false);
  assert.equal(r.motivo_bloqueio, 'trial_vencido_sem_decisao');
  assert.equal(r.pode_contratar, true);
});

test('montar: v2 cenário B, implantação paga e mensalidade pendente → valor_pendente correto', () => {
  const r = montarSituacaoComercial({
    empresa: { commercial_flow_version: FLOW_V2, status: 'trial', trial_ends_at: PASSADO, decisao_pos_trial: 'continuar', converted_at: AGORA.toISOString() },
    contratos: [{ obrigatorio: true, status: 'plenamente_assinado' }],
    proposta: { snapshot: SNAP_IMPLANT },
    faturas: [{ origem: 'implantacao', status: 'pago', valor: 500 }],
    agora: AGORA,
  });
  assert.equal(r.situacao, SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO);
  assert.ok(Math.abs(r.valor_pendente - 299.9) < 0.01);
  assert.equal(r.implantacao, 500);
});

test('montar: snapshot pode vir "cru" (sem wrapper .snapshot)', () => {
  const r = montarSituacaoComercial({
    empresa: { commercial_flow_version: FLOW_V2, status: 'trial', trial_ends_at: FUTURO },
    contratos: [{ obrigatorio: true, status: 'plenamente_assinado' }],
    proposta: SNAP, // direto, sem { snapshot: ... }
    faturas: [],
    agora: AGORA,
  });
  assert.equal(r.mensalidade, 299.9);
});

test('situacaoNaoAplicavel: super-admin sem empresa opera/consulta livre', () => {
  const r = situacaoNaoAplicavel();
  assert.equal(r.aplicavel, false);
  assert.equal(r.pode_operar, true);
});

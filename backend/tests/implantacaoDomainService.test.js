// MEGA-FRENTE Billing Comercial Avançado — FASE 4: taxa de implantação.
// Prova: autônomo isento, empresa cobra, idempotência (não cobra 2×), isenção
// manual, isenção/desconto por promoção (valorEfetivo), snapshot e payloads.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarImplantacao,
  montarPayloadImplantacao,
  montarPayloadImplantacaoIsenta,
  montarClientRequestIdImplantacao,
  implantacaoResolvida,
  ORIGEM_IMPLANTACAO,
} = require('../services/implantacaoDomainService');

const EMPRESA = { id: 'emp-1', tipo: 'empresa' };
const AUTONOMO = { id: 'aut-1', tipo: 'autonomo' };
const PLANO_EMPRESA = { id: 'p-start', nome: 'Empresa Start', categoria: 'empresa', valor_implantacao: 500 };
const PLANO_SEM_TAXA = { id: 'p-x', nome: 'Empresa X', categoria: 'empresa', valor_implantacao: null };
const PLANO_AUTONOMO = { id: 'p-solo', nome: 'Autônomo Solo', categoria: 'autonomo', valor_implantacao: null };

test('empresa com plano que tem taxa → cobrar', () => {
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: [] });
  assert.equal(r.acao, 'cobrar');
  assert.equal(r.valor, 500);
});

test('autônomo é isento por regra (mesmo com valor no plano)', () => {
  const r = avaliarImplantacao({ empresa: AUTONOMO, plano: { ...PLANO_AUTONOMO, valor_implantacao: 500 }, faturasImplantacaoExistentes: [] });
  assert.equal(r.acao, 'pular');
  assert.equal(r.motivo, 'autonomo_isento_por_regra');
});

test('plano de empresa sem taxa → pular (sem inventar valor)', () => {
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_SEM_TAXA, faturasImplantacaoExistentes: [] });
  assert.equal(r.acao, 'pular');
  assert.equal(r.motivo, 'sem_taxa_implantacao');
});

test('idempotência: implantação pendente → ja_registrada (não cobra 2×)', () => {
  const faturas = [{ origem: ORIGEM_IMPLANTACAO, status: 'pendente' }];
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: faturas });
  assert.equal(r.acao, 'ja_registrada');
});

test('idempotência: implantação já paga → ja_registrada', () => {
  const faturas = [{ origem: ORIGEM_IMPLANTACAO, status: 'pago' }];
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: faturas });
  assert.equal(r.acao, 'ja_registrada');
});

test('idempotência: implantação isenta (cancelado+flag) → ja_registrada', () => {
  const faturas = [{ origem: ORIGEM_IMPLANTACAO, status: 'cancelado', implantacao_isenta: true }];
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: faturas });
  assert.equal(r.acao, 'ja_registrada');
});

test('cobrança cancelada por engano (sem isenta) NÃO bloqueia recobrança', () => {
  const faturas = [{ origem: ORIGEM_IMPLANTACAO, status: 'cancelado', implantacao_isenta: false }];
  assert.equal(implantacaoResolvida(faturas), false);
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: faturas });
  assert.equal(r.acao, 'cobrar');
});

test('fatura de OUTRA origem (mensalidade) não conta como implantação', () => {
  const faturas = [{ origem: 'recorrente', status: 'pago' }];
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: faturas });
  assert.equal(r.acao, 'cobrar');
});

test('isenção manual do super-admin → isentar', () => {
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: [], isencaoManual: true });
  assert.equal(r.acao, 'isentar');
  assert.equal(r.motivo, 'isencao_manual');
});

test('promoção que zera a taxa (valorEfetivo=0) → isentar', () => {
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: [], valorEfetivo: 0 });
  assert.equal(r.acao, 'isentar');
});

test('promoção que dá desconto (valorEfetivo=250) → cobrar 250', () => {
  const r = avaliarImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: [], valorEfetivo: 250 });
  assert.equal(r.acao, 'cobrar');
  assert.equal(r.valor, 250);
});

test('empresa ausente → erro', () => {
  const r = avaliarImplantacao({ empresa: null, plano: PLANO_EMPRESA, faturasImplantacaoExistentes: [] });
  assert.equal(r.acao, 'erro');
});

test('client_request_id de implantação é lifetime (sem mês)', () => {
  assert.equal(montarClientRequestIdImplantacao('emp-1'), 'implantacao:emp-1');
});

test('payload de cobrança: fatura separada, origem implantacao, sem período', () => {
  const p = montarPayloadImplantacao({ empresa: EMPRESA, plano: PLANO_EMPRESA, valor: 500, dueDate: '2026-08-01' });
  assert.equal(p.origem, 'implantacao');
  assert.equal(p.valor, 500);
  assert.equal(p.status, 'pendente');
  assert.equal(p.periodo_referencia, null);
  assert.equal(p.implantacao_isenta, false);
  assert.equal(p.client_request_id, 'implantacao:emp-1');
  assert.equal(p.plano_nome_snapshot, 'Empresa Start');
});

test('payload de isenção: valor 0, cancelado, flag + auditoria, mesma chave', () => {
  const p = montarPayloadImplantacaoIsenta({ empresa: EMPRESA, plano: PLANO_EMPRESA, motivo: 'cortesia feira', isentoPor: 'sa-9' });
  assert.equal(p.valor, 0);
  assert.equal(p.status, 'cancelado');
  assert.equal(p.implantacao_isenta, true);
  assert.equal(p.implantacao_isencao_motivo, 'cortesia feira');
  assert.equal(p.implantacao_isento_por, 'sa-9');
  assert.equal(p.client_request_id, 'implantacao:emp-1'); // mesma vaga → bloqueia cobrança
});

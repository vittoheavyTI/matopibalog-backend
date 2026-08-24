'use strict';

// Command Center V2 — novas garantias do engine: attention_code estruturado (§40)
// e mascaramento financeiro (§26/§27/§86). Puro (sem supabase).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarTorreControle } = require('../utils/torreControle');

const freteBase = (over = {}) => ({
  id: 'f1', empresa_id: 'e1', motorista_id: 'm1', data: '2026-08-20',
  origem: 'A', destino: 'B', placa: 'ABC1D23', status: 'ativo', valor_frete: 1500, ...over,
});

test('attention_code: ocorrência crítica', () => {
  const r = montarTorreControle({
    fretes: [freteBase()],
    ocorrencias: [{ frete_id: 'f1', tipo: 'avaria', status: 'aberta' }],
    epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [],
  });
  assert.equal(r.itens[0].nivel, 'critico');
  assert.equal(r.itens[0].attention_code, 'OCORRENCIA_CRITICA');
});

test('attention_code: comprovante recusado (crítico) e pendente (atenção)', () => {
  const rej = montarTorreControle({ fretes: [freteBase({ status: 'finalizado' })], ocorrencias: [], epods: [{ frete_id: 'f1', status: 'rejeitado' }], evidencias: [], localizacoes: [], localizacaoEstados: [] });
  assert.equal(rej.itens[0].attention_code, 'COMPROVANTE_RECUSADO');
  assert.equal(rej.itens[0].nivel, 'critico');
  const pend = montarTorreControle({ fretes: [freteBase({ status: 'finalizado' })], ocorrencias: [], epods: [{ frete_id: 'f1', status: 'registrado' }], evidencias: [], localizacoes: [], localizacaoEstados: [] });
  assert.equal(pend.itens[0].attention_code, 'COMPROVACAO_PENDENTE');
});

test('attention_code: dados incompletos', () => {
  const r = montarTorreControle({ fretes: [freteBase({ origem: '' })], ocorrencias: [], epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [] });
  assert.equal(r.itens[0].attention_code, 'DADOS_INCOMPLETOS');
  assert.ok(r.itens[0].dados_incompletos.includes('origem'));
});

test('FINANCIAL LEAK: sem visibilidade, valor_frete é OMITIDO (não 0/mascarado)', () => {
  const r = montarTorreControle({ fretes: [freteBase()], ocorrencias: [], epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [], financialVisibility: false });
  const item = r.itens[0];
  assert.equal('valor_frete' in item, false); // campo AUSENTE
  assert.equal(item.financial_visibility, false);
});

test('com visibilidade financeira, valor_frete presente', () => {
  const r = montarTorreControle({ fretes: [freteBase()], ocorrencias: [], epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [], financialVisibility: true });
  assert.equal(r.itens[0].valor_frete, 1500);
  assert.equal(r.itens[0].financial_visibility, true);
});

test('sem visibilidade financeira, "valor do frete" não aparece nas pendências', () => {
  // frete ativo sem valor → normalmente listaria "valor do frete" em dados_incompletos
  const r = montarTorreControle({ fretes: [freteBase({ valor_frete: null })], ocorrencias: [], epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [], financialVisibility: false });
  assert.ok(!r.itens[0].dados_incompletos.includes('valor do frete'));
});

test('prioridade: ocorrência crítica vence dados incompletos', () => {
  const r = montarTorreControle({
    fretes: [freteBase({ origem: '' })],
    ocorrencias: [{ frete_id: 'f1', tipo: 'extravio', status: 'aberta' }],
    epods: [], evidencias: [], localizacoes: [], localizacaoEstados: [],
  });
  assert.equal(r.itens[0].attention_code, 'OCORRENCIA_CRITICA'); // não DADOS_INCOMPLETOS
});

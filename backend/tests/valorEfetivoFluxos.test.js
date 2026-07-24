// MEGA-FRENTE Extras por Empresa — FASE 3: valor efetivo nos payloads + adaptador.
const test = require('node:test');
const assert = require('node:assert/strict');

const { montarPayloadFaturaRecorrente, montarSnapshotFaturaRecorrente } = require('../services/faturaRecorrenteDomainService');
const { montarPayloadFaturaRegularizacao } = require('../services/regularizacaoDomainService');
const { derivarValorEfetivoFatura } = require('../services/calculadoraComercialService');

const START = { id: 'start', nome: 'Empresa Start', categoria: 'empresa', preco_mensal: 299.90, modelo_cobranca: 'fixo', capacidade_inclusa: 5, preco_motorista_extra: 100 };
const SOLO = { id: 'solo', nome: 'Autônomo Solo', categoria: 'autonomo', preco_mensal: 99.90, modelo_cobranca: 'fixo', capacidade_inclusa: 1, preco_motorista_extra: null };
const EMP = { id: 'e1' };
const REF = new Date('2026-08-10T12:00:00Z');

// ── Compat: sem valorEfetivo, valor = preco_mensal (comportamento anterior) ──
test('recorrente sem valorEfetivo → valor = preco_mensal', () => {
  const p = montarPayloadFaturaRecorrente({ empresa: EMP, plano: START, dataReferencia: REF });
  assert.equal(p.valor, 299.90);
  assert.equal(p.capacidade_inclusa_snapshot, undefined); // sem extras → snapshot antigo
});

test('regularização sem valorEfetivo → valor = preco_mensal', () => {
  const p = montarPayloadFaturaRegularizacao({ empresa: EMP, plano: START, dataReferencia: REF });
  assert.equal(p.valor, 299.90);
});

// ── Com valorEfetivo + extras: valor efetivo e snapshot completo ──
test('recorrente com valorEfetivo 499,90 + extras → valor e snapshot corretos', () => {
  const extras = { quantidade_contratada: 7, capacidade_inclusa: 5, quantidade_extra: 2, valor_extra: 200, preco_motorista_extra: 100 };
  const p = montarPayloadFaturaRecorrente({ empresa: EMP, plano: START, dataReferencia: REF, valorEfetivo: 499.90, extras });
  assert.equal(p.valor, 499.90);
  assert.equal(p.quantidade_snapshot, 7);           // quantidade CONTRATADA
  assert.equal(p.capacidade_inclusa_snapshot, 5);
  assert.equal(p.quantidade_extra_snapshot, 2);
  assert.equal(p.valor_extra_snapshot, 200);
  assert.equal(p.preco_unitario_snapshot, 100);
});

// ── Adaptador derivarValorEfetivoFatura ──
test('derivar: Start 7 contratados → valorEfetivo 499,90 + extras', () => {
  const r = derivarValorEfetivoFatura({ plano: START, quantidade_contratada: 7 });
  assert.equal(r.valorEfetivo, 499.90);
  assert.equal(r.extras.quantidade_extra, 2);
  assert.equal(r.extras.valor_extra, 200);
});

test('derivar: quantidade nula → valorEfetivo null (fallback preco_mensal)', () => {
  const r = derivarValorEfetivoFatura({ plano: START, quantidade_contratada: null });
  assert.equal(r.valorEfetivo, null);
  assert.equal(r.extras, null);
});

test('derivar: Start 5 (= capacidade) → valorEfetivo 299,90, sem extras (forward-safe)', () => {
  const r = derivarValorEfetivoFatura({ plano: START, quantidade_contratada: 5 });
  assert.equal(r.valorEfetivo, 299.90);
  assert.equal(r.extras.quantidade_extra, 0);
});

test('derivar: autônomo 2 → valorEfetivo null (não acomoda, sem extra de empresa)', () => {
  const r = derivarValorEfetivoFatura({ plano: SOLO, quantidade_contratada: 2 });
  assert.equal(r.valorEfetivo, null);
});

test('snapshot com extras: quantidade_snapshot vira a contratada', () => {
  const s = montarSnapshotFaturaRecorrente(START, { quantidade_contratada: 7, capacidade_inclusa: 5, quantidade_extra: 2, valor_extra: 200, preco_motorista_extra: 100 });
  assert.equal(s.quantidade_snapshot, 7);
  assert.equal(s.valor_extra_snapshot, 200);
});

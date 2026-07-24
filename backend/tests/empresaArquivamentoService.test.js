// Mega-frente higiene operacional — regras puras de arquivamento de empresas.
// Prova:
//   1. isArquivada: undefined (coluna inexistente) e null → NÃO arquivada;
//   2. filtro remove arquivadas por padrão; includeArchived mantém tudo;
//   3. patch arquivar/desarquivar/ausente; autoria vem do actor, não do body;
//   4. arquivar NÃO mexe em status;
//   5. resumo conta arquivadas e as que têm fatura paga (sinal).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isArquivada,
  aplicarFiltroArquivamento,
  apenasArquivadas,
  montarPatchArquivamentoEmpresa,
  resumirArquivadas,
} = require('../services/empresaArquivamentoService');

// ─── 1. isArquivada — deploy-safe (coluna pode não existir ainda) ────────────

test('isArquivada: undefined (coluna inexistente) → false', () => {
  assert.equal(isArquivada({ id: 'e1' }), false);
});

test('isArquivada: null (não arquivada) → false', () => {
  assert.equal(isArquivada({ id: 'e1', arquivada_em: null }), false);
});

test('isArquivada: timestamp → true', () => {
  assert.equal(isArquivada({ id: 'e1', arquivada_em: '2026-07-24T00:00:00Z' }), true);
});

test('isArquivada: entrada nula não quebra', () => {
  assert.equal(isArquivada(null), false);
  assert.equal(isArquivada(undefined), false);
});

// ─── 2. Filtro ───────────────────────────────────────────────────────────────

const LISTA = [
  { id: 'a', nome: 'Ativa', arquivada_em: null },
  { id: 'b', nome: 'Arquivada', arquivada_em: '2026-07-24T00:00:00Z' },
  { id: 'c', nome: 'Legada' }, // sem a coluna
];

test('filtro padrão remove arquivadas', () => {
  const r = aplicarFiltroArquivamento(LISTA);
  assert.deepEqual(r.map((e) => e.id), ['a', 'c']);
});

test('includeArchived=true mantém tudo', () => {
  const r = aplicarFiltroArquivamento(LISTA, { includeArchived: true });
  assert.equal(r.length, 3);
});

test('apenasArquivadas devolve só as arquivadas', () => {
  const r = apenasArquivadas(LISTA);
  assert.deepEqual(r.map((e) => e.id), ['b']);
});

test('filtro tolera entrada não-array', () => {
  assert.deepEqual(aplicarFiltroArquivamento(null), []);
  assert.deepEqual(apenasArquivadas(undefined), []);
});

// ─── 3. Patch de arquivar/desarquivar ────────────────────────────────────────

test('arquivar=true → carimbo + autoria do actor + motivo', () => {
  const p = montarPatchArquivamentoEmpresa({ arquivar: true, motivo: 'conta de teste' }, 'user-1');
  assert.ok(p.arquivada_em);
  assert.equal(p.arquivada_por, 'user-1');
  assert.equal(p.arquivada_motivo, 'conta de teste');
});

test('arquivar=true sem motivo → motivo null', () => {
  const p = montarPatchArquivamentoEmpresa({ arquivar: true }, 'user-1');
  assert.equal(p.arquivada_motivo, null);
});

test('autoria vem do actor, NUNCA do body', () => {
  const p = montarPatchArquivamentoEmpresa({ arquivar: true, arquivada_por: 'forjado' }, 'user-real');
  assert.equal(p.arquivada_por, 'user-real');
});

test('arquivar=false → zera tudo (desarquiva)', () => {
  const p = montarPatchArquivamentoEmpresa({ arquivar: false }, 'user-1');
  assert.equal(p.arquivada_em, null);
  assert.equal(p.arquivada_por, null);
  assert.equal(p.arquivada_motivo, null);
});

test('arquivar ausente → patch vazio (não toca a dimensão)', () => {
  assert.deepEqual(montarPatchArquivamentoEmpresa({ nome: 'x' }, 'user-1'), {});
  assert.deepEqual(montarPatchArquivamentoEmpresa(null, 'user-1'), {});
});

test('patch de arquivar NÃO inclui status (ortogonal a suspensão)', () => {
  const p = montarPatchArquivamentoEmpresa({ arquivar: true }, 'u');
  assert.equal('status' in p, false);
  assert.equal('ativo' in p, false);
});

// ─── 4. Resumo para billing-health ───────────────────────────────────────────

test('resumirArquivadas conta total e as com fatura paga', () => {
  const empresas = [
    { id: 'a', nome: 'A', arquivada_em: '2026-07-24T00:00:00Z' },
    { id: 'b', nome: 'B', arquivada_em: '2026-07-24T00:00:00Z' },
    { id: 'c', nome: 'C', arquivada_em: null },
  ];
  const r = resumirArquivadas(empresas, new Set(['b']));
  assert.equal(r.arquivadas_total, 2);
  assert.equal(r.arquivadas_com_fatura_paga, 1);
  assert.equal(r.detalhe_arquivadas_com_fatura_paga[0].nome, 'B');
});

test('resumirArquivadas sem Set de pagas não quebra', () => {
  const r = resumirArquivadas([{ id: 'a', arquivada_em: '2026-07-24T00:00:00Z' }], null);
  assert.equal(r.arquivadas_total, 1);
  assert.equal(r.arquivadas_com_fatura_paga, 0);
});

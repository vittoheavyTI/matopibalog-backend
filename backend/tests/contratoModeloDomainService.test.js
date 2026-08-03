const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS_MODELO,
  hashConteudo,
  proximaVersao,
  snapshotDoModelo,
  podeEditarRascunho,
  podePublicar,
} = require('../services/contratoModeloDomainService');

test('hashConteudo: sha256 hex de 64 chars, deterministico', () => {
  const h = hashConteudo('Contrato do plano X');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashConteudo('Contrato do plano X'));
  assert.notEqual(h, hashConteudo('Contrato do plano Y'));
});

test('proximaVersao: comeca em 1 e incrementa', () => {
  assert.equal(proximaVersao(null), 1);
  assert.equal(proximaVersao(0), 1);
  assert.equal(proximaVersao(3), 4);
});

test('snapshotDoModelo: congela id/versao/conteudo/hash; null sem modelo', () => {
  assert.equal(snapshotDoModelo(null), null);
  assert.equal(snapshotDoModelo({}), null);
  const snap = snapshotDoModelo({ id: 'm1', versao: 2, conteudo: 'texto legal', conteudo_hash: 'a'.repeat(64) });
  assert.deepEqual(snap, {
    modelo_id: 'm1',
    modelo_versao: 2,
    modelo_conteudo_snapshot: 'texto legal',
    modelo_conteudo_hash: 'a'.repeat(64),
  });
});

test('snapshotDoModelo: calcula hash se o modelo nao trouxe conteudo_hash', () => {
  const snap = snapshotDoModelo({ id: 'm1', versao: 1, conteudo: 'texto' });
  assert.equal(snap.modelo_conteudo_hash, hashConteudo('texto'));
});

test('transicoes: so rascunho edita/publica', () => {
  assert.equal(podeEditarRascunho({ status: STATUS_MODELO.RASCUNHO }), true);
  assert.equal(podeEditarRascunho({ status: STATUS_MODELO.PUBLICADO }), false);
  assert.equal(podePublicar({ status: STATUS_MODELO.RASCUNHO }), true);
  assert.equal(podePublicar({ status: STATUS_MODELO.ARQUIVADO }), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  obterModeloVigenteDoPlano,
  snapshotVigenteParaContrato,
} = require('../services/contratoModeloService');

// Mock encadeável: from().select().eq().eq().maybeSingle() → { data, error }.
function mockSupabase(resultado) {
  return {
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => resultado,
      };
      return api;
    },
  };
}

test('obterModeloVigenteDoPlano: devolve o modelo publicado do plano', async () => {
  const modelo = { id: 'm1', plano_id: 'p1', versao: 2, status: 'publicado', conteudo: 'x', conteudo_hash: 'a'.repeat(64) };
  const { modelo: r } = await obterModeloVigenteDoPlano({ supabase: mockSupabase({ data: modelo, error: null }), planoId: 'p1' });
  assert.equal(r.id, 'm1');
  assert.equal(r.versao, 2);
});

test('obterModeloVigenteDoPlano: sem publicado → null', async () => {
  const { modelo } = await obterModeloVigenteDoPlano({ supabase: mockSupabase({ data: null, error: null }), planoId: 'p1' });
  assert.equal(modelo, null);
});

test('obterModeloVigenteDoPlano: FAIL-OPEN se tabela ausente (migration pendente)', async () => {
  const err = { code: '42P01', message: 'relation "contrato_modelos" does not exist' };
  const r = await obterModeloVigenteDoPlano({ supabase: mockSupabase({ data: null, error: err }), planoId: 'p1' });
  assert.equal(r.modelo, null);
  assert.equal(r.migration_pendente, true);
});

test('obterModeloVigenteDoPlano: sem planoId → null sem tocar o banco', async () => {
  let tocou = false;
  const supabase = { from() { tocou = true; return {}; } };
  const { modelo } = await obterModeloVigenteDoPlano({ supabase, planoId: null });
  assert.equal(modelo, null);
  assert.equal(tocou, false);
});

test('snapshotVigenteParaContrato: congela snapshot quando ha modelo publicado', async () => {
  const modelo = { id: 'm1', plano_id: 'p1', versao: 3, status: 'publicado', conteudo: 'corpo do contrato', conteudo_hash: 'b'.repeat(64) };
  const { snapshot } = await snapshotVigenteParaContrato({ supabase: mockSupabase({ data: modelo, error: null }), planoId: 'p1' });
  assert.equal(snapshot.modelo_id, 'm1');
  assert.equal(snapshot.modelo_versao, 3);
  assert.equal(snapshot.modelo_conteudo_snapshot, 'corpo do contrato');
  assert.match(snapshot.modelo_conteudo_hash, /^[0-9a-f]{64}$/);
});

test('snapshotVigenteParaContrato: sem modelo → snapshot null (fallback texto tecnico)', async () => {
  const { snapshot } = await snapshotVigenteParaContrato({ supabase: mockSupabase({ data: null, error: null }), planoId: 'p1' });
  assert.equal(snapshot, null);
});

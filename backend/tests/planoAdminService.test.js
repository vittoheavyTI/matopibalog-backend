// Frente #6 (Billing v2) — arquivamento e exclusão segura de planos.
// Prova (critério conservador B):
//   1. plano inexistente → 404;
//   2. ja_utilizado=true → 409 (motivo ja_utilizado), NÃO deleta;
//   3. ja_utilizado=false mas empresa referencia → 409 (motivo empresas) + auto-cura a flag, NÃO deleta;
//   4. ja_utilizado=false e sem empresa → 200 excluido, deleta;
//   5. delete bate FK 23503 → 409 (motivo fk), NUNCA 500;
//   6. montarPatchArquivamento: arquivar/desarquivar setam os campos certos (autoria do token).

const test = require('node:test');
const assert = require('node:assert/strict');

const { montarPatchArquivamento, excluirPlano } = require('../services/planoAdminService');

// Mock de supabase encadeável, guiado por um cenário. Registra updates/deletes.
function makeSupabase(scenario = {}) {
  const calls = { updates: [], deletes: [] };
  function resolve(state) {
    if (state.table === 'planos' && state.op === 'select') {
      return { data: scenario.plano ?? null, error: scenario.planoLoadError ?? null };
    }
    if (state.table === 'empresas' && state.op === 'select') {
      return { count: scenario.empresasCount ?? 0, error: scenario.empresasCountError ?? null };
    }
    if (state.table === 'planos' && state.op === 'update') {
      calls.updates.push({ eqVal: state.eqVal, payload: state.payload });
      return { data: null, error: null };
    }
    if (state.table === 'planos' && state.op === 'delete') {
      calls.deletes.push(state.eqVal);
      return { error: scenario.deleteError ?? null };
    }
    return { data: null, error: null };
  }
  function builder(table) {
    const state = { table, op: 'select' };
    const b = {
      select(_cols, _opts) { state.op = 'select'; return b; },
      update(payload) { state.op = 'update'; state.payload = payload; return b; },
      delete() { state.op = 'delete'; return b; },
      eq(col, val) { state.eqCol = col; state.eqVal = val; return b; },
      maybeSingle() { return Promise.resolve(resolve(state)); },
      then(onF, onR) { return Promise.resolve(resolve(state)).then(onF, onR); },
    };
    return b;
  }
  return { supabase: { from: (t) => builder(t) }, calls };
}

test('excluirPlano: plano inexistente → 404', async () => {
  const { supabase } = makeSupabase({ plano: null });
  const r = await excluirPlano({ supabase, planoId: 'p1' });
  assert.equal(r.status, 404);
});

test('excluirPlano: ja_utilizado=true → 409 e NÃO deleta', async () => {
  const { supabase, calls } = makeSupabase({ plano: { id: 'p1', ja_utilizado: true } });
  const r = await excluirPlano({ supabase, planoId: 'p1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'ja_utilizado');
  assert.equal(r.body.excluivel, false);
  assert.equal(calls.deletes.length, 0);
});

test('excluirPlano: sem flag mas empresa referencia → 409 + auto-cura, NÃO deleta', async () => {
  const { supabase, calls } = makeSupabase({ plano: { id: 'p1', ja_utilizado: false }, empresasCount: 2 });
  const r = await excluirPlano({ supabase, planoId: 'p1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'empresas');
  assert.equal(r.body.empresas, 2);
  assert.equal(calls.deletes.length, 0);
  // auto-cura: marcou ja_utilizado=true
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].payload.ja_utilizado, true);
});

test('excluirPlano: nunca usado e sem empresa → 200 excluido', async () => {
  const { supabase, calls } = makeSupabase({ plano: { id: 'p1', ja_utilizado: false }, empresasCount: 0 });
  const r = await excluirPlano({ supabase, planoId: 'p1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.excluido, true);
  assert.deepEqual(calls.deletes, ['p1']);
});

test('excluirPlano: delete bate FK 23503 → 409 (motivo fk), nunca 500', async () => {
  const { supabase } = makeSupabase({
    plano: { id: 'p1', ja_utilizado: false },
    empresasCount: 0,
    deleteError: { code: '23503', message: 'foreign key violation' },
  });
  const r = await excluirPlano({ supabase, planoId: 'p1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'fk');
});

test('montarPatchArquivamento: arquivar=true seta campos + ativo=false (autoria do token)', () => {
  const patch = montarPatchArquivamento({ arquivar: true }, 'uid-super');
  assert.equal(patch.arquivado_por, 'uid-super');
  assert.equal(patch.ativo, false);
  assert.ok(typeof patch.arquivado_em === 'string');
});

test('montarPatchArquivamento: arquivar=false desarquiva sem reativar (ativo intacto)', () => {
  const patch = montarPatchArquivamento({ arquivar: false }, 'uid-super');
  assert.equal(patch.arquivado_em, null);
  assert.equal(patch.arquivado_por, null);
  assert.equal('ativo' in patch, false); // NÃO mexe em ativo → não reativa no app
});

test('montarPatchArquivamento: sem campo arquivar → patch vazio', () => {
  assert.deepEqual(montarPatchArquivamento({ nome: 'X' }, 'uid'), {});
});

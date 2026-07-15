// Frente #7 (Billing v2) — trava de limite de motoristas por plano.
// Prova das decisões de produto:
//   1. limite null → ok ilimitado (não conta);
//   2. totalAtual < limite → ok;
//   3. totalAtual >= limite → bloqueia (ok:false) e payload 409 correto;
//   4. contagem inclui pendente e aprovado, exclui bloqueado e não-motorista
//      (o filtro é montado na query — validamos que os filtros certos são aplicados);
//   5. empresa sem plano / inexistente → seguro (ilimitado), sem erro opaco;
//   6. ehErroTriggerLimiteMotoristas reconhece a mensagem do trigger legado.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarLimiteMotoristas,
  contarMotoristasUtilizaveis,
  montarErroLimiteMotoristas,
  ehErroTriggerLimiteMotoristas,
  STATUS_CADASTRO_UTILIZAVEL,
} = require('../services/planoLimiteService');

// Mock de supabase encadeável guiado por cenário. Registra os filtros aplicados
// na query de contagem (motoristas) para provarmos as regras de contagem.
function makeSupabase(scenario = {}) {
  const applied = { motoristas: { eq: {}, in: {} } };
  function resolve(state) {
    if (state.table === 'empresas' && state.op === 'select') {
      return { data: scenario.empresa ?? null, error: scenario.empresaError ?? null };
    }
    if (state.table === 'motoristas' && state.op === 'select') {
      return { count: scenario.totalAtual ?? 0, error: scenario.countError ?? null, data: null };
    }
    return { data: null, error: null };
  }
  function builder(table) {
    const state = { table, op: 'select' };
    const b = {
      select(_cols, _opts) { state.op = 'select'; return b; },
      eq(col, val) {
        if (table === 'motoristas') applied.motoristas.eq[col] = val;
        state.eqCol = col; state.eqVal = val; return b;
      },
      in(col, vals) {
        if (table === 'motoristas') applied.motoristas.in[col] = vals;
        return b;
      },
      maybeSingle() { return Promise.resolve(resolve(state)); },
      then(onF, onR) { return Promise.resolve(resolve(state)).then(onF, onR); },
    };
    return b;
  }
  return { supabase: { from: (t) => builder(t) }, applied };
}

test('avaliar: limite null → ok ilimitado, não conta', async () => {
  const { supabase } = makeSupabase({ empresa: { plano_id: 'pl', planos: { nome: 'Enterprise', limite_motoristas: null } } });
  const r = await avaliarLimiteMotoristas(supabase, 'emp1');
  assert.equal(r.ok, true);
  assert.equal(r.ilimitado, true);
  assert.equal(r.limite, null);
  assert.equal(r.planoAtual, 'Enterprise');
});

test('avaliar: totalAtual < limite → ok', async () => {
  const { supabase } = makeSupabase({
    empresa: { plano_id: 'pl', planos: { nome: 'Básico', limite_motoristas: 3 } },
    totalAtual: 2,
  });
  const r = await avaliarLimiteMotoristas(supabase, 'emp1');
  assert.equal(r.ok, true);
  assert.equal(r.ilimitado, false);
  assert.equal(r.limite, 3);
  assert.equal(r.totalAtual, 2);
});

test('avaliar: totalAtual >= limite → bloqueia com payload correto', async () => {
  const { supabase } = makeSupabase({
    empresa: { plano_id: 'pl', planos: { nome: 'Básico', limite_motoristas: 3 } },
    totalAtual: 3,
  });
  const r = await avaliarLimiteMotoristas(supabase, 'emp1');
  assert.equal(r.ok, false);
  assert.equal(r.limite, 3);
  assert.equal(r.totalAtual, 3);
  const erro = montarErroLimiteMotoristas(r);
  assert.equal(erro.limiteMotoristasAtingido, true);
  assert.equal(erro.limite, 3);
  assert.equal(erro.totalAtual, 3);
  assert.equal(erro.planoAtual, 'Básico');
  assert.ok(typeof erro.message === 'string' && erro.message.length > 0);
});

test('avaliar: autônomo limite=1 com a vaga ocupada → bloqueia 2º', async () => {
  const { supabase } = makeSupabase({
    empresa: { plano_id: 'pl', planos: { nome: 'Autônomo', limite_motoristas: 1 } },
    totalAtual: 1,
  });
  const r = await avaliarLimiteMotoristas(supabase, 'empAuto');
  assert.equal(r.ok, false);
  assert.equal(r.limite, 1);
  assert.equal(r.totalAtual, 1);
});

test('contagem: aplica os filtros de decisão (ativo + tipo motorista + status_cadastro pendente/aprovado)', async () => {
  const { supabase, applied } = makeSupabase({ totalAtual: 5 });
  const total = await contarMotoristasUtilizaveis(supabase, 'emp1');
  assert.equal(total, 5);
  assert.equal(applied.motoristas.eq['usuarios.empresa_id'], 'emp1');
  assert.equal(applied.motoristas.eq['usuarios.tipo'], 'motorista');
  assert.equal(applied.motoristas.eq['usuarios.status'], 'ativo'); // bloqueado excluído
  assert.deepEqual(applied.motoristas.in['status_cadastro'], ['pendente', 'aprovado']); // pendente conta
});

test('decisão exportada: status utilizáveis = pendente + aprovado (sem bloqueado)', () => {
  assert.deepEqual(STATUS_CADASTRO_UTILIZAVEL, ['pendente', 'aprovado']);
  assert.equal(STATUS_CADASTRO_UTILIZAVEL.includes('bloqueado'), false);
});

test('avaliar: empresa sem plano → seguro (ilimitado), sem erro opaco', async () => {
  const { supabase } = makeSupabase({ empresa: { plano_id: null, planos: null } });
  const r = await avaliarLimiteMotoristas(supabase, 'empSemPlano');
  assert.equal(r.ok, true);
  assert.equal(r.ilimitado, true);
});

test('avaliar: empresa inexistente → seguro (ilimitado), sem quebrar', async () => {
  const { supabase } = makeSupabase({ empresa: null });
  const r = await avaliarLimiteMotoristas(supabase, 'naoexiste');
  assert.equal(r.ok, true);
  assert.equal(r.ilimitado, true);
});

test('ehErroTriggerLimiteMotoristas: reconhece a mensagem do trigger legado', () => {
  assert.equal(ehErroTriggerLimiteMotoristas({ message: 'Limite de motoristas do plano atingido (3)' }), true);
  assert.equal(ehErroTriggerLimiteMotoristas({ message: 'duplicate key value violates unique constraint' }), false);
  assert.equal(ehErroTriggerLimiteMotoristas(null), false);
});

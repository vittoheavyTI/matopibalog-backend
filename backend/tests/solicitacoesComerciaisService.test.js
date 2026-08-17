const test = require('node:test');
const assert = require('node:assert/strict');

const {
  solicitarAddons, aprovarSolicitacao, recusarSolicitacao, ADDON_PADRAO_CENTAVOS,
} = require('../services/solicitacoesComerciaisService');

// Mock de supabase encadeável, guiado por cenário. Registra inserts/updates.
function makeSupabase(cenario) {
  const capt = { inserts: [], updates: [], auditoria: [] };
  function builder(tabela) {
    const state = { tabela, filtros: [], inFiltro: null };
    const api = {
      select() { return api; },
      eq(campo, valor) { state.filtros.push([campo, valor]); return api; },
      in(campo, vals) { state.inFiltro = [campo, vals]; return api; },
      order() { return api; },
      maybeSingle: async () => {
        if (tabela === 'empresa_funcionalidades' && cenario.alvo) return { data: cenario.alvo, error: null };
        return { data: null, error: null };
      },
      insert: async (row) => {
        if (tabela === 'funcionalidade_auditoria') capt.auditoria.push(row);
        else capt.inserts.push({ tabela, row });
        return { data: null, error: null };
      },
      update(row) {
        const upd = { tabela, row, filtros: state.filtros };
        capt.updates.push(upd);
        return { eq() { return this; }, then: undefined,
          // update().eq().eq() → precisa resolver como promise ao final
        };
      },
      then: undefined,
    };
    // Respostas para selects que terminam sem maybeSingle (retornam { data })
    if (tabela === 'funcionalidades') {
      api.in = () => ({ then: (res) => res({ data: cenario.funcs || [], error: null }) });
    }
    if (tabela === 'empresa_funcionalidades') {
      const origIn = api.in;
      api.in = (campo, vals) => {
        state.inFiltro = [campo, vals];
        // select().eq().in(status) → existentes
        return { then: (res) => res({ data: cenario.existentes || [], error: null }) };
      };
      void origIn;
    }
    return api;
  }
  // update precisa ser awaitable após .eq().eq(); reescreve update para resolver.
  const supa = { from: (t) => builder(t), _capt: capt };
  return supa;
}

// update().eq().eq() resolve — mock: sobrescreve para promise
function makeSupabaseUpd(cenario) {
  const capt = { updates: [], auditoria: [] };
  return {
    _capt: capt,
    from(tabela) {
      if (tabela === 'funcionalidade_auditoria') {
        return { insert: async (row) => { capt.auditoria.push(row); return { error: null }; } };
      }
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: cenario.alvo || null, error: null }),
        update(row) {
          const chain = { _row: row };
          const ret = {
            eq() { return ret; },
            then(resolve) { capt.updates.push(row); resolve({ error: null }); },
          };
          void chain;
          return ret;
        },
      };
    },
  };
}

test('solicitarAddons cria pendente para novos e é idempotente para existentes', async () => {
  const funcs = [
    { id: 'f-estrutura', codigo: 'estrutura_operacional', nome: 'Estrutura', status_ciclo_vida: 'disponivel' },
    { id: 'f-erp', codigo: 'integracoes_erp', nome: 'ERP', status_ciclo_vida: 'em_breve' },
  ];
  const supa = makeSupabase({ funcs, existentes: [{ funcionalidade_id: 'f-erp', status: 'ativa' }] });
  const r = await solicitarAddons({ supabase: supa, empresaId: 'e1', usuarioId: 'u1', codigos: ['estrutura_operacional', 'integracoes_erp'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.solicitados, ['estrutura_operacional']); // erp já existia (ativa)
  assert.deepEqual(r.body.ja_existiam, ['integracoes_erp']);
  // A linha criada é pendente, origem adicional, R$149,90, sem billing_component_id.
  const ins = supa._capt.inserts.find((i) => i.tabela === 'empresa_funcionalidades');
  assert.equal(ins.row.status, 'pendente');
  assert.equal(ins.row.origem, 'adicional');
  assert.equal(ins.row.preco_mensal_centavos, ADDON_PADRAO_CENTAVOS);
  assert.equal(ins.row.billing_component_id, null);
});

test('solicitarAddons rejeita códigos inválidos/vazios', async () => {
  const supa = makeSupabase({ funcs: [], existentes: [] });
  const r = await solicitarAddons({ supabase: supa, empresaId: 'e1', codigos: ['xyz'] });
  assert.equal(r.status, 400);
});

test('aprovar: pendente → ativa (CAS por status) + auditoria', async () => {
  const supa = makeSupabaseUpd({ alvo: { id: 's1', empresa_id: 'e1', funcionalidade_id: 'f-estrutura', status: 'pendente', preco_mensal_centavos: 14990 } });
  const r = await aprovarSolicitacao({ supabase: supa, id: 's1', aprovadorId: 'super' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ativa');
  assert.equal(supa._capt.updates[0].status, 'ativa');
  assert.equal(supa._capt.updates[0].aprovado_por, 'super');
  assert.equal(supa._capt.auditoria[0].acao, 'ativar');
});

test('aprovar: solicitação não-pendente → 409', async () => {
  const supa = makeSupabaseUpd({ alvo: { id: 's1', status: 'ativa' } });
  const r = await aprovarSolicitacao({ supabase: supa, id: 's1', aprovadorId: 'super' });
  assert.equal(r.status, 409);
});

test('recusar: pendente → inativa + auditoria desativar', async () => {
  const supa = makeSupabaseUpd({ alvo: { id: 's1', empresa_id: 'e1', funcionalidade_id: 'f-erp', status: 'pendente' } });
  const r = await recusarSolicitacao({ supabase: supa, id: 's1', aprovadorId: 'super', motivo: 'sem interesse' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'inativa');
  assert.equal(supa._capt.updates[0].status, 'inativa');
  assert.equal(supa._capt.auditoria[0].acao, 'desativar');
});

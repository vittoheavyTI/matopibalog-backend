const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Testa dashboardController.getSummary na regra oficial (decisão A), travando o
// refactor que passou a usar utils/agregacaoFinanceiraFretes:
//   * total_fretes soma SÓ fretes finalizados (ativo/pendente/cancelado fora);
//   * deduções vinculadas a fretes CANCELADOS não entram (regressão Q4 / R$5.512).
// Mock de supabase via Module._load; identifica cada query por tabela + filtros.

const controllerPath = require.resolve('../controllers/dashboardController');

const criarController = (dados) => {
  const builder = (tabela) => {
    const st = { tabela, eqs: {}, sel: '' };
    const b = {
      select(s) { st.sel = String(s || ''); return b; },
      eq(f, v) { st.eqs[f] = v; return b; },
      in() { return b; },
      gte() { return b; },
      lte() { return b; },
      order() { return b; },
      // usuarios pré-Promise resolve por await direto (thenable).
      then(resolve) { return resolve(resolver(st, dados)); },
    };
    return b;
  };
  const supabaseMock = { from(tabela) { return builder(tabela); } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
};

// Decide o retorno de cada query pelo estado capturado.
function resolver(st, dados) {
  const ok = (data) => ({ data, error: null });
  if (st.tabela === 'usuarios') return ok(dados.motoristasIds.map((id) => ({ id })));
  if (st.tabela === 'motoristas') return ok(dados.motoristasTipo);
  if (st.tabela === 'fretes') {
    if (st.eqs.status === 'finalizado') return ok(dados.fretesFinalizados);
    if (st.eqs.status === 'cancelado') return ok(dados.fretesCancelados);
    return ok([]);
  }
  if (st.tabela === 'despesas') {
    return ok(st.eqs.quem_pagou === 'proprietario' ? dados.despesasOwner : []);
  }
  if (st.tabela === 'abastecimentos') {
    if (st.eqs.quem_pagou === 'proprietario') return ok(dados.abastOwner);
    return ok([]); // consulta de litros (sem quem_pagou) e a de motorista
  }
  if (st.tabela === 'vales') {
    return ok(st.eqs.quem_pagou === 'proprietario' ? dados.valesOwner : []);
  }
  return ok([]);
}

const executar = async (dados) => {
  const controller = criarController(dados);
  let resposta = null;
  await controller.getSummary(
    { query: { mes: '7', ano: '2026' }, user: { role: 'admin', is_super_admin: false }, empresa_id: 'e-1' },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } },
  );
  return resposta;
};

const freteFinalizado = (over) => ({
  motorista_id: 'm-1', valor_frete: 1000, km_inicial: null, km_final: null,
  origem: 'A', destino: 'B', placa: 'ABC1D23',
  motoristas: { usuarios: { nome: 'Mot' }, percentual_comissao: 0 }, ...over,
});

test('total_fretes soma só finalizados; ativo/cancelado ficam fora', async () => {
  const resposta = await executar({
    motoristasIds: ['m-1'],
    motoristasTipo: [{ id: 'm-1', empresas: { tipo: 'transportadora' } }],
    // A query de fretes finalizados JÁ filtra no banco (status='finalizado'); o mock
    // devolve só finalizados aqui. O valor ativo (234,56) e o cancelado (37,8M) não
    // chegam a esta lista — exatamente o que a regra garante.
    fretesFinalizados: [freteFinalizado({ valor_frete: 1000 })],
    fretesCancelados: [{ id: 'c1' }],
    despesasOwner: [],
    abastOwner: [],
    valesOwner: [],
  });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.total_fretes, 1000);
});

test('regressão Q4: dedução vinculada a frete CANCELADO não entra em total_deducoes', async () => {
  const resposta = await executar({
    motoristasIds: ['m-1'],
    motoristasTipo: [{ id: 'm-1', empresas: { tipo: 'transportadora' } }],
    fretesFinalizados: [freteFinalizado({ valor_frete: 1000 })],
    fretesCancelados: [{ id: 'c1' }],
    despesasOwner: [
      { valor: 5212, motorista_id: 'm-1', frete_id: 'c1' },          // vinculada a cancelado → FORA
      { valor: 80, motorista_id: 'm-1', frete_id: 'f-final' },       // válida → entra
      { valor: 20, motorista_id: 'm-1', frete_id: null },            // solta → entra
    ],
    abastOwner: [],
    valesOwner: [],
  });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.total_fretes, 1000);
  // 80 + 20 = 100; os 5.212 vinculados ao frete cancelado NÃO vazam.
  assert.equal(resposta.body.total_deducoes, 100);
});

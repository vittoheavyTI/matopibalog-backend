const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Testa o status guard de relatoriosController.getFichaViagem (regra oficial —
// decisão A): frete CANCELADO na seleção → 422 e NADA é somado. Frete finalizado
// segue funcionando. Reaproveita o mock de supabase via Module._load.

const controllerPath = require.resolve('../controllers/relatoriosController');

// `fretes` = linhas retornadas pela query de fretes. `lancamentos` = arrays por tabela.
const criarController = ({ fretes, motorista, despesas = [], abastecimentos = [], vales = [] }) => {
  const builder = (tabela) => {
    const b = {
      _tabela: tabela,
      select() { return b; },
      in() { return b; },
      eq() { return b; },
      async single() {
        if (tabela === 'motoristas') return { data: motorista, error: null };
        if (tabela === 'usuarios') return { data: { id: 'm-1' }, error: null };
        return { data: null, error: null };
      },
      // Thenable: as queries de fretes/lançamentos são aguardadas direto (sem .single()).
      then(resolve) {
        if (tabela === 'fretes') return resolve({ data: fretes, error: null });
        if (tabela === 'abastecimentos') return resolve({ data: abastecimentos, error: null });
        if (tabela === 'despesas') return resolve({ data: despesas, error: null });
        if (tabela === 'vales') return resolve({ data: vales, error: null });
        return resolve({ data: [], error: null });
      },
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

const executar = async (cfg, query) => {
  const controller = criarController(cfg);
  let resposta = null;
  // super-admin → pula a checagem de ownership (usuarios).
  await controller.getFichaViagem(
    { query, user: { is_super_admin: true, uid: 'sa-1' } },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } },
  );
  return resposta;
};

const motorista = {
  id: 'm-1', placa_veiculo: 'ABC1D23', percentual_comissao: 12,
  usuarios: { nome: 'Motorista Teste' }, empresas: { tipo: 'transportadora' },
};

test('ficha com frete CANCELADO na seleção → 422 e não soma nada', async () => {
  const resposta = await executar(
    {
      fretes: [
        { id: 'f-ok', status: 'finalizado', valor_frete: 1000, motorista_id: 'm-1' },
        { id: 'f-cancel', status: 'cancelado', valor_frete: 37800000, motorista_id: 'm-1' },
      ],
      motorista,
      despesas: [{ frete_id: 'f-cancel', valor: 5000, quem_pagou: 'proprietario' }],
    },
    { motorista_id: 'm-1', fretes_ids: 'f-ok,f-cancel' },
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /frete cancelado/i);
  assert.equal(resposta.body.resumo, undefined, 'não deve devolver consolidado financeiro');
});

test('ficha só com fretes FINALIZADOS → 200 e soma correta', async () => {
  const resposta = await executar(
    {
      fretes: [
        { id: 'f1', status: 'finalizado', valor_frete: 6500, motorista_id: 'm-1' },
        { id: 'f2', status: 'finalizado', valor_frete: 3500, motorista_id: 'm-1' },
      ],
      motorista,
      despesas: [{ frete_id: 'f1', valor: 200, quem_pagou: 'proprietario' }],
      abastecimentos: [{ frete_id: 'f1', valor_total: 300, quem_pagou: 'proprietario' }],
      vales: [{ frete_id: 'f2', valor: 100, quem_pagou: 'motorista' }], // motorista → não é dedução
    },
    { motorista_id: 'm-1', fretes_ids: 'f1,f2' },
  );
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.resumo.frete_bruto, 10000);
  // deduções = só proprietário (200 + 300); vale do motorista (100) não entra.
  assert.equal(resposta.body.resumo.deducoes, 500);
});

test('ficha com frete ATIVO na seleção → permitido (não é receita realizada, mas ficha por seleção)', async () => {
  const resposta = await executar(
    {
      fretes: [{ id: 'fa', status: 'ativo', valor_frete: 234.56, motorista_id: 'm-1' }],
      motorista,
    },
    { motorista_id: 'm-1', fretes_ids: 'fa' },
  );
  // Guard só barra CANCELADO. Ativo passa (a regra de receita realizada é do dashboard).
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.resumo.frete_bruto, 234.56);
});

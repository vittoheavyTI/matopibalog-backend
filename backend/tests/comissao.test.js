const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { calcularComissao, deveComissionar } = require('../utils/comissao');

// ─── Regra pura de comissão ───────────────────────────────────────────────────

test('autônomo com percentual_comissao=12 → comissão 0', () => {
  assert.equal(calcularComissao(1000, 12, 'autonomo'), 0);
});

test('vinculado (transportadora) com percentual_comissao=12 → comissão normal', () => {
  assert.equal(calcularComissao(1000, 12, 'transportadora'), 120);
});

test('tipo desconhecido/null/undefined/vazio → comissão 0 (nunca assume 12%)', () => {
  assert.equal(calcularComissao(1000, 12, null), 0);
  assert.equal(calcularComissao(1000, 12, undefined), 0);
  assert.equal(calcularComissao(1000, 12, ''), 0);
  assert.equal(calcularComissao(1000, 12, '   '), 0);
});

test('valores não numéricos → comissão 0 (sem NaN no contrato)', () => {
  assert.equal(calcularComissao('abc', 12, 'transportadora'), 0);
  assert.equal(calcularComissao(1000, 'xx', 'transportadora'), 0);
  assert.equal(calcularComissao(undefined, undefined, 'transportadora'), 0);
});

test('vinculado com percentual 0 → comissão 0 (respeita percentual cadastrado)', () => {
  assert.equal(calcularComissao(1000, 0, 'transportadora'), 0);
});

test('deveComissionar: só vinculado com tipo conhecido', () => {
  assert.equal(deveComissionar('transportadora'), true);
  assert.equal(deveComissionar('autonomo'), false);
  assert.equal(deveComissionar(null), false);
  assert.equal(deveComissionar(''), false);
});

// ─── Integração: fretesController.create zera comissao_calculada p/ autônomo ───
// Reaproveita o padrão de mock de fretesDataFilter.test.js (Module._load) para
// injetar um supabase falso sem tocar em banco/env. utils/comissao é carregado
// de verdade (a regra sob teste).

const controllerPath = require.resolve('../controllers/fretesController');

const criarControllerCreate = (tipoEmpresa) => {
  const builder = () => {
    const ctx = { insertPayload: null };
    return {
      select() { return this; },
      insert(payload) { ctx.insertPayload = payload; return this; },
      eq() { return this; },
      async single() {
        // Chamada de INSERT (fretes): devolve o registro criado
        if (ctx.insertPayload !== null) {
          return { data: { id: 'frete-1', ...ctx.insertPayload }, error: null };
        }
        // Chamadas de leitura, roteadas pelo nome da tabela
        if (ctx.tabela === 'usuarios') {
          return { data: { status: 'ativo' }, error: null };
        }
        if (ctx.tabela === 'motoristas') {
          return { data: { placa_veiculo: 'ABC1D23', percentual_comissao: 12, empresa_id: 'empresa-1' }, error: null };
        }
        if (ctx.tabela === 'empresas') {
          return { data: { tipo: tipoEmpresa }, error: null };
        }
        return { data: null, error: null };
      },
      _setTabela(t) { ctx.tabela = t; return this; }
    };
  };

  const supabaseMock = { from(tabela) { return builder()._setTabela(tabela); } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
};

const executarCreate = async (tipoEmpresa) => {
  const controller = criarControllerCreate(tipoEmpresa);
  let resposta = null;
  await controller.create(
    {
      body: { origem: 'A', destino: 'B', valor_frete: 1000 },
      user: { role: 'motorista', uid: 'motorista-1', is_super_admin: false }
    },
    {
      status(status) {
        return { json(body) { resposta = { status, body }; } };
      }
    }
  );
  return resposta;
};

test('create: autônomo → comissao_calculada 0 mesmo com percentual 12', async () => {
  const resp = await executarCreate('autonomo');
  assert.equal(resp.status, 201);
  assert.equal(resp.body.comissao_calculada, 0);
});

test('create: vinculado (transportadora) → comissao_calculada = 120', async () => {
  const resp = await executarCreate('transportadora');
  assert.equal(resp.status, 201);
  assert.equal(resp.body.comissao_calculada, 120);
});

test('create: tipo de empresa desconhecido → comissao_calculada 0', async () => {
  const resp = await executarCreate(null);
  assert.equal(resp.status, 201);
  assert.equal(resp.body.comissao_calculada, 0);
});

// NOTA: "frete cancelado fora do cálculo" e "gastos pendentes/rejeitados fora do
// resultado" são garantidos pelos filtros já existentes do dashboardController
// (naoCancelado + status IN ['aprovado','finalizado']), inalterados por este PR e
// cobertos pela regressão do PR #232 — não re-testados aqui para evitar mock pesado.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/planos');

// Linhas de exemplo cobrindo as tres categorias + um inativo.
// 'Plano Ambos' e por_motorista (100,00 x 10 = 1.000,00) para cobrir a composicao.
const ROWS = [
  { id: '1', nome: 'Plano Básico', preco_mensal: 149.9, ativo: true, categoria: 'empresa', recursos: [], modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 1 },
  { id: '2', nome: 'Plano Básico Autônomo', preco_mensal: 149.99, ativo: true, categoria: 'autonomo', recursos: [], modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 1 },
  { id: '3', nome: 'Free Teste', preco_mensal: 0, ativo: false, categoria: 'ambos', recursos: [], modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 2 },
  { id: '4', nome: 'Plano Ambos', preco_mensal: 1000, ativo: true, categoria: 'ambos', recursos: [], modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 10 },
];

// Mock do supabase: filtra ativo=true sempre; aplica o filtro de categoria
// quando o endpoint chama .in('categoria', [...]).
function supabaseMock(rows) {
  const state = { categorias: null };
  const chain = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    in(_col, vals) { state.categorias = vals; return this; },
    then(resolve) {
      let data = rows.filter((r) => r.ativo === true);
      if (state.categorias) {
        data = data.filter((r) => state.categorias.includes(r.categoria));
      }
      resolve({ data, error: null });
    },
  };
  return { from() { return chain; } };
}

function carregarRouter(rows) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock(rows);
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routerPath];
  }
}

function getHandler(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method.toLowerCase()]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`Handler nao encontrado: ${method} ${path}`);
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function chamar(query) {
  const router = carregarRouter(ROWS);
  const handler = getHandler(router, 'get', '/publicos');
  const res = fakeRes();
  await handler({ query: query || {} }, res);
  return res;
}

test('planos/publicos?categoria=autonomo retorna apenas autonomo e ambos (ativos)', async () => {
  const res = await chamar({ categoria: 'autonomo' });
  assert.equal(res.statusCode, 200);
  const nomes = res.body.planos.map((p) => p.nome);
  assert.deepEqual(nomes.sort(), ['Plano Ambos', 'Plano Básico Autônomo'].sort());
  // nao vaza plano de empresa nem inativo
  assert.ok(!nomes.includes('Plano Básico'));
  assert.ok(!nomes.includes('Free Teste'));
});

test('planos/publicos?categoria=empresa retorna apenas empresa e ambos (ativos)', async () => {
  const res = await chamar({ categoria: 'empresa' });
  const nomes = res.body.planos.map((p) => p.nome).sort();
  assert.deepEqual(nomes, ['Plano Ambos', 'Plano Básico'].sort());
});

test('planos/publicos sem categoria mantem comportamento atual (todos os ativos)', async () => {
  const res = await chamar({});
  const nomes = res.body.planos.map((p) => p.nome).sort();
  assert.deepEqual(nomes, ['Plano Ambos', 'Plano Básico', 'Plano Básico Autônomo'].sort());
  assert.ok(!nomes.includes('Free Teste'));
});

test('planos/publicos expoe o campo categoria', async () => {
  const res = await chamar({ categoria: 'autonomo' });
  assert.ok(res.body.planos.every((p) => ['autonomo', 'ambos'].includes(p.categoria)));
});

// ─── Frente #4 (PR 5): composicao do preco na vitrine ────────────────────────

test('planos/publicos expoe modelo_cobranca e preco_por_motorista', async () => {
  const res = await chamar({ categoria: 'empresa' });
  const porMotorista = res.body.planos.find((p) => p.nome === 'Plano Ambos');
  assert.equal(porMotorista.modelo_cobranca, 'por_motorista');
  assert.equal(porMotorista.preco_por_motorista, 100);
  assert.equal(porMotorista.limite_motoristas, 10);
  // O headline continua sendo o VALOR FINAL, nao o unitario.
  assert.equal(porMotorista.preco_mensal, 1000);
});

test('plano fixo vem com modelo_cobranca=fixo e unitario nulo', async () => {
  const res = await chamar({ categoria: 'empresa' });
  const fixo = res.body.planos.find((p) => p.nome === 'Plano Básico');
  assert.equal(fixo.modelo_cobranca, 'fixo');
  assert.equal(fixo.preco_por_motorista, null);
  assert.equal(fixo.preco_mensal, 149.9);
});

test('modelo_cobranca ausente ou desconhecido resolve como fixo', async () => {
  const rows = [
    { id: '9', nome: 'Sem Modelo', preco_mensal: 50, ativo: true, categoria: 'empresa', recursos: [] },
    { id: '10', nome: 'Modelo Estranho', preco_mensal: 50, ativo: true, categoria: 'empresa', recursos: [], modelo_cobranca: 'xyz' },
  ];
  const router = carregarRouter(rows);
  const handler = getHandler(router, 'get', '/publicos');
  const res = fakeRes();
  await handler({ query: {} }, res);
  assert.ok(res.body.planos.every((p) => p.modelo_cobranca === 'fixo'));
});

test('a whitelist nao vaza campo alem do previsto', async () => {
  // SELECT explicito, nunca *. Se alguem adicionar coluna sensivel em `planos`,
  // ela nao pode aparecer no catalogo publico sem passar por aqui.
  const permitidos = [
    'id', 'nome', 'descricao', 'preco_mensal', 'modelo_cobranca',
    'preco_por_motorista', 'limite_motoristas', 'dias_trial', 'recursos',
    'ativo', 'categoria',
    // Campos comerciais (mega-frente) — expostos de propósito à vitrine/cadastro.
    'capacidade_inclusa', 'preco_motorista_extra', 'valor_implantacao', 'requer_negociacao',
  ].sort();
  const res = await chamar({});
  for (const plano of res.body.planos) {
    assert.deepEqual(Object.keys(plano).sort(), permitidos, `plano ${plano.nome} expos campos inesperados`);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../services/notificacaoService');

// Carrega o notificacaoService com um supabase mockado. O mock registra as
// chamadas feitas na query de `usuarios` (para conferir os filtros) e acumula
// os inserts feitos em `notificacoes` (para conferir o fan-out).
const carregarService = (usuariosData) => {
  const usuariosQuery = {
    calls: [],
    select() { return this; },
    eq(...args) { this.calls.push(['eq', ...args]); return this; },
    neq(...args) { this.calls.push(['neq', ...args]); return this; },
    // Torna a query "awaitable": `await query` resolve com {data, error}.
    then(resolve) { resolve({ data: usuariosData, error: null }); },
  };

  const inserts = [];
  const notificacoesMock = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    insert(payload) { inserts.push(payload); return this; },
    single() { return Promise.resolve({ data: { id: `notif-${inserts.length}` }, error: null }); },
  };

  const supabaseMock = {
    from(tabela) {
      return tabela === 'usuarios' ? usuariosQuery : notificacoesMock;
    },
  };

  const originalLoad = Module._load;
  delete require.cache[servicePath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return { service: require(servicePath), usuariosQuery, inserts };
  } finally {
    Module._load = originalLoad;
  }
};

const dadosBase = { tipo: 'frete_criado', titulo: 'Novo frete', mensagem: 'msg', dedupe_key: 'k' };

test('criarParaEmpresa filtra admins ativos e exclui o autor da acao', async () => {
  const { service, usuariosQuery, inserts } = carregarService([{ id: 'admin-2' }, { id: 'admin-3' }]);

  const resultado = await service.criarParaEmpresa('empresa-1', dadosBase, {
    somenteAdmins: true,
    excluir_usuario_id: 'admin-1',
  });

  const chamada = (metodo, ...args) =>
    usuariosQuery.calls.some(([nome, ...rest]) =>
      nome === metodo && rest.join('|') === args.join('|'));

  assert.ok(chamada('eq', 'empresa_id', 'empresa-1'), 'deve filtrar por empresa_id');
  assert.ok(chamada('eq', 'status', 'ativo'), 'deve filtrar por status ativo');
  assert.ok(chamada('eq', 'tipo', 'admin'), 'somenteAdmins deve filtrar tipo admin');
  assert.ok(chamada('neq', 'id', 'admin-1'), 'deve excluir o autor da acao');

  // Fan-out: uma notificacao por usuario retornado.
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((i) => i.usuario_id).sort(), ['admin-2', 'admin-3']);
  assert.equal(resultado.length, 2);
});

test('criarParaEmpresa sem excluir_usuario_id nao aplica neq', async () => {
  const { service, usuariosQuery } = carregarService([{ id: 'admin-1' }]);

  await service.criarParaEmpresa('empresa-1', dadosBase, { somenteAdmins: true });

  const usouNeq = usuariosQuery.calls.some(([nome]) => nome === 'neq');
  assert.equal(usouNeq, false);
});

test('criarParaEmpresa retorna [] quando empresa_id ausente', async () => {
  const { service, inserts } = carregarService([]);
  const resultado = await service.criarParaEmpresa(null, dadosBase, { somenteAdmins: true });
  assert.deepEqual(resultado, []);
  assert.equal(inserts.length, 0);
});

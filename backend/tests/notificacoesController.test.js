const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/notificacoesController');

function criarController({
  admins = [],
  notificacoes = [],
  count = 0,
  patchData = { id: 'n-1', lida: true, read_at: '2026-07-14T00:00:00.000Z' },
} = {}) {
  const chamadas = [];

  const criarQuery = (tabela) => ({
    select(...args) { chamadas.push([tabela, 'select', ...args]); return this; },
    eq(...args) { chamadas.push([tabela, 'eq', ...args]); return this; },
    in(...args) { chamadas.push([tabela, 'in', ...args]); return this; },
    order(...args) { chamadas.push([tabela, 'order', ...args]); return this; },
    limit(...args) { chamadas.push([tabela, 'limit', ...args]); return this; },
    update(...args) { chamadas.push([tabela, 'update', ...args]); return this; },
    maybeSingle() {
      chamadas.push([tabela, 'maybeSingle']);
      return Promise.resolve({ data: patchData, error: null });
    },
    then(resolve) {
      if (tabela === 'usuarios') {
        resolve({ data: admins, error: null });
        return;
      }
      resolve({ data: notificacoes, count, error: null });
    },
  });

  const supabaseMock = {
    from(tabela) {
      chamadas.push([tabela, 'from']);
      return criarQuery(tabela);
    },
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), chamadas };
  } finally {
    Module._load = originalLoad;
  }
}

function criarRes() {
  const resposta = {};
  return {
    resposta,
    res: {
      status(status) {
        resposta.status = status;
        return {
          json(body) {
            resposta.body = body;
          },
        };
      },
    },
  };
}

const temChamada = (chamadas, tabela, metodo, ...args) =>
  chamadas.some(([t, m, ...rest]) =>
    t === tabela && m === metodo && JSON.stringify(rest) === JSON.stringify(args));

test('getAll: admin comum continua filtrando por usuario_id', async () => {
  const { controller, chamadas } = criarController({ notificacoes: [{ id: 'n-admin' }] });
  const { res, resposta } = criarRes();

  await controller.getAll({
    query: { limite: '20' },
    user: { uid: 'admin-1', role: 'admin', is_super_admin: false },
    empresa_id: 'empresa-1',
  }, res);

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, [{ id: 'n-admin' }]);
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'usuario_id', 'admin-1'));
  assert.equal(chamadas.some(([t]) => t === 'usuarios'), false);
});

test('contarNaoLidas: motorista continua filtrando por usuario_id', async () => {
  const { controller, chamadas } = criarController({ count: 3 });
  const { res, resposta } = criarRes();

  await controller.contarNaoLidas({
    query: {},
    user: { uid: 'mot-1', role: 'motorista', is_super_admin: false },
    empresa_id: 'empresa-1',
  }, res);

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { count: 3 });
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'usuario_id', 'mot-1'));
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'lida', false));
});

test('getAll: super-admin sem impersonacao nao abre feed global', async () => {
  const { controller, chamadas } = criarController({ notificacoes: [{ id: 'n-sa' }] });
  const { res, resposta } = criarRes();

  await controller.getAll({
    query: { limite: '50' },
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: null,
    impersonating: false,
  }, res);

  assert.equal(resposta.status, 200);
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'usuario_id', 'super-1'));
  assert.equal(chamadas.some(([t]) => t === 'usuarios'), false);
});

test('getAll: super-admin impersonado ve apenas notificacoes dos admins ativos da empresa', async () => {
  const { controller, chamadas } = criarController({
    admins: [{ id: 'admin-1' }, { id: 'admin-2' }],
    notificacoes: [{ id: 'n-empresa' }],
  });
  const { res, resposta } = criarRes();

  await controller.getAll({
    query: { empresa_id: 'empresa-1', lida: 'false' },
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: 'empresa-1',
    impersonating: true,
  }, res);

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, [{ id: 'n-empresa' }]);
  assert.ok(temChamada(chamadas, 'usuarios', 'eq', 'empresa_id', 'empresa-1'));
  assert.ok(temChamada(chamadas, 'usuarios', 'eq', 'tipo', 'admin'));
  assert.ok(temChamada(chamadas, 'usuarios', 'eq', 'status', 'ativo'));
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'empresa_id', 'empresa-1'));
  assert.ok(temChamada(chamadas, 'notificacoes', 'in', 'usuario_id', ['admin-1', 'admin-2']));
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'lida', false));
});

test('contarNaoLidas: super-admin impersonado conta apenas admins ativos da empresa', async () => {
  const { controller, chamadas } = criarController({
    admins: [{ id: 'admin-1' }],
    count: 7,
  });
  const { res, resposta } = criarRes();

  await controller.contarNaoLidas({
    query: { empresa_id: 'empresa-1' },
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: 'empresa-1',
    impersonating: true,
  }, res);

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { count: 7 });
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'empresa_id', 'empresa-1'));
  assert.ok(temChamada(chamadas, 'notificacoes', 'in', 'usuario_id', ['admin-1']));
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'lida', false));
});

test('empresa impersonada sem admins ativos retorna lista vazia e count zero', async () => {
  const { controller, chamadas } = criarController({ admins: [] });
  const lista = criarRes();
  const countRes = criarRes();

  const req = {
    query: { empresa_id: 'empresa-sem-admin' },
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: 'empresa-sem-admin',
    impersonating: true,
  };

  await controller.getAll(req, lista.res);
  await controller.contarNaoLidas(req, countRes.res);

  assert.deepEqual(lista.resposta.body, []);
  assert.deepEqual(countRes.resposta.body, { count: 0 });
  assert.equal(chamadas.some(([t]) => t === 'notificacoes'), false);
});

test('PATCHs continuam marcando somente notificacoes do usuario logado', async () => {
  const { controller, chamadas } = criarController();
  const uma = criarRes();
  const todas = criarRes();

  await controller.marcarLida({
    params: { id: 'n-1' },
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: 'empresa-1',
    impersonating: true,
  }, uma.res);

  await controller.marcarTodasLidas({
    user: { uid: 'super-1', role: 'admin', is_super_admin: true },
    empresa_id: 'empresa-1',
    impersonating: true,
  }, todas.res);

  assert.equal(uma.resposta.status, 200);
  assert.equal(todas.resposta.status, 200);
  assert.ok(temChamada(chamadas, 'notificacoes', 'eq', 'id', 'n-1'));
  const filtrosUsuario = chamadas.filter(([t, m, coluna, valor]) =>
    t === 'notificacoes' && m === 'eq' && coluna === 'usuario_id' && valor === 'super-1');
  assert.equal(filtrosUsuario.length, 2);
  assert.equal(chamadas.some(([t, m, coluna]) =>
    t === 'notificacoes' && (m === 'eq' || m === 'in') && coluna === 'empresa_id'), false);
});

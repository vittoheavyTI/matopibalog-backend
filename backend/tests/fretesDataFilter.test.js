const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/fretesController');

const criarController = () => {
  const chamadas = [];
  const query = {
    select() { return this; },
    in(...args) { chamadas.push(['in', ...args]); return this; },
    eq(...args) { chamadas.push(['eq', ...args]); return this; },
    gte(...args) { chamadas.push(['gte', ...args]); return this; },
    lt(...args) { chamadas.push(['lt', ...args]); return this; },
    async order(...args) {
      chamadas.push(['order', ...args]);
      return { data: [], error: null };
    }
  };
  const supabaseMock = { from() { return query; } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), chamadas };
  } finally {
    Module._load = originalLoad;
  }
};

const executarGetAll = async (filtros) => {
  const { controller, chamadas } = criarController();
  let resposta = null;

  await controller.getAll(
    {
      query: filtros,
      user: { role: 'motorista', uid: 'motorista-1', is_super_admin: false },
      empresa_id: 'empresa-1'
    },
    {
      status(status) {
        return {
          json(body) {
            resposta = { status, body };
          }
        };
      }
    }
  );

  assert.equal(resposta.status, 200);
  return chamadas;
};

const chamada = (chamadas, metodo) => chamadas.find(([nome]) => nome === metodo);

test('intervalo de junho usa início inclusivo e fim exclusivo no dia seguinte', async () => {
  const chamadas = await executarGetAll({
    data_inicio: '2026-06-01',
    data_fim: '2026-06-30'
  });

  assert.deepEqual(chamada(chamadas, 'gte'), ['gte', 'data', '2026-06-01']);
  assert.deepEqual(chamada(chamadas, 'lt'), ['lt', 'data', '2026-07-01']);
});

test('fim exclusivo trata fevereiro não bissexto', async () => {
  const chamadas = await executarGetAll({ data_fim: '2026-02-28' });
  assert.deepEqual(chamada(chamadas, 'lt'), ['lt', 'data', '2026-03-01']);
});

test('fim exclusivo trata fevereiro bissexto', async () => {
  const chamadas = await executarGetAll({ data_fim: '2024-02-29' });
  assert.deepEqual(chamada(chamadas, 'lt'), ['lt', 'data', '2024-03-01']);
});

test('datetime é preservado como limite final exclusivo', async () => {
  const dataFim = '2026-06-30T23:59:59.999Z';
  const chamadas = await executarGetAll({ data_fim: dataFim });
  assert.deepEqual(chamada(chamadas, 'lt'), ['lt', 'data', dataFim]);
});

test('sem data_fim não aplica filtro lt', async () => {
  const chamadas = await executarGetAll({ data_inicio: '2026-06-01' });
  assert.equal(chamada(chamadas, 'lt'), undefined);
});

test('sem data_inicio não aplica filtro gte', async () => {
  const chamadas = await executarGetAll({ data_fim: '2026-06-30' });
  assert.equal(chamada(chamadas, 'gte'), undefined);
});

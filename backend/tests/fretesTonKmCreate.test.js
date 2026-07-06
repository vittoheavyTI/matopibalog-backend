const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Testa o create do fretesController para a modalidade tonelada_km, reaproveitando
// o padrão de mock de comissao.test.js (Module._load injeta um supabase falso).
// Foco do hotfix: criar tonelada_km SEM km_final não pode gravar valor_frete null
// (coluna NOT NULL) — deve gravar 0 provisório; com ambos os KMs, calcula o valor.

const controllerPath = require.resolve('../controllers/fretesController');

const criarController = (tipoEmpresa) => {
  const capturado = { insertPayload: null };
  const builder = () => {
    const ctx = {};
    return {
      select() { return this; },
      insert(payload) { capturado.insertPayload = payload; ctx.insert = true; return this; },
      eq() { return this; },
      async single() {
        if (ctx.insert) return { data: { id: 'frete-1', ...capturado.insertPayload }, error: null };
        if (ctx.tabela === 'usuarios') return { data: { status: 'ativo' }, error: null };
        if (ctx.tabela === 'motoristas') return { data: { placa_veiculo: 'ABC1D23', percentual_comissao: 12, empresa_id: 'empresa-1' }, error: null };
        if (ctx.tabela === 'empresas') return { data: { tipo: tipoEmpresa }, error: null };
        return { data: null, error: null };
      },
      _setTabela(t) { ctx.tabela = t; return this; },
    };
  };
  const supabaseMock = { from(tabela) { return builder()._setTabela(tabela); } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return { notificarFreteCriado: async () => null };
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), capturado };
  } finally {
    Module._load = originalLoad;
  }
};

const executarCreate = async (body, tipoEmpresa = 'transportadora') => {
  const { controller, capturado } = criarController(tipoEmpresa);
  let resposta = null;
  await controller.create(
    { body, user: { role: 'admin', uid: 'admin-1', is_super_admin: false } },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } }
  );
  return { resposta, insertPayload: capturado.insertPayload };
};

test('create tonelada_km SEM km_final → valor_frete 0 provisório (nunca null)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 150, km_inicial: 1,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 0, 'valor_frete provisório deve ser 0, não null');
  assert.notEqual(insertPayload.valor_frete, null);
  assert.equal(insertPayload.modalidade_calculo, 'tonelada_km');
  assert.equal(insertPayload.toneladas, 50);
  assert.equal(insertPayload.valor_tonelada_km, 150);
});

test('create tonelada_km COM km_final → valor_frete calculado', async () => {
  // 50 t * (1500 - 1000 = 500 km) * 150 = 3.750.000
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 150, km_inicial: 1000, km_final: 1500,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 50 * 500 * 150);
});

test('create valor_fixo → valor_frete digitado é gravado (comportamento antigo intacto)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    valor_frete: 1000,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 1000);
  assert.equal(insertPayload.modalidade_calculo, 'valor_fixo');
  assert.equal(insertPayload.toneladas, null);
  assert.equal(insertPayload.valor_tonelada_km, null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/fretesController');

const freteTonKmLegado = (over = {}) => ({
  id: 'frete-legado-1',
  motorista_id: 'm-1',
  empresa_id: 'e-1',
  status: 'ativo',
  modalidade_calculo: 'tonelada_km',
  toneladas: 5,
  valor_tonelada_km: 245,
  valor_frete: 0,
  km_inicial: 1,
  km_final: null,
  foto_odometro_inicial_path: null,
  foto_odometro_final_path: null,
  ...over,
});

const criarController = (frete) => {
  const capt = { updatePayload: undefined };
  const builder = (tabela) => {
    const b = {
      _update: false,
      select() { return b; },
      eq() { return b; },
      update(payload) { capt.updatePayload = payload; b._update = true; return b; },
      async single() {
        if (tabela === 'fretes') {
          return b._update ? { data: { ...frete, ...capt.updatePayload }, error: null } : { data: frete, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve) { resolve({ count: 0, error: null }); },
    };
    return b;
  };
  const supabaseMock = { from(tabela) { return builder(tabela); } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), capt };
  } finally {
    Module._load = originalLoad;
  }
};

const executarUpdate = async (frete, body = {}) => {
  const { controller, capt } = criarController(frete);
  let resposta = null;
  await controller.update(
    { params: { id: frete.id }, body, user: { role: 'admin', uid: 'sa-1', is_super_admin: true } },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } },
  );
  return { resposta, capt };
};

test('PATCH parcial em legado tonelada_km >10 continua rejeitado sem persistir KM', async () => {
  const { resposta, capt } = await executarUpdate(freteTonKmLegado(), { km_final: 800 });
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_financial_correction_endpoint_required');
  assert.match(resposta.body.message, /correcao financeira auditada/i);
  assert.equal(capt.updatePayload, undefined, 'PATCH parcial nao pode gravar KM sobre legado invalido');
});

test('update explicito tonelada_km exige endpoint auditado', async () => {
  const { resposta, capt } = await executarUpdate(
    freteTonKmLegado({ valor_tonelada_km: 0.2 }),
    { valor_tonelada_km: 245 },
  );
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_financial_correction_endpoint_required');
  assert.equal(capt.updatePayload, undefined);
});

test('corrigir explicitamente legado pelo PATCH generico fica bloqueado para auditoria', async () => {
  const { resposta, capt } = await executarUpdate(
    freteTonKmLegado(),
    { valor_tonelada_km: 0.245, km_final: 800 },
  );
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_financial_correction_endpoint_required');
  assert.equal(capt.updatePayload, undefined);
});

test('depois de corrigido, PATCH de KM tambem exige correcao auditada', async () => {
  const { resposta, capt } = await executarUpdate(
    freteTonKmLegado({ valor_tonelada_km: 0.245 }),
    { km_final: 800 },
  );
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_financial_correction_endpoint_required');
  assert.equal(capt.updatePayload, undefined);
});

test('update nao financeiro nao sofre regressao', async () => {
  const { resposta, capt } = await executarUpdate(
    freteTonKmLegado({ modalidade_calculo: 'valor_fixo', toneladas: null, valor_tonelada_km: null, valor_frete: 100 }),
    { origem: 'Ajustada' },
  );
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.origem, 'Ajustada');
});

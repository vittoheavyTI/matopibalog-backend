const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Testa exports.update (PATCH /fretes/:id) do fretesController quanto à trava de
// foto do odômetro ao mudar status → 'finalizado'. Fecha o contorno em que uma
// finalização via PATCH ignorava a regra que exports.finalizar já aplica.
// Reaproveita o padrão de mock por Module._load (supabase falso, sem banco).

const controllerPath = require.resolve('../controllers/fretesController');

// frete: linha atual em fretes; capt.updatePayload recebe o update quando (e se) chamado.
const criarController = (frete) => {
  const capt = { updatePayload: undefined };
  const builder = (tabela) => {
    const b = {
      _tabela: tabela,
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
      // Thenable: só as checagens de pendência (despesas/abastecimentos/vales) fazem
      // await direto no builder. Sempre 0 pendências para chegar ao guard de foto.
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
      if (request === '../services/notificacaoService') return { notificarViagemFinalizada: async () => null };
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), capt };
  } finally {
    Module._load = originalLoad;
  }
};

const executarUpdate = async (frete, body) => {
  const { controller, capt } = criarController(frete);
  let resposta = null;
  await controller.update(
    { params: { id: frete.id }, body, empresa_id: frete.empresa_id, user: { role: 'admin', uid: 'sa-1', is_super_admin: true } },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } }
  );
  return { resposta, capt };
};

const freteBase = (over = {}) => ({
  id: 'frete-1', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo',
  km_inicial: 1000, km_final: 1500, modalidade_calculo: 'valor_fixo',
  toneladas: null, valor_tonelada_km: null,
  foto_odometro_inicial_path: null, foto_odometro_final_path: null,
  ...over,
});

test('update finalizado: novo fluxo com foto inicial SEM foto final → 422 e não altera status', async () => {
  const { resposta, capt } = await executarUpdate(
    freteBase({ foto_odometro_inicial_path: 'e-1/fretes/frete-1/odometro-inicial.jpg', foto_odometro_final_path: null }),
    { status: 'finalizado' }
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /foto do odômetro final/i);
  assert.equal(capt.updatePayload, undefined, 'não deve chamar update / não muda status');
});

test('update finalizado: pendente sem foto inicial → 422 e não altera status', async () => {
  const { resposta, capt } = await executarUpdate(
    freteBase({ status: 'pendente', foto_odometro_inicial_path: null }),
    { status: 'finalizado' }
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /foto do odômetro inicial/i);
  assert.equal(capt.updatePayload, undefined);
});

test('update finalizado: novo fluxo com foto inicial E final → finaliza (status persiste)', async () => {
  const { resposta, capt } = await executarUpdate(
    freteBase({
      foto_odometro_inicial_path: 'e-1/fretes/frete-1/odometro-inicial.jpg',
      foto_odometro_final_path: 'e-1/fretes/frete-1/odometro-final.jpg',
    }),
    { status: 'finalizado' }
  );
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
});

test('update finalizado: LEGADO sem foto inicial (valor_fixo) → finaliza (compatibilidade)', async () => {
  const { resposta, capt } = await executarUpdate(
    freteBase({ foto_odometro_inicial_path: null, foto_odometro_final_path: null }),
    { status: 'finalizado' }
  );
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
});

test('update ativo: pendente sem foto inicial → 422 (guard existente preservado)', async () => {
  const { resposta, capt } = await executarUpdate(
    freteBase({ status: 'pendente', foto_odometro_inicial_path: null }),
    { status: 'ativo' }
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /foto do odômetro inicial/i);
  assert.equal(capt.updatePayload, undefined);
});

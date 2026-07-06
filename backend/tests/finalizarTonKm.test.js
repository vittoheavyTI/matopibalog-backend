const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Testa exports.finalizar do fretesController para a modalidade tonelada_km.
// Foco do hotfix: NÃO finalizar sem km_final válido (senão fica "finalizado" com
// valor 0 provisório e distância ausente). Reaproveita o padrão de mock por
// Module._load (supabase falso, sem banco). Usa super-admin p/ pular ownership.

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
      // await direto no builder. Sempre 0 pendências para chegar ao guard de KM.
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

const executarFinalizar = async (frete, body = {}) => {
  const { controller, capt } = criarController(frete);
  let resposta = null;
  await controller.finalizar(
    { params: { id: frete.id }, body, user: { role: 'admin', uid: 'sa-1', is_super_admin: true } },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } }
  );
  return { resposta, capt };
};

const freteTonKm = (over = {}) => ({
  id: 'frete-1', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo',
  km_inicial: 1000, km_final: null, modalidade_calculo: 'tonelada_km',
  toneladas: 50, valor_tonelada_km: 150, ...over,
});

test('finalizar tonelada_km SEM km_final → 422 e não finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(freteTonKm(), {});
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /KM final/i);
  assert.equal(capt.updatePayload, undefined, 'não deve chamar update / não muda status');
});

test('finalizar tonelada_km COM km_final válido → calcula valor e finaliza', async () => {
  // 50 t * (1500 - 1000 = 500 km) * 150 = 3.750.000
  const { resposta, capt } = await executarFinalizar(freteTonKm(), { km_final: 1500 });
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
  assert.equal(capt.updatePayload.valor_frete, 50 * 500 * 150);
  assert.equal(capt.updatePayload.km_final, 1500);
});

test('finalizar tonelada_km com km_final <= km_inicial → 422 e não finaliza', async () => {
  // km_final gravado (500) <= km_inicial (1000); body vazio exercita o guard novo.
  const { resposta, capt } = await executarFinalizar(freteTonKm({ km_final: 500 }), {});
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /maior que o KM inicial/i);
  assert.equal(capt.updatePayload, undefined);
});

test('finalizar valor_fixo sem km → finaliza normalmente (comportamento antigo intacto)', async () => {
  const { resposta, capt } = await executarFinalizar(
    { id: 'f-2', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo', km_inicial: null, km_final: null, modalidade_calculo: 'valor_fixo', toneladas: null, valor_tonelada_km: null },
    {}
  );
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
});

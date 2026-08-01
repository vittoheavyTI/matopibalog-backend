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

// valor_tonelada_km em escala REALISTA (0,15 R$/t·km). O valor 150, usado antes da
// trava de sanidade, agora é recusado (> VALOR_TONELADA_KM_MAX=10) — ver teste de
// finalização abaixo e limitesFrete.test.js.
const freteTonKm = (over = {}) => ({
  id: 'frete-1', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo',
  km_inicial: 1000, km_final: null, modalidade_calculo: 'tonelada_km',
  toneladas: 50, valor_tonelada_km: 0.15, ...over,
});

test('finalizar tonelada_km SEM km_final → 422 e não finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(freteTonKm(), {});
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /KM final/i);
  assert.equal(capt.updatePayload, undefined, 'não deve chamar update / não muda status');
});

test('finalizar tonelada_km COM km_final válido → calcula valor e finaliza', async () => {
  // 50 t * (1500 - 1000 = 500 km) * 0,15 = 3.750
  const { resposta, capt } = await executarFinalizar(freteTonKm(), { km_final: 1500 });
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
  assert.equal(capt.updatePayload.valor_frete, 50 * 500 * 0.15);
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

test('novo fluxo pendente sem foto inicial → 422 e não finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(freteTonKm({
    status: 'pendente',
    foto_odometro_inicial_path: null,
    foto_odometro_final_path: null,
  }), { km_final: 1500 });
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /foto do odômetro inicial/i);
  assert.equal(capt.updatePayload, undefined);
});

test('novo fluxo com foto inicial SEM foto final → 422 e não finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(freteTonKm({
    foto_odometro_inicial_path: 'e-1/fretes/frete-1/odometro-inicial.jpg',
    foto_odometro_final_path: null,
  }), { km_final: 1500 });
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /foto do odômetro final/i);
  assert.equal(capt.updatePayload, undefined);
});

test('novo fluxo com fotos inicial e final → calcula e finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(freteTonKm({
    foto_odometro_inicial_path: 'e-1/fretes/frete-1/odometro-inicial.jpg',
    foto_odometro_final_path: 'e-1/fretes/frete-1/odometro-final.jpg',
  }), { km_final: 1500 });
  assert.equal(resposta.status, 200);
  assert.equal(capt.updatePayload.status, 'finalizado');
  assert.equal(capt.updatePayload.valor_frete, 50 * 500 * 0.15);
});

// Trava de sanidade na finalização: um frete tonelada_km com insumos absurdos
// (ex.: valor_tonelada_km = 150, acima do teto) NÃO pode virar valor final.
test('finalizar tonelada_km com valor_tonelada_km > 10 (legado absurdo) → 422, não finaliza', async () => {
  const { resposta, capt } = await executarFinalizar(
    freteTonKm({ valor_tonelada_km: 150 }),
    { km_final: 1500 },
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /Não foi possível finalizar a viagem/i);
  assert.match(resposta.body.message, /valor por tonelada\/km/i);
  assert.equal(capt.updatePayload, undefined, 'não deve finalizar / não grava valor absurdo');
});

test('finalizar tonelada_km cujo valor derivado passaria de R$1.000.000 → 422, não finaliza', async () => {
  // toneladas 50, vtk 10 (no teto), distância 3000 → 50*3000*10 = 1.500.000 > teto.
  const { resposta, capt } = await executarFinalizar(
    freteTonKm({ toneladas: 50, valor_tonelada_km: 10, km_inicial: 1000 }),
    { km_final: 4000 },
  );
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /Não foi possível finalizar a viagem/i);
  assert.match(resposta.body.message, /valor do frete calculado/i);
  assert.equal(capt.updatePayload, undefined);
});

test('novo fluxo valor_fixo com fotos mas sem KM final → 422', async () => {
  const { resposta, capt } = await executarFinalizar({
    id: 'f-3', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo',
    km_inicial: 1000, km_final: null, modalidade_calculo: 'valor_fixo',
    toneladas: null, valor_tonelada_km: null,
    foto_odometro_inicial_path: 'e-1/fretes/f-3/odometro-inicial.jpg',
    foto_odometro_final_path: 'e-1/fretes/f-3/odometro-final.jpg',
  });
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /KM final/i);
  assert.equal(capt.updatePayload, undefined);
});

// --- PR #245: regressões explícitas do fluxo tonelada/km ---
// Garantem que a trava NÃO depende de foto/rótulo "legado": um frete tonelada/km
// SEM foto inicial (portanto "legado" pela classificação do painel) continua
// bloqueado sem km_final, mantém o status e não persiste valor provisório.

test('PR#245: tonelada_km LEGADO (sem foto inicial) sem km_final → 422, status preservado, sem valor final', async () => {
  const frete = freteTonKm({ status: 'ativo', foto_odometro_inicial_path: null, foto_odometro_final_path: null });
  const { resposta, capt } = await executarFinalizar(frete, {});
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /KM final/i);
  // Nenhum update ⇒ status permanece 'ativo' e valor_frete provisório não vira final.
  assert.equal(capt.updatePayload, undefined, 'não deve chamar update / não muda status');
});

test('PR#245: tonelada_km bloqueado nunca grava valor_frete (mesmo com km_inicial presente)', async () => {
  const frete = freteTonKm({ km_inicial: 1000, km_final: null, valor_frete: 0 });
  const { resposta, capt } = await executarFinalizar(frete, {});
  assert.equal(resposta.status, 422);
  // Ainda que houvesse um update, valor_frete NÃO poderia ter sido definido.
  assert.ok(!capt.updatePayload || capt.updatePayload.valor_frete === undefined, 'valor_frete provisório não pode virar final');
});

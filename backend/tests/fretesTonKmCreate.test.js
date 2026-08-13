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

// Nota: valores usam escala REALISTA de valor_tonelada_km (0,15 R$/t·km). O valor
// 150 usado antes desta trava passa a ser recusado (150 > VALOR_TONELADA_KM_MAX=10);
// ver testes de regressão em limitesFrete.test.js e os casos 422 abaixo.
test('create tonelada_km SEM km_final → valor_frete 0 provisório (nunca null)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 0.15, km_inicial: 1,
    odometro_obrigatorio: true,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 0, 'valor_frete provisório deve ser 0, não null');
  assert.notEqual(insertPayload.valor_frete, null);
  assert.equal(insertPayload.modalidade_calculo, 'tonelada_km');
  assert.equal(insertPayload.toneladas, 50);
  assert.equal(insertPayload.valor_tonelada_km, 0.15);
  assert.equal(insertPayload.status, 'pendente', 'novo frete aguarda foto inicial antes de ativar');
});

test('create tonelada_km COM km_final → valor_frete calculado', async () => {
  // 50 t * (1500 - 1000 = 500 km) * 0,15 = 3.750
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 0.15, km_inicial: 1000, km_final: 1500,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 50 * 500 * 0.15);
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
  assert.equal(insertPayload.status, 'ativo', 'cliente antigo sem marcador mantém compatibilidade');
});

// ─── Trava de sanidade operacional (422, sem insert) ──────────────────────────
// Reproduz os casos reais que motivaram o PR (Empresa Alfa / motorista de teste):
// valores internamente coerentes com a fórmula, mas absurdos por falta de teto.

test('create tonelada_km 50 × 799 × 150 (caso real R$5.992.500) → 422, sem insert', async () => {
  // km_inicial 1 / km_final 800 → distância 799.
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 150, km_inicial: 1, km_final: 800,
  });
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_operational_limit');
  assert.equal(resposta.body.field, 'valor_tonelada_km');
  assert.equal(resposta.body.current_value, 150);
  assert.equal(resposta.body.max_value, 10);
  assert.match(resposta.body.limit, /R\$ 10/);
  assert.match(resposta.body.message, /valor por tonelada\/km/i);
  assert.match(resposta.body.message, /150/i);
  assert.equal(insertPayload, null, 'não deve inserir quando reprova');
});

test('create tonelada_km 48 × 1750 × 450 (caso real R$37.800.000) → 422, sem insert', async () => {
  // km_inicial 1 / km_final 1751 → distância 1750.
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 48, valor_tonelada_km: 450, km_inicial: 1, km_final: 1751,
  });
  assert.equal(resposta.status, 422);
  assert.match(resposta.body.message, /valor por tonelada\/km/i);
  assert.match(resposta.body.message, /450/i);
  assert.equal(insertPayload, null);
});

test('create tonelada_km 1 × 799 × 150 → 422 por valor_tonelada_km > 10 (mesmo com valor total baixo)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 1, valor_tonelada_km: 150, km_inicial: 1, km_final: 800,
  });
  assert.equal(resposta.status, 422);
  assert.equal(insertPayload, null);
});

test('create tonelada_km SEM km_final mas com valor_tonelada_km > 10 → 422 já na criação (sem valor 0 provisório)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 50, valor_tonelada_km: 150, km_inicial: 1,
    odometro_obrigatorio: true,
  });
  assert.equal(resposta.status, 422);
  assert.equal(insertPayload, null);
});

test('create tonelada_km toneladas > 100 → 422, sem insert', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    modalidade_calculo: 'tonelada_km', toneladas: 150, valor_tonelada_km: 0.15, km_inicial: 1000, km_final: 1500,
  });
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_operational_limit');
  assert.equal(resposta.body.field, 'toneladas');
  assert.equal(resposta.body.current_value, 150);
  assert.equal(resposta.body.max_value, 100);
  assert.equal(insertPayload, null);
});

test('create valor_fixo acima de R$1.000.000 → 422, sem insert', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    valor_frete: 2000000,
  });
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_operational_limit');
  assert.equal(resposta.body.field, 'valor_frete');
  assert.equal(resposta.body.current_value, 2000000);
  assert.equal(resposta.body.max_value, 1000000);
  assert.match(resposta.body.message, /valor do frete calculado/i);
  assert.match(resposta.body.message, /2.000.000/i);
  assert.equal(insertPayload, null);
});

test('create valor_fixo no teto exato (R$1.000.000) → 201 (limite inclusivo)', async () => {
  const { resposta, insertPayload } = await executarCreate({
    origem: 'A', destino: 'B', motorista_id: '11111111-1111-1111-1111-111111111111',
    valor_frete: 1000000,
  });
  assert.equal(resposta.status, 201);
  assert.equal(insertPayload.valor_frete, 1000000);
});

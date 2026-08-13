const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/fretesController');

const frete = (over = {}) => ({
  id: '2f820889-6248-4469-983b-a673afadeda3',
  motorista_id: '059ee0f2-fb3c-4693-8822-c5644c54901e',
  empresa_id: 'e5afecd6-2335-4436-86a7-0dfb495b9cbc',
  status: 'ativo',
  modalidade_calculo: 'tonelada_km',
  toneladas: 5,
  valor_tonelada_km: 245,
  valor_frete: 0,
  km_inicial: 1,
  km_final: null,
  ...over,
});

const criarController = (freteData, { rpcError = null } = {}) => {
  const capt = { rpcName: null, rpcArgs: null };
  const supabaseMock = {
    from(tabela) {
      const b = {
        select() { return b; },
        eq() { return b; },
        async single() {
          if (tabela === 'fretes') return { data: freteData, error: freteData ? null : new Error('not found') };
          return { data: null, error: null };
        },
        async maybeSingle() {
          if (tabela === 'usuarios') return { data: { id: '11111111-1111-1111-1111-111111111111' }, error: null };
          return { data: null, error: null };
        },
      };
      return b;
    },
    async rpc(name, args) {
      capt.rpcName = name;
      capt.rpcArgs = args;
      if (rpcError) return { data: null, error: rpcError };
      return {
        data: {
          idempotent: false,
          audit_id: 'audit-1',
          frete_id: args.p_frete_id,
          before_snapshot: {},
          after_snapshot: { valor_tonelada_km: 0.245 },
        },
        error: null,
      };
    },
  };

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

async function executar({ freteData = frete(), user = { role: 'admin', uid: '11111111-1111-1111-1111-111111111111' }, empresaId = frete().empresa_id, body, rpcError = null } = {}) {
  const { controller, capt } = criarController(freteData, { rpcError });
  let resposta = null;
  await controller.corrigirFinanceiro(
    { params: { id: freteData?.id || frete().id }, body, user, empresa_id: empresaId },
    { status(status) { return { json(b) { resposta = { status, body: b }; } }; } },
  );
  return { resposta, capt };
}

test('POST correcao-financeira chama RPC auditada com patch derivado', async () => {
  const { resposta, capt } = await executar({
    body: {
      fields: { valor_tonelada_km: 0.245, km_final: 800 },
      reason: 'correcao financeira legado auditada',
      request_id: 'req-controller-1',
    },
  });
  assert.equal(resposta.status, 200);
  assert.equal(capt.rpcName, 'corrigir_frete_financeiro_legacy');
  assert.equal(capt.rpcArgs.p_source, 'painel_admin');
  assert.equal(capt.rpcArgs.p_request_id, 'req-controller-1');
  assert.equal(capt.rpcArgs.p_correction_type, 'manual_legacy_financial_correction');
  assert.equal(capt.rpcArgs.p_actor_auth_uid, '11111111-1111-1111-1111-111111111111');
  assert.deepEqual(capt.rpcArgs.p_expected_before_snapshot, {
    modalidade_calculo: 'tonelada_km',
    toneladas: 5,
    valor_tonelada_km: 245,
    valor_frete: 0,
    km_inicial: 1,
    km_final: null,
    status: 'ativo',
  });
  assert.equal(capt.rpcArgs.p_patch.valor_tonelada_km, 0.245);
  assert.equal(capt.rpcArgs.p_patch.km_final, 800);
  assert.equal(capt.rpcArgs.p_patch.valor_frete, 978.78);
});

test('POST correcao-financeira bloqueia motorista e tenant divergente antes da RPC', async () => {
  const motorista = await executar({
    user: { role: 'motorista', uid: '059ee0f2-fb3c-4693-8822-c5644c54901e' },
    body: { fields: { valor_tonelada_km: 0.245 }, reason: 'correcao financeira legado auditada', request_id: 'req-controller-2' },
  });
  assert.equal(motorista.resposta.status, 403);
  assert.equal(motorista.capt.rpcName, null);

  const tenant = await executar({
    empresaId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    body: { fields: { valor_tonelada_km: 0.245 }, reason: 'correcao financeira legado auditada', request_id: 'req-controller-3' },
  });
  assert.equal(tenant.resposta.status, 403);
  assert.equal(tenant.capt.rpcName, null);
});

test('POST correcao-financeira bloqueia cancelado com erro estruturado', async () => {
  const { resposta, capt } = await executar({
    freteData: frete({ status: 'cancelado' }),
    body: { fields: { valor_tonelada_km: 0.245 }, reason: 'correcao financeira legado auditada', request_id: 'req-controller-4' },
  });
  assert.equal(resposta.status, 422);
  assert.equal(resposta.body.error, 'frete_financial_correction_status_locked');
  assert.equal(resposta.body.field, 'status');
  assert.equal(resposta.body.current_value, 'cancelado');
  assert.equal(capt.rpcName, null);
});

test('POST correcao-financeira mapeia concorrencia otimista para 409', async () => {
  const { resposta, capt } = await executar({
    body: {
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado auditada',
      request_id: 'req-controller-5',
    },
    rpcError: new Error('frete_financial_correction_concurrent_change'),
  });
  assert.equal(capt.rpcName, 'corrigir_frete_financeiro_legacy');
  assert.equal(resposta.status, 409);
  assert.equal(resposta.body.error, 'frete_financial_correction_concurrent_change');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-shipper-portal';

const {
  loadPortalContext, requireRelationship, requireOwnedRequest, ShipperPortalError,
} = require('../services/shipperPortal/shipperBoundaryService');
const { emitirTokenPortal, verifyPortalToken } = require('../middlewares/shipperPortalAuth');
const { snapshotParaObjetivo, projetarParaTransportadora } = require('../services/shipperPortal/shipperRequestReviewService');
const { normalizarOrigens, montarSnapshot, projetarRequestParaPortal } = require('../services/shipperPortal/shipperRequestService');

// ============================================================================
// Stub de supabase: dados por tabela, com filtros eq/in reais — o ponto do teste
// é justamente provar que o FILTRO de fronteira é aplicado no servidor (§78),
// então o stub precisa honrar os filtros de verdade.
// ============================================================================
function makeSupabase(tabelas = {}, { rpcImpl } = {}) {
  const rpcCalls = [];
  function builder(nome) {
    const filtros = [];
    const b = {
      select() { return b; },
      eq(col, val) { filtros.push([col, val, 'eq']); return b; },
      in(col, vals) { filtros.push([col, vals, 'in']); return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: linhas()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: linhas()[0] || null, error: null }); },
      then(resolve) { resolve({ data: linhas(), error: null }); },
    };
    function linhas() {
      return (tabelas[nome] || []).filter((row) => filtros.every(([col, val, op]) => (
        op === 'in' ? val.includes(row[col]) : row[col] === val
      )));
    }
    return b;
  }
  return {
    from: (n) => builder(n),
    _rpcCalls: rpcCalls,
    rpc: (name, params) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(rpcImpl ? rpcImpl(name, params) : { data: null, error: null });
    },
  };
}

const ORG_X = 'org-x';
const ORG_Y = 'org-y';
const EMP_A = 'empresa-a';
const USER_X = 'user-x';
const USER_Y = 'user-y';

function fixtureBase() {
  return {
    shipper_portal_users: [
      { id: USER_X, shipper_org_id: ORG_X, email: 'x@t.test', nome: 'X', status: 'active' },
      { id: USER_Y, shipper_org_id: ORG_Y, email: 'y@t.test', nome: 'Y', status: 'active' },
    ],
    shipper_carrier_relationships: [
      { id: 'rel-ax', shipper_org_id: ORG_X, empresa_id: EMP_A, status: 'ACTIVE' },
      { id: 'rel-ay', shipper_org_id: ORG_Y, empresa_id: EMP_A, status: 'ACTIVE' },
    ],
    shipper_transport_requests: [
      { id: 'req-x', shipper_org_id: ORG_X, relationship_id: 'rel-ax', empresa_id: EMP_A, reference_code: 'SOL-X', status: 'SUBMITTED' },
      { id: 'req-y', shipper_org_id: ORG_Y, relationship_id: 'rel-ay', empresa_id: EMP_A, reference_code: 'SOL-Y', status: 'SUBMITTED' },
    ],
  };
}

// ---- contexto externo ------------------------------------------------------

test('fronteira: contexto do portal carrega apenas relacionamentos ATIVOS do próprio embarcador', async () => {
  const supabase = makeSupabase(fixtureBase());
  const ctx = await loadPortalContext(supabase, { portalUserId: USER_X });
  assert.equal(ctx.shipperOrgId, ORG_X);
  assert.deepEqual(ctx.relationshipIds, ['rel-ax']);
  assert.ok(!ctx.relationshipIds.includes('rel-ay'), 'nunca deve enxergar relacionamento de outro embarcador');
});

test('fronteira: usuário de portal desativado é bloqueado', async () => {
  const dados = fixtureBase();
  dados.shipper_portal_users[0].status = 'disabled';
  const supabase = makeSupabase(dados);
  await assert.rejects(
    loadPortalContext(supabase, { portalUserId: USER_X }),
    (err) => err instanceof ShipperPortalError && err.code === 'portal_user_disabled' && err.status === 403,
  );
});

test('fronteira: relacionamento REVOGADO remove o acesso nas requisições seguintes (§21)', async () => {
  const dados = fixtureBase();
  dados.shipper_carrier_relationships[0].status = 'REVOKED';
  const supabase = makeSupabase(dados);
  await assert.rejects(
    loadPortalContext(supabase, { portalUserId: USER_X }),
    (err) => err.code === 'no_active_relationship' && err.status === 403,
  );
});

test('fronteira: sem sessão de portal não há contexto (nunca cai em fallback de tenant)', async () => {
  const supabase = makeSupabase(fixtureBase());
  await assert.rejects(
    loadPortalContext(supabase, { portalUserId: null }),
    (err) => err.code === 'portal_session_invalid' && err.status === 401,
  );
});

// ---- ISOLAMENTO ENTRE EMBARCADORES DA MESMA TRANSPORTADORA (§50) -----------
// Este é o teste mais importante desta frente: tenant igual NÃO basta.

test('ISOLAMENTO CRÍTICO: embarcador X não acessa solicitação do embarcador Y na MESMA transportadora', async () => {
  const supabase = makeSupabase(fixtureBase());
  const ctx = await loadPortalContext(supabase, { portalUserId: USER_X });
  await assert.rejects(
    requireOwnedRequest(supabase, ctx, 'req-y'),
    (err) => err.code === 'request_not_found' && err.status === 404,
  );
});

test('ISOLAMENTO CRÍTICO: embarcador X acessa normalmente a PRÓPRIA solicitação', async () => {
  const supabase = makeSupabase(fixtureBase());
  const ctx = await loadPortalContext(supabase, { portalUserId: USER_X });
  const row = await requireOwnedRequest(supabase, ctx, 'req-x');
  assert.equal(row.id, 'req-x');
});

test('ISOLAMENTO: relacionamento de outro embarcador é 404 (não confirma existência — §80)', async () => {
  const supabase = makeSupabase(fixtureBase());
  const ctx = await loadPortalContext(supabase, { portalUserId: USER_X });
  assert.throws(
    () => requireRelationship(ctx, 'rel-ay'),
    (err) => err.code === 'relationship_not_found' && err.status === 404,
  );
});

// ---- separação de credenciais (§5/§19) -------------------------------------

function resStub() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('credencial: token de portal autentica no portal', () => {
  const token = emitirTokenPortal({ portalUserId: USER_X, shipperOrgId: ORG_X, email: 'x@t.test' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = resStub();
  let passou = false;
  verifyPortalToken(req, res, () => { passou = true; });
  assert.equal(passou, true);
  assert.equal(req.portalUser.id, USER_X);
  assert.equal(req.portalUser.shipper_org_id, ORG_X);
});

test('credencial: token INTERNO não autentica no portal', () => {
  const interno = jwt.sign({ uid: 'operador-interno', role: 'admin' }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${interno}` } };
  const res = resStub();
  let passou = false;
  verifyPortalToken(req, res, () => { passou = true; });
  assert.equal(passou, false);
  assert.equal(res.statusCode, 403);
});

test('credencial: token de PORTAL é rejeitado pelo auth interno (não vira operador da transportadora)', () => {
  // Isola o módulo interno para exercitar o caminho legado (sessionsEnabled=false).
  delete require.cache[require.resolve('../middlewares/auth')];
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request.includes('services/auth/authRuntime')) {
      return { getAuthRuntime: () => ({ cfg: { sessionsEnabled: false }, sessionService: null }) };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    const { verifyToken } = require('../middlewares/auth');
    const portalToken = emitirTokenPortal({ portalUserId: USER_X, shipperOrgId: ORG_X, email: 'x@t.test' });
    const req = { headers: { authorization: `Bearer ${portalToken}` }, cookies: {} };
    const res = resStub();
    let passou = false;
    verifyToken(req, res, () => { passou = true; });
    assert.equal(passou, false, 'token de portal NUNCA pode passar no auth interno');
    assert.equal(res.statusCode, 403);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../middlewares/auth')];
  }
});

// ---- multi-origem / snapshot ----------------------------------------------

test('solicitação: multi-origem com quantidade por origem; total é derivado, nunca pedido', () => {
  const origens = normalizarOrigens([
    { nome: 'Fazenda A', quantidade: 300 },
    { nome: 'Fazenda B', quantidade: 200, quantity_unit: 'ton' },
  ], 'ton');
  assert.equal(origens.length, 2);
  const snap = montarSnapshot({ reference_code: 'SOL-1', cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'ton' }, origens);
  assert.equal(snap.total_quantidade, 500);
});

// ---- HIGH-04: uma solicitação, uma unidade --------------------------------

test('HIGH-04: origem com unidade DIVERGENTE da solicitação é recusada (nunca soma kg com ton)', () => {
  assert.throws(
    () => normalizarOrigens([
      { nome: 'Fazenda A', quantidade: 1000, quantity_unit: 'kg' },
      { nome: 'Fazenda B', quantidade: 1, quantity_unit: 'ton' },
    ], 'kg'),
    (err) => err.code === 'origin_unit_mismatch'
      && /mesma unidade/.test(err.message),
  );
});

test('HIGH-04: todas as origens herdam a unidade canônica da solicitação', () => {
  const origens = normalizarOrigens([
    { nome: 'Fazenda A', quantidade: 1000 },
    { nome: 'Fazenda B', quantidade: 500 },
  ], 'kg');
  assert.deepEqual(origens.map((o) => o.quantity_unit), ['kg', 'kg']);
  const snap = montarSnapshot({ reference_code: 'S', cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'kg' }, origens);
  assert.equal(snap.total_quantidade, 1500, 'soma valida: mesma unidade em todas as parcelas');
});

test('HIGH-04: quantidade zero é recusada (zero não é necessidade de transporte)', () => {
  assert.throws(
    () => normalizarOrigens([{ nome: 'Fazenda A', quantidade: 0 }], 'ton'),
    (err) => err.code === 'invalid_quantity' && /maior que zero/.test(err.message),
  );
});

test('HIGH-04: quantidade negativa é recusada', () => {
  assert.throws(
    () => normalizarOrigens([{ nome: 'Fazenda A', quantidade: -5 }], 'ton'),
    (err) => err.code === 'invalid_quantity',
  );
});

test('HIGH-04: criarSolicitacao não envia unidade por origem (autoridade é a solicitação)', async () => {
  const { criarSolicitacao } = require('../services/shipperPortal/shipperRequestService');
  const supabase = makeSupabase(fixtureBase(), {
    rpcImpl: () => ({ data: { id: 'r1', reference_code: 'S', status: 'SUBMITTED', cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'kg' }, error: null }),
  });
  await criarSolicitacao(supabase, {
    portalUserId: USER_X,
    body: {
      cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'kg',
      origins: [{ nome: 'Fazenda A', quantidade: 1000 }, { nome: 'Fazenda B', quantidade: 500 }],
    },
  });
  const chamada = supabase._rpcCalls.find((c) => c.name === 'shipper_request_create_and_submit');
  assert.equal(chamada.params.p_quantity_unit, 'kg');
  for (const o of chamada.params.p_origins) {
    assert.ok(!('quantity_unit' in o), 'origem nao pode carregar unidade propria');
  }
});

test('solicitação: origem duplicada é recusada com mensagem clara', () => {
  assert.throws(
    () => normalizarOrigens([{ nome: 'Fazenda A', quantidade: 10 }, { nome: 'fazenda a', quantidade: 5 }]),
    (err) => err.code === 'duplicate_origin',
  );
});

test('solicitação: sem nenhuma origem é recusada', () => {
  assert.throws(() => normalizarOrigens([]), (err) => err.code === 'missing_origins');
});

test('solicitação: NÃO pede distância, diesel, consumo, motorista, veículo nem número de viagens (§25)', () => {
  const origens = normalizarOrigens([{ nome: 'Fazenda A', quantidade: 100 }]);
  const snap = montarSnapshot(
    { reference_code: 'SOL-2', cargo_name: 'Milho', destination_name: 'Armazém', quantity_unit: 'ton' }, origens);
  for (const proibido of ['distance_km', 'fuel_price_per_liter', 'consumption_km_per_liter',
    'driver_id', 'vehicle_id', 'trip_count', 'motorista_id', 'placa']) {
    assert.ok(!(proibido in snap), `snapshot nao deve conter ${proibido}`);
  }
});

// ---- handoff para o Orchestrator (§97/§120) --------------------------------

test('handoff: snapshot aceito vira objetivo canônico sem redigitar nada', () => {
  const snapshot = {
    cargo_name: 'Soja', destination_name: 'Porto de Santos',
    window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-30T00:00:00Z',
    origins: [
      { nome: 'Fazenda A', quantidade: 300, quantity_unit: 'ton' },
      { nome: 'Fazenda B', quantidade: 200, quantity_unit: 'ton' },
    ],
  };
  const objetivo = snapshotParaObjetivo(snapshot, { referenceCode: 'SOL-77' });
  assert.equal(objetivo.cargo_name, 'Soja');
  assert.equal(objetivo.destination, 'Porto de Santos');
  assert.equal(objetivo.origins.length, 2);
  assert.equal(objetivo.origins[0].target_quantity, 300);
  assert.equal(objetivo.origins[1].name, 'Fazenda B');
  assert.equal(objetivo.planned_start, '2026-09-01T00:00:00Z');
});

// ---- privacidade (§54/§118/§119) -------------------------------------------

test('privacidade: projeção do portal NÃO expõe financeiro, PII de motorista nem IDs internos', () => {
  const row = {
    id: 'req-1', reference_code: 'SOL-1', status: 'ACCEPTED', cargo_name: 'Soja',
    destination_name: 'Porto', quantity_unit: 'ton', created_at: 'x', submitted_at: 'y',
    // Campos internos que NUNCA podem vazar por projeção:
    campaign_id: 'camp-interno', decided_by: 'operador-interno-uuid',
    submitted_snapshot: { segredo: true }, accepted_snapshot: { segredo: true },
    empresa_id: EMP_A, relationship_id: 'rel-ax',
  };
  const dto = projetarRequestParaPortal(row, []);
  for (const proibido of ['campaign_id', 'decided_by', 'submitted_snapshot', 'accepted_snapshot',
    'valor_frete', 'margem', 'comissao', 'custo_combustivel', 'motorista_id', 'cpf', 'cnh', 'telefone']) {
    assert.ok(!(proibido in dto), `DTO do portal nao pode conter ${proibido}`);
  }
  // Mas informa, de forma segura, que a operação já existe.
  assert.equal(dto.operacao_criada, true);
});

// ---- owner review: serviço delega atomicidade às RPCs ----------------------

test('HIGH-02: criarSolicitacao usa a RPC atômica (não faz 3 escritas independentes)', async () => {
  const { criarSolicitacao } = require('../services/shipperPortal/shipperRequestService');
  const supabase = makeSupabase(fixtureBase(), {
    rpcImpl: (name) => (name === 'shipper_request_create_and_submit'
      ? { data: { id: 'req-novo', reference_code: 'SOL-1', status: 'SUBMITTED', cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'ton' }, error: null }
      : { data: null, error: { message: 'rpc_inesperada' } }),
  });
  const dto = await criarSolicitacao(supabase, {
    portalUserId: USER_X,
    body: { cargo_name: 'Soja', destination_name: 'Porto', origins: [{ nome: 'Fazenda A', quantidade: 300 }] },
  });
  assert.equal(dto.status, 'SUBMITTED');
  const chamada = supabase._rpcCalls.find((c) => c.name === 'shipper_request_create_and_submit');
  assert.ok(chamada, 'deve chamar a RPC atomica');
  // empresa_id NUNCA vem do cliente: é derivado do relacionamento dentro da RPC.
  assert.ok(!('p_empresa_id' in chamada.params), 'empresa_id nao pode ser parametro de entrada');
  assert.equal(chamada.params.p_shipper_org_id, ORG_X);
  assert.equal(chamada.params.p_portal_user_id, USER_X);
  assert.equal(chamada.params.p_origins.length, 1);
});

test('HIGH-03: cancelarSolicitacao usa a RPC atômica e valida fronteira antes', async () => {
  const { cancelarSolicitacao } = require('../services/shipperPortal/shipperRequestService');
  const supabase = makeSupabase(fixtureBase(), {
    rpcImpl: (name) => (name === 'shipper_request_cancel'
      ? { data: { id: 'req-x', reference_code: 'SOL-X', status: 'CANCELLED', cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'ton' }, error: null }
      : { data: null, error: { message: 'rpc_inesperada' } }),
  });
  const dto = await cancelarSolicitacao(supabase, { portalUserId: USER_X, requestId: 'req-x', motivo: 'desisti' });
  assert.equal(dto.status, 'CANCELLED');
  const chamada = supabase._rpcCalls.find((c) => c.name === 'shipper_request_cancel');
  assert.ok(chamada);
  assert.equal(chamada.params.p_shipper_org_id, ORG_X);
});

test('HIGH-03: cancelar solicitação de OUTRO embarcador é bloqueado ANTES de chamar a RPC', async () => {
  const { cancelarSolicitacao } = require('../services/shipperPortal/shipperRequestService');
  const supabase = makeSupabase(fixtureBase());
  await assert.rejects(
    cancelarSolicitacao(supabase, { portalUserId: USER_X, requestId: 'req-y', motivo: 'x' }),
    (err) => err.code === 'request_not_found' && err.status === 404,
  );
  assert.equal(supabase._rpcCalls.length, 0, 'nao pode nem chamar a RPC para recurso fora da fronteira');
});

test('HIGH-03: erro request_not_cancellable da RPC vira mensagem acionável em pt-BR', async () => {
  const { cancelarSolicitacao } = require('../services/shipperPortal/shipperRequestService');
  const supabase = makeSupabase(fixtureBase(), {
    rpcImpl: () => ({ data: null, error: { message: 'request_not_cancellable: ACCEPTED' } }),
  });
  await assert.rejects(
    cancelarSolicitacao(supabase, { portalUserId: USER_X, requestId: 'req-x', motivo: 'x' }),
    (err) => err.code === 'request_not_cancellable' && err.status === 409
      && /já foi decidida pela transportadora/.test(err.message),
  );
});

test('privacidade: projeção da transportadora é whitelist (não devolve a linha crua)', () => {
  const dto = projetarParaTransportadora({
    id: 'r', reference_code: 'SOL', status: 'SUBMITTED', shipper_org_id: ORG_X,
    cargo_name: 'Soja', destination_name: 'Porto', quantity_unit: 'ton',
    submitted_snapshot: { interno: true }, accepted_snapshot: { interno: true },
  }, []);
  assert.ok(!('submitted_snapshot' in dto));
  assert.ok(!('accepted_snapshot' in dto));
});

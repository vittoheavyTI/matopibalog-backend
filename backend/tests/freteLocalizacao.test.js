const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/freteLocalizacaoController');
const acessoPath = require.resolve('../controllers/freteAcesso');

function carregarController(cenario = {}) {
  const chamadas = { inserts: [], upserts: [], deletes: [], rpc: [] };

  function builder(tabela) {
    const state = { insert: false, upsert: false, delete: false, count: false };
    const b = {
      select(_cols, opts) { if (opts?.count) state.count = true; return b; },
      eq() { return b; },
      in() { return b; },
      gte() { return b; },
      lte() { return b; },
      order() { return b; },
      limit() { return b; },
      insert(payload) { state.insert = true; chamadas.inserts.push({ tabela, payload }); return b; },
      upsert(payload) { state.upsert = true; chamadas.upserts.push({ tabela, payload }); return b; },
      delete() { state.delete = true; chamadas.deletes.push({ tabela }); return b; },
      async single() { return resolverLinha(tabela, state); },
      async maybeSingle() { return resolverLinha(tabela, state); },
      then(resolve) {
        if (state.count) return resolve({ count: cenario.count ?? 0, error: null });
        if (state.delete) return resolve({ data: null, error: null });
        if (tabela === 'frete_localizacoes') return resolve({ data: cenario.historico ?? [], error: null });
        if (tabela === 'fretes') return resolve({ data: cenario.fretesAtivos ?? [], error: null });
        if (tabela === 'frete_localizacao_estado') return resolve({ data: cenario.estados ?? [], error: null });
        if (tabela === 'frete_ultima_localizacao') return resolve({ data: cenario.ultimas ?? [], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  }

  function resolverLinha(tabela, state) {
    if (tabela === 'fretes') {
      return cenario.frete ? { data: cenario.frete, error: null } : { data: null, error: { message: 'nf' } };
    }
    if (tabela === 'frete_ultima_localizacao') {
      if (state.upsert) {
        const p = chamadas.upserts.at(-1).payload;
        return { data: { ...p, received_at: '2026-07-31T12:05:00Z' }, error: null };
      }
      return { data: cenario.ultima ?? null, error: null };
    }
    if (tabela === 'frete_localizacao_estado') {
      if (state.upsert) {
        const p = chamadas.upserts.at(-1).payload;
        return { data: { ...p, atualizado_em: p.atualizado_em || '2026-07-31T12:05:00Z' }, error: null };
      }
      return { data: cenario.estado ?? null, error: null };
    }
    return { data: null, error: null };
  }

  const supabaseMock = {
    from(tabela) { return builder(tabela); },
    async rpc(nome) {
      chamadas.rpc.push(nome);
      return { data: cenario.rpcData ?? 0, error: cenario.rpcError || null };
    },
  };

  const originalLoad = Module._load;
  [controllerPath, acessoPath].forEach((p) => delete require.cache[p]);
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(controllerPath);
  Module._load = originalLoad;
  [controllerPath, acessoPath].forEach((p) => delete require.cache[p]);
  return { controller, chamadas };
}

function resMock() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const FRETE_ATIVO = { id: 'frete-1', motorista_id: 'mot-1', empresa_id: 'emp-1', status: 'ativo' };
const FRETE_FINAL = { ...FRETE_ATIVO, status: 'finalizado' };
const motorista = { uid: 'mot-1', role: 'motorista', is_super_admin: false };
const admin = { uid: 'adm-1', role: 'admin', is_super_admin: false };
const body = {
  latitude: -12.1234567,
  longitude: -45.1234567,
  accuracy_m: 12,
  captured_at: '2026-07-31T12:00:00Z',
};
const req = (over = {}) => ({ params: { id: 'frete-1' }, body, user: motorista, empresa_id: 'emp-1', ...over });

test('registrar: motorista dono em viagem ativa grava historico e ultima localizacao', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE_ATIVO });
  const res = resMock();
  await controller.registrar(req(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.inserts[0].tabela, 'frete_localizacoes');
  assert.equal(chamadas.upserts[0].tabela, 'frete_ultima_localizacao');
  assert.equal(chamadas.inserts[0].payload.empresa_id, 'emp-1');
  assert.equal(chamadas.inserts[0].payload.motorista_id, 'mot-1');
});

test('registrar: admin nao envia localizacao pelo motorista', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE_ATIVO });
  const res = resMock();
  await controller.registrar(req({ user: admin }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(chamadas.inserts.length, 0);
  assert.equal(chamadas.upserts.length, 0);
});

test('registrar: viagem encerrada remove ultima localizacao ativa e retorna 409', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE_FINAL });
  const res = resMock();
  await controller.registrar(req(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.deletes[0].tabela, 'frete_ultima_localizacao');
  assert.equal(chamadas.inserts.length, 0);
});

test('obter: viagem encerrada nao retorna ultima ativa e preserva historico limitado', async () => {
  const { controller, chamadas } = carregarController({
    frete: FRETE_FINAL,
    historico: [{ ...body, frete_id: 'frete-1', motorista_id: 'mot-1', received_at: '2026-07-31T12:05:00Z', source: 'app_foreground_service' }],
  });
  const res = resMock();
  await controller.obter(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ativa, false);
  assert.equal(res.body.ultima, null);
  assert.equal(res.body.historico.length, 1);
  assert.equal(chamadas.deletes[0].tabela, 'frete_ultima_localizacao');
});

test('registrarSessao: uma captura atualiza todos os fretes em andamento do motorista no tenant', async () => {
  const { controller, chamadas } = carregarController({
    fretesAtivos: [
      FRETE_ATIVO,
      { ...FRETE_ATIVO, id: 'frete-2' },
    ],
  });
  const res = resMock();
  await controller.registrarSessao(req({ params: {} }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.fretes_atualizados, 2);
  assert.equal(chamadas.inserts.filter((c) => c.tabela === 'frete_localizacoes').length, 2);
  assert.equal(chamadas.upserts.filter((c) => c.tabela === 'frete_ultima_localizacao').length, 2);
  assert.equal(chamadas.upserts.filter((c) => c.tabela === 'frete_localizacao_estado').length, 2);
  assert.deepEqual(chamadas.inserts.map((c) => c.payload.frete_id), ['frete-1', 'frete-2']);
});

test('registrarSessao: sem frete em andamento retorna 409 sem gravar ponto', async () => {
  const { controller, chamadas } = carregarController({ fretesAtivos: [] });
  const res = resMock();
  await controller.registrarSessao(req({ params: {} }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.inserts.length, 0);
  assert.equal(chamadas.upserts.length, 0);
});

test('registrarEstadoSessao: registra estado operacional sem coordenadas', async () => {
  const { controller, chamadas } = carregarController({ fretesAtivos: [FRETE_ATIVO] });
  const res = resMock();
  await controller.registrarEstadoSessao(req({
    params: {},
    body: { estado: 'gps_desativado', detalhe: 'GPS desativado no aparelho.' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(chamadas.inserts.length, 0);
  assert.equal(chamadas.upserts[0].tabela, 'frete_localizacao_estado');
  assert.equal(chamadas.upserts[0].payload.estado, 'gps_desativado');
  assert.equal(chamadas.upserts[0].payload.latitude, undefined);
});

// Frente #7 (Billing v2) — wiring da trava de limite nos fluxos de criação.
// Prova o comportamento dos controllers (a lógica de contagem/limite está em
// planoLimiteService, testada em planoLimiteService.test.js). Aqui injetamos um
// mock do serviço para isolar as decisões do controller:
//   A) adminController.createMotorista:
//      - abaixo do limite → 201 (cria no Auth);
//      - no limite → 409 amigável e NÃO cria no Auth (sem órfão);
//      - trigger legado no insert de motoristas → 409 (nunca 500).
//   B) authController.register:
//      - convite abaixo do limite → segue fluxo (201);
//      - convite no limite → 409 e NÃO cria no Auth;
//      - sem convite (autônomo) → NÃO passa pela trava (serviço não é chamado).

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── Mock de supabase encadeável genérico, guiado por cenário ──────────────────
function makeSupabase(cenario, chamadas) {
  function resolve(state) {
    const { table, op } = state;
    if (table === 'empresas' && op === 'select') {
      // Convite: lista de empresas com codigo_convite (register); ou tipo (createMotorista).
      if (cenario.empresas !== undefined) return { data: cenario.empresas, error: null };
      return { data: { tipo: 'transportadora' }, error: null };
    }
    if (table === 'planos' && op === 'select') {
      return { data: cenario.plano ?? { id: 'plano-1', dias_trial: 7, ativo: true }, error: null };
    }
    if (table === 'usuarios' && op === 'insert') return { error: cenario.usuariosInsertError ?? null };
    if (table === 'motoristas' && op === 'insert') return { error: cenario.motoristasInsertError ?? null };
    return { data: null, error: null };
  }
  function builder(table) {
    const state = { table, op: 'select' };
    const b = {
      select() { state.op = 'select'; return b; },
      insert(p) { state.op = 'insert'; state.payload = p; if (chamadas) chamadas.inserts.push({ table, payload: p }); return Promise.resolve(resolve(state)); },
      delete() { state.op = 'delete'; return b; },
      update(p) { state.op = 'update'; state.payload = p; return b; },
      eq() { return b; },
      not() { return b; },
      in() { return b; },
      order() { return b; },
      limit() { return b; },
      single() { return Promise.resolve(resolve(state)); },
      maybeSingle() { return Promise.resolve(resolve(state)); },
      then(f, r) { return Promise.resolve(resolve(state)).then(f, r); },
    };
    return b;
  }
  return {
    auth: {
      admin: {
        async createUser() { chamadas.createUser += 1; return { data: { user: { id: 'user-1' } }, error: null }; },
        async deleteUser() { chamadas.deleteUser += 1; return { error: null }; },
      },
    },
    from: (t) => builder(t),
  };
}

// Mock do serviço de limite (spy). avaliacao controlável por cenário.
function makePlanoLimiteMock(cenario, chamadas) {
  return {
    async avaliarLimiteMotoristas() {
      chamadas.avaliar += 1;
      return cenario.avaliacao ?? { ok: true, ilimitado: false, limite: 3, totalAtual: 1, planoAtual: 'Básico' };
    },
    montarErroLimiteMotoristas(a) {
      return { limiteMotoristasAtingido: true, limite: a.limite, totalAtual: a.totalAtual, planoAtual: a.planoAtual, message: 'limite atingido' };
    },
    ehErroTriggerLimiteMotoristas(err) {
      return !!err && `${err.message || ''}`.toLowerCase().includes('limite de motoristas do plano atingido');
    },
  };
}

function resMock() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// ── Harness para adminController ──────────────────────────────────────────────
function carregarAdmin(cenario) {
  const chamadas = { createUser: 0, deleteUser: 0, avaliar: 0, inserts: [] };
  const supabaseMock = makeSupabase(cenario, chamadas);
  const limiteMock = makePlanoLimiteMock(cenario, chamadas);
  const p = require.resolve('../controllers/adminController');
  const originalLoad = Module._load;
  delete require.cache[p];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    if (request === '../services/planoLimiteService') return limiteMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(p);
  Module._load = originalLoad;
  delete require.cache[p];
  return { controller, chamadas };
}

// ── Harness para authController ───────────────────────────────────────────────
function carregarAuth(cenario) {
  const chamadas = { createUser: 0, deleteUser: 0, avaliar: 0, inserts: [] };
  const supabaseMock = makeSupabase(cenario, chamadas);
  const limiteMock = makePlanoLimiteMock(cenario, chamadas);
  const empresaServiceMock = {
    async criarEmpresaCompleta() { return { empresa: { id: 'empresa-1' }, error: null }; },
  };
  const notificacaoMock = { criarParaUsuario: () => Promise.resolve(), criarParaEmpresa: () => Promise.resolve() };
  const p = require.resolve('../controllers/authController');
  const originalLoad = Module._load;
  delete require.cache[p];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    if (request === '../services/planoLimiteService') return limiteMock;
    if (request === '../services/empresaService') return empresaServiceMock;
    if (request === '../services/notificacaoService') return notificacaoMock;
    if (request === './termosController') return { getTermosPendentes: async () => ({ count: 0 }) };
    if (request === '@supabase/supabase-js') return { createClient: () => ({ auth: {} }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(p);
  Module._load = originalLoad;
  delete require.cache[p];
  return { controller, chamadas };
}

// ── A) createMotorista ────────────────────────────────────────────────────────
test('createMotorista: abaixo do limite → 201 e cria no Auth', async () => {
  const { controller, chamadas } = carregarAdmin({ avaliacao: { ok: true, limite: 3, totalAtual: 1, planoAtual: 'Básico' } });
  const res = resMock();
  await controller.createMotorista({ body: { nome: 'M', email: 'm@x.com', senha: '123456' }, empresa_id: 'emp1', user: {} }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.createUser, 1);
});

test('createMotorista: no limite → 409 amigável e NÃO cria no Auth (sem órfão)', async () => {
  const { controller, chamadas } = carregarAdmin({ avaliacao: { ok: false, limite: 3, totalAtual: 3, planoAtual: 'Básico' } });
  const res = resMock();
  await controller.createMotorista({ body: { nome: 'M', email: 'm@x.com', senha: '123456' }, empresa_id: 'emp1', user: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.limiteMotoristasAtingido, true);
  assert.equal(res.body.limite, 3);
  assert.equal(res.body.totalAtual, 3);
  assert.equal(chamadas.createUser, 0); // sem órfão no Auth
});

test('createMotorista: trigger legado no insert → 409, nunca 500', async () => {
  const { controller } = carregarAdmin({
    avaliacao: { ok: true, limite: 3, totalAtual: 2, planoAtual: 'Básico' },
    motoristasInsertError: { message: 'Limite de motoristas do plano atingido (3)' },
  });
  const res = resMock();
  await controller.createMotorista({ body: { nome: 'M', email: 'm@x.com', senha: '123456' }, empresa_id: 'emp1', user: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.limiteMotoristasAtingido, true);
});

// ── B) register ───────────────────────────────────────────────────────────────
const EMPRESA_CONVITE = [{ id: 'emp1', nome: 'Transp', codigo_convite: 'MATO-ABC123', status: 'ativo', tipo: 'transportadora', plano_id: 'pl', trial_ends_at: null }];

test('register convite: abaixo do limite → 201 e cria no Auth', async () => {
  const { controller, chamadas } = carregarAuth({ empresas: EMPRESA_CONVITE, avaliacao: { ok: true, limite: 5, totalAtual: 1, planoAtual: 'Pro' } });
  const res = resMock();
  await controller.register({ body: { nome: 'Mot', email: 'mot@x.com', senha: '123456', codigo_convite: 'MATO-ABC123' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.createUser, 1);
  assert.equal(chamadas.avaliar, 1); // trava avaliada no ramo convite
});

test('register convite: no limite → 409 e NÃO cria no Auth', async () => {
  const { controller, chamadas } = carregarAuth({ empresas: EMPRESA_CONVITE, avaliacao: { ok: false, limite: 1, totalAtual: 1, planoAtual: 'Autônomo' } });
  const res = resMock();
  await controller.register({ body: { nome: 'Mot', email: 'mot@x.com', senha: '123456', codigo_convite: 'MATO-ABC123' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.limiteMotoristasAtingido, true);
  assert.equal(chamadas.createUser, 0); // sem órfão
});

test('register sem convite (autônomo): NÃO passa pela trava (serviço não é chamado)', async () => {
  const { controller, chamadas } = carregarAuth({ avaliacao: { ok: true } });
  const res = resMock();
  await controller.register({ body: { nome: 'Auto', email: 'auto@x.com', senha: '123456', documento_billing: '12345678909', placa_veiculo: 'ABC1D23' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.avaliar, 0); // trava NUNCA toca criação inicial de autônomo
});

// Camada de ROTA da regularização: guards, gate sandbox, gate de tipo
// (autônomo), mapeamento resultado→HTTP e whitelist de colunas na resposta.
// O serviço é stubado — a coreografia dele tem teste próprio.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');

let verifyToken, verificarEmpresa, isSuperAdmin;
{
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    ({ verifyToken, isSuperAdmin } = require('../middlewares/auth'));
    verificarEmpresa = require('../middlewares/tenant').verificarEmpresa;
  } finally {
    Module._load = originalLoad;
  }
}

const EMPRESA = 'e5afecd6-2335-4436-86a7-0dfb495b9cbc';

const FATURA_COMPLETA = {
  id: 'f1', valor: 99.9, tipo_pagamento: 'PIX', status: 'pendente',
  due_date: '2026-07-29', pago_em: null, invoice_url: 'https://sandbox.asaas.com/i/1',
  bank_slip_url: null, periodo_referencia: '2026-07-01', origem: 'regularizacao',
  plano_nome_snapshot: 'Plano Básico', modelo_cobranca_snapshot: 'fixo',
  created_at: '2026-07-22T00:00:00Z',
  // sensíveis que NÃO podem vazar:
  asaas_id: 'pay_1', pix_qr_code: 'PIX', client_request_id: 'regularizacao:e1:2026-07',
  plano_id: 'p1', preco_unitario_snapshot: null, quantidade_snapshot: null, empresa_id: EMPRESA,
};

function criarSupabaseMock({ ambiente = 'sandbox', empresaTipo = 'autonomo' } = {}) {
  function builder(tabela) {
    const api = {
      select() { return api; },
      eq() { return api; },
      single() {
        if (tabela === 'configuracoes') return Promise.resolve({ data: { dados: { integracao_asaas: { environment: ambiente, apiKey: 'k' } } }, error: null });
        if (tabela === 'empresas') return Promise.resolve({ data: empresaTipo ? { id: EMPRESA, tipo: empresaTipo } : null, error: empresaTipo ? null : new Error('x') });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() { return api.single(); },
    };
    return api;
  }
  return { from: builder };
}

function carregarRouter({ supabase, servicoResultado }) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  const chamadas = { servico: [] };
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabase;
      if (request === 'axios') return { async get() { return { data: {} }; }, async post() { return { data: {} }; } };
      if (request === '../services/regularizacaoService') {
        return {
          async gerarFaturaRegularizacao(args) {
            chamadas.servico.push(args);
            return servicoResultado;
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const router = require(routerPath);
    router.__chamadas = chamadas;
    return router;
  } finally {
    Module._load = originalLoad;
  }
}

function acharRoute(router, method, path) {
  for (const layer of router.stack) {
    const r = layer.route;
    if (r && r.path === path && r.methods[method]) return r;
  }
  throw new Error(`Rota ${method} ${path} não encontrada`);
}
function getHandler(router, method, path) {
  const r = acharRoute(router, method, path);
  return r.stack[r.stack.length - 1].handle;
}
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const GERADA = { resultado: 'gerada', motivo: 'ok', periodo: '2026-07-01', fatura: FATURA_COMPLETA };

// ── guards ───────────────────────────────────────────────────────────────────
test('POST /me/regularizacao exige verifyToken+verificarEmpresa; /regularizacao/:empresa_id exige super-admin', () => {
  const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado: GERADA });
  const me = acharRoute(router, 'post', '/me/regularizacao');
  const handlesMe = me.stack.map((l) => l.handle);
  assert.equal(handlesMe[0], verifyToken);
  assert.equal(handlesMe[1], verificarEmpresa);
  const admin = acharRoute(router, 'post', '/regularizacao/:empresa_id');
  const handlesAdmin = admin.stack.map((l) => l.handle);
  assert.equal(handlesAdmin[0], verifyToken);
  assert.equal(handlesAdmin[1], isSuperAdmin);
});

// ── gate sandbox fail-closed ─────────────────────────────────────────────────
test('ambiente production → 403 sem chamar o serviço (as duas rotas)', async () => {
  for (const [path, req] of [
    ['/me/regularizacao', { user: { uid: 'u1' }, empresa_id: EMPRESA }],
    ['/regularizacao/:empresa_id', { user: { uid: 'sa', is_super_admin: true }, params: { empresa_id: EMPRESA } }],
  ]) {
    const router = carregarRouter({ supabase: criarSupabaseMock({ ambiente: 'production' }), servicoResultado: GERADA });
    const res = fakeRes();
    await getHandler(router, 'post', path)(req, res, () => {});
    assert.equal(res.statusCode, 403, path);
    assert.equal(router.__chamadas.servico.length, 0, path);
  }
});

// ── gate de tipo: app só autônomo ────────────────────────────────────────────
test('/me/regularizacao: empresa transportadora → 403 sem chamar serviço', async () => {
  const router = carregarRouter({ supabase: criarSupabaseMock({ empresaTipo: 'transportadora' }), servicoResultado: GERADA });
  const res = fakeRes();
  await getHandler(router, 'post', '/me/regularizacao')({ user: { uid: 'u1' }, empresa_id: EMPRESA }, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.equal(router.__chamadas.servico.length, 0);
});

test('/me/regularizacao sem empresa_id → 400', async () => {
  const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado: GERADA });
  const res = fakeRes();
  await getHandler(router, 'post', '/me/regularizacao')({ user: { uid: 'u1' }, empresa_id: null }, res, () => {});
  assert.equal(res.statusCode, 400);
});

// ── mapeamento resultado→HTTP + whitelist ────────────────────────────────────
test('gerada → 201 com fatura whitelistada (sem campos sensíveis)', async () => {
  const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado: GERADA });
  const res = fakeRes();
  await getHandler(router, 'post', '/me/regularizacao')({ user: { uid: 'u1' }, empresa_id: EMPRESA }, res, () => {});
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.resultado, 'gerada');
  const chaves = Object.keys(res.body.fatura);
  for (const proibido of ['asaas_id', 'pix_qr_code', 'client_request_id', 'plano_id', 'preco_unitario_snapshot', 'quantidade_snapshot', 'empresa_id']) {
    assert.equal(chaves.includes(proibido), false, `vazou ${proibido}`);
  }
  assert.equal(res.body.fatura.invoice_url, FATURA_COMPLETA.invoice_url);
  // Serviço recebeu a empresa do token, nunca do body.
  assert.equal(router.__chamadas.servico[0].empresaId, EMPRESA);
});

test('fatura_aberta e idempotente → 200 com a fatura; pulada → 422 com mensagem', async () => {
  for (const [servicoResultado, esperado] of [
    [{ resultado: 'fatura_aberta', motivo: 'fatura_aberta_existente', fatura: FATURA_COMPLETA }, 200],
    [{ resultado: 'idempotente', motivo: 'regularizacao_ja_existe', fatura: FATURA_COMPLETA }, 200],
    [{ resultado: 'pulada', motivo: 'suspensao_nao_financeira' }, 422],
    [{ resultado: 'pulada', motivo: 'plano_gratuito' }, 422],
  ]) {
    const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado });
    const res = fakeRes();
    await getHandler(router, 'post', '/me/regularizacao')({ user: { uid: 'u1' }, empresa_id: EMPRESA }, res, () => {});
    assert.equal(res.statusCode, esperado, servicoResultado.motivo);
    if (esperado === 422) assert.ok(res.body.message, 'pulada precisa de mensagem amigável');
  }
});

test('super-admin: usa o empresa_id do path e devolve os mesmos contratos', async () => {
  const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado: GERADA });
  const res = fakeRes();
  await getHandler(router, 'post', '/regularizacao/:empresa_id')(
    { user: { uid: 'sa', is_super_admin: true }, params: { empresa_id: 'outra-empresa' } }, res, () => {});
  assert.equal(res.statusCode, 201);
  assert.equal(router.__chamadas.servico[0].empresaId, 'outra-empresa');
});

test('erro do serviço → 500 sem vazar detalhes', async () => {
  const router = carregarRouter({ supabase: criarSupabaseMock(), servicoResultado: { resultado: 'erro', motivo: 'falha_criar_cobranca_asaas' } });
  const res = fakeRes();
  await getHandler(router, 'post', '/me/regularizacao')({ user: { uid: 'u1' }, empresa_id: EMPRESA }, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Erro ao gerar fatura de regularização.');
});

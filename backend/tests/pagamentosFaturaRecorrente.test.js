// Frente #5 (Billing v2) — PR 3 (Commit 2): rota POST /pagamentos/faturas-recorrentes/gerar.
// Testa a CAMADA DE ROTA: guards (verifyToken/isSuperAdmin), gate sandbox ANTES
// do serviço, roteamento empresa_id vs lote, limite e agregação do resumo.
// A coreografia real (Asaas/DB) é coberta por faturaRecorrenteService.test.js —
// aqui o serviço é MOCKADO para observar como a rota o aciona.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');

const CAMPOS_EMPRESA_FAKE =
  'id, status, asaas_customer_id, asaas_subscription_id, plano_id, nome, cnpj, email_contato, telefone_contato';

// ── Mock supabase (configuracoes + empresas) ────────────────────────────────
function criarSupabaseMock({ environment = 'sandbox', empresa = null, empresas = [], empresaError = null } = {}) {
  const q = { limitArg: null, eq: {}, isNull: {} };

  function builder(tabela) {
    const ctx = { tabela, maybe: false };
    const b = {
      select() { return b; },
      eq(c, v) { q.eq[c] = v; return b; },
      is(c, v) { q.isNull[c] = v; return b; },
      limit(n) { q.limitArg = n; return b; },
      order() { return b; },
      maybeSingle() { ctx.maybe = true; return resolve(ctx); },
      single() { return resolve(ctx); },
      then(onF, onR) { return resolve(ctx).then(onF, onR); },
    };
    return b;
  }

  async function resolve(ctx) {
    if (ctx.tabela === 'configuracoes') {
      return { data: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment } } }, error: null };
    }
    if (ctx.tabela === 'empresas') {
      // empresa_id usa maybeSingle → objeto; lote usa then → array.
      if (ctx.maybe) return { data: empresa, error: empresaError };
      return { data: empresas, error: empresaError };
    }
    return { data: null, error: null };
  }

  return { from: (t) => builder(t), _q: q };
}

// ── Mock axios (não deve ser usado; o serviço é mockado) ─────────────────────
function criarAxiosMock() {
  const chamadas = { posts: [], gets: [] };
  return {
    chamadas,
    async post(url, body) { chamadas.posts.push({ url, body }); return { data: {} }; },
    async get(url) { chamadas.gets.push({ url }); return { data: {} }; },
  };
}

// ── Spy do serviço de fatura recorrente ──────────────────────────────────────
function criarServicoSpy(resumo) {
  const calls = [];
  return {
    calls,
    modulo: {
      CAMPOS_EMPRESA: CAMPOS_EMPRESA_FAKE,
      gerarFaturaRecorrenteEmLote: async (args) => {
        calls.push(args);
        return resumo || { periodo: '2026-08-01', geradas: [], puladas: [], erros: [] };
      },
    },
  };
}

function carregarRouter(supabaseMock, axiosMock, servicoMock) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === 'axios') return axiosMock;
      if (request === '../services/faturaRecorrenteService') return servicoMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
  }
}

const ROTA = '/faturas-recorrentes/gerar';

function acharLayer(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method.toLowerCase()]) return route;
  }
  throw new Error(`Rota não encontrada: ${method} ${path}`);
}

function getHandler(router) {
  const route = acharLayer(router, 'POST', ROTA);
  return route.stack[route.stack.length - 1].handle;
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const superAdmin = { uid: 'sa1', role: 'admin', is_super_admin: true };

async function chamar({ cenario = {}, resumo, req }) {
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock();
  const spy = criarServicoSpy(resumo);
  const router = carregarRouter(supabase, axios, spy.modulo);
  const handler = getHandler(router);
  const res = fakeRes();
  await handler(req, res, () => {});
  return { res, supabase, axios, spy };
}

// ── 1 & 7. Guards presentes e na ordem (verifyToken → isSuperAdmin → handler) ──
test('rota exige verifyToken e isSuperAdmin antes do handler (gate de auth)', () => {
  const supabase = criarSupabaseMock();
  const router = carregarRouter(supabase, criarAxiosMock(), criarServicoSpy().modulo);
  const route = acharLayer(router, 'POST', ROTA);
  const handles = route.stack.map((l) => l.handle);
  assert.equal(handles.length, 3, 'esperado [verifyToken, isSuperAdmin, handler]');
  assert.equal(handles[0], verifyToken);
  assert.equal(handles[1], isSuperAdmin);
});

// ── 2 & 7. Gate sandbox ANTES do serviço ─────────────────────────────────────
test('environment=production → 403 e o serviço NÃO é chamado', async () => {
  const { res, spy, axios } = await chamar({
    cenario: { environment: 'production' },
    req: { user: superAdmin, body: { empresa_id: 'e1' } },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(spy.calls.length, 0);       // serviço não chamado
  assert.equal(axios.chamadas.posts.length, 0);
});

// ── 3. dry_run apenas avalia (serviço em modo dryRun, sem Asaas) ─────────────
test('dry_run=true → serviço chamado com dryRun true e sem uso de Asaas', async () => {
  const { res, spy, axios } = await chamar({
    cenario: { environment: 'sandbox', empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null } },
    req: { user: superAdmin, body: { empresa_id: 'e1', dry_run: true } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].dryRun, true);
  assert.equal(axios.chamadas.posts.length, 0);
  assert.equal(axios.chamadas.gets.length, 0);
});

// ── 4. empresa_id processa só aquela empresa ─────────────────────────────────
test('empresa_id → serviço recebe exatamente 1 empresa (a informada)', async () => {
  const { res, spy } = await chamar({
    cenario: { environment: 'sandbox', empresa: { id: 'e-alvo', status: 'ativo', asaas_subscription_id: null } },
    req: { user: superAdmin, body: { empresa_id: 'e-alvo' } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(spy.calls[0].empresas.length, 1);
  assert.equal(spy.calls[0].empresas[0].id, 'e-alvo');
  assert.equal(spy.calls[0].dryRun, false);
});

test('empresa_id inexistente → 404 e serviço não chamado', async () => {
  const { res, spy } = await chamar({
    cenario: { environment: 'sandbox', empresa: null },
    req: { user: superAdmin, body: { empresa_id: 'nao-existe' } },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(spy.calls.length, 0);
});

// ── 5. Lote sem empresa_id respeita limite e filtra ativas sem assinatura ─────
test('lote respeita limite e filtra status=ativo + asaas_subscription_id null', async () => {
  const { res, spy, supabase } = await chamar({
    cenario: {
      environment: 'sandbox',
      empresas: [{ id: 'a', status: 'ativo', asaas_subscription_id: null }, { id: 'b', status: 'ativo', asaas_subscription_id: null }],
    },
    req: { user: superAdmin, body: { limite: 5 } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(supabase._q.limitArg, 5);                       // limite aplicado na query
  assert.equal(supabase._q.eq.status, 'ativo');                // só ativas
  assert.equal(supabase._q.isNull.asaas_subscription_id, null);// sem assinatura Asaas
  assert.equal(spy.calls[0].empresas.length, 2);
});

test('limite ausente usa default conservador (20) e acima do teto é limitado a 100', async () => {
  const a = await chamar({ cenario: { environment: 'sandbox', empresas: [] }, req: { user: superAdmin, body: {} } });
  assert.equal(a.supabase._q.limitArg, 20);
  const b = await chamar({ cenario: { environment: 'sandbox', empresas: [] }, req: { user: superAdmin, body: { limite: 9999 } } });
  assert.equal(b.supabase._q.limitArg, 100);
});

// ── 6. Resposta agrega geradas/puladas/erros ─────────────────────────────────
test('resposta repassa o resumo agregado do serviço', async () => {
  const resumo = {
    periodo: '2026-08-01',
    geradas: [{ empresa_id: 'a', resultado: 'gerada' }],
    puladas: [{ empresa_id: 'b', motivo: 'plano_gratuito' }],
    erros: [{ empresa_id: 'c', motivo: 'falha_criar_cobranca_asaas' }],
  };
  const { res } = await chamar({
    cenario: { environment: 'sandbox', empresas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    resumo,
    req: { user: superAdmin, body: {} },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.periodo, '2026-08-01');
  assert.equal(res.body.geradas.length, 1);
  assert.equal(res.body.puladas.length, 1);
  assert.equal(res.body.erros.length, 1);
});

// ── 8. Rota não fala com assinatura Asaas ────────────────────────────────────
test('rota não chama /subscriptions nem garantirAssinatura', async () => {
  const { axios } = await chamar({
    cenario: { environment: 'sandbox', empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null } },
    req: { user: superAdmin, body: { empresa_id: 'e1' } },
  });
  assert.equal(axios.chamadas.posts.some((p) => /\/subscriptions/.test(p.url)), false);
  assert.equal(axios.chamadas.gets.some((g) => /\/subscriptions/.test(g.url)), false);
});

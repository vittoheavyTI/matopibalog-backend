// Frente #5 (Billing v2) — PR 0 da tela de faturas no app: rota
// GET /pagamentos/me/faturas (read-only, autônomo). Testa a CAMADA DE ROTA com
// supabase mockado: gate de tipo (autonomo), isolamento tenant, whitelist de
// colunas, ordenação e ausência de escrita/Asaas/sync.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');

// tenant.js faz `require('../config/supabase')` no topo, e o config real aborta
// sem env. Carregamos os middlewares sob um mock dummy só para CAPTURAR suas
// referências (usadas na asserção dos guards). Nunca EXECUTAMOS o middleware nos
// testes — chamamos o handler direto com req.empresa_id já setado.
let verifyToken, verificarEmpresa;
{
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    verifyToken = require('../middlewares/auth').verifyToken;
    verificarEmpresa = require('../middlewares/tenant').verificarEmpresa;
  } finally {
    Module._load = originalLoad;
  }
}

const EMPRESA_AUTONOMO = 'e5afecd6-2335-4436-86a7-0dfb495b9cbc';
const EMPRESA_OUTRA = 'c5d513be-9058-4ffa-88fd-b3695b3ca325';

// Colunas que a rota DEVE retornar (whitelist aprovada).
const CAMPOS_PERMITIDOS = [
  'id', 'valor', 'tipo_pagamento', 'status', 'due_date', 'pago_em',
  'invoice_url', 'bank_slip_url', 'periodo_referencia', 'origem',
  'plano_nome_snapshot', 'modelo_cobranca_snapshot', 'created_at',
];
// Colunas sensíveis que NUNCA podem vazar.
const CAMPOS_PROIBIDOS = [
  'asaas_id', 'pix_qr_code', 'client_request_id', 'plano_id',
  'preco_unitario_snapshot', 'quantidade_snapshot', 'asaas_subscription_id',
];

// Fatura "de banco" completa (com campos sensíveis) usada para provar que o
// SELECT whitelista: o mock aplica a projeção de colunas pedida no .select().
function faturaCompleta(over = {}) {
  return {
    id: 'fat-1', empresa_id: EMPRESA_AUTONOMO, valor: 149.99, tipo_pagamento: 'PIX',
    status: 'pendente', due_date: '2026-07-27', pago_em: null,
    invoice_url: 'https://sandbox.asaas.com/i/1', bank_slip_url: null,
    periodo_referencia: '2026-07-01', origem: 'recorrente',
    plano_nome_snapshot: 'Plano Profissional', modelo_cobranca_snapshot: 'fixo',
    created_at: '2026-07-20T00:00:00Z',
    // sensíveis (não devem sair):
    asaas_id: 'pay_zz', pix_qr_code: 'PIX-COPIA', client_request_id: 'recorrente:e1:2026-07',
    plano_id: 'p-pro', preco_unitario_snapshot: null, quantidade_snapshot: null,
    asaas_subscription_id: null,
    ...over,
  };
}

// ── Mock supabase ────────────────────────────────────────────────────────────
// Suporta: from('empresas').select().eq().single()  e
//          from('faturas').select(cols).eq('empresa_id',v).order().order() (array)
// O builder de faturas registra o filtro empresa_id e a lista de colunas do
// select, e devolve SOMENTE essas colunas (simula a projeção do PostgREST).
function criarSupabaseMock({ empresa, empresaError = null, faturas = [], faturasError = null } = {}) {
  const registro = { escritas: 0, selectFaturasCols: null, faturasEqEmpresa: null, orders: [] };

  function builderEmpresas() {
    const b = {
      select() { return b; },
      eq() { return b; },
      single() { return Promise.resolve({ data: empresa ?? null, error: empresaError }); },
    };
    return b;
  }

  function projetar(row, cols) {
    const out = {};
    for (const c of cols) out[c] = row[c];
    return out;
  }

  function builderFaturas() {
    let cols = [];
    const b = {
      select(c) { cols = String(c).split(',').map((s) => s.trim()); registro.selectFaturasCols = cols; return b; },
      eq(k, v) { if (k === 'empresa_id') registro.faturasEqEmpresa = v; return b; },
      order(col, opts) { registro.orders.push({ col, opts }); return b; },
      then(onF, onR) {
        if (faturasError) return Promise.resolve({ data: null, error: faturasError }).then(onF, onR);
        // Filtra por empresa_id (isolamento) e projeta as colunas do select.
        const filtradas = faturas
          .filter((f) => registro.faturasEqEmpresa == null || f.empresa_id === registro.faturasEqEmpresa)
          .map((f) => projetar(f, cols));
        return Promise.resolve({ data: filtradas, error: null }).then(onF, onR);
      },
    };
    return b;
  }

  return {
    __registro: registro,
    from(tabela) {
      if (tabela === 'empresas') return builderEmpresas();
      if (tabela === 'faturas') return builderFaturas();
      // Qualquer outra tabela sinaliza uso inesperado (escrita/Asaas/etc.).
      registro.escritas += 1;
      return { select() { return this; }, insert() { registro.escritas += 1; return this; }, update() { registro.escritas += 1; return this; }, delete() { registro.escritas += 1; return this; }, eq() { return this; }, single() { return Promise.resolve({ data: null, error: null }); }, then(r) { r({ data: null, error: null }); } };
    },
  };
}

function criarAxiosMock() {
  const chamadas = { posts: [], gets: [] };
  return { chamadas, async post(u) { chamadas.posts.push(u); return { data: {} }; }, async get(u) { chamadas.gets.push(u); return { data: {} }; } };
}

function carregarRouter(supabaseMock, axiosMock) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === 'axios') return axiosMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
  }
}

const ROTA = '/me/faturas';
function acharRoute(router) {
  for (const layer of router.stack) {
    const r = layer.route;
    if (r && r.path === ROTA && r.methods.get) return r;
  }
  throw new Error('Rota não encontrada');
}
function getHandler(router) { const r = acharRoute(router); return r.stack[r.stack.length - 1].handle; }
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
async function chamar(cenario, req) {
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock();
  const router = carregarRouter(supabase, axios);
  const res = fakeRes();
  await getHandler(router)(req, res, () => {});
  return { res, supabase, axios };
}

// ── 1. Guards: verifyToken + verificarEmpresa antes do handler ───────────────
test('rota exige verifyToken e verificarEmpresa (sem isAdmin)', () => {
  const router = carregarRouter(criarSupabaseMock({}), criarAxiosMock());
  const route = acharRoute(router);
  const handles = route.stack.map((l) => l.handle);
  assert.equal(handles.length, 3, 'esperado [verifyToken, verificarEmpresa, handler]');
  assert.equal(handles[0], verifyToken);
  assert.equal(handles[1], verificarEmpresa);
});

// ── 2. Autônomo → só as faturas da própria empresa ───────────────────────────
test('empresa autonomo → retorna faturas da própria empresa', async () => {
  const { res } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' }, faturas: [faturaCompleta()] },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body), true);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'fat-1');
});

// ── 3. Vinculado (transportadora) → 403 com mensagem clara ───────────────────
test('empresa nao-autonomo → 403 com mensagem clara, sem consultar faturas', async () => {
  const { res, supabase } = await chamar(
    { empresa: { id: EMPRESA_OUTRA, tipo: 'transportadora' }, faturas: [faturaCompleta({ empresa_id: EMPRESA_OUTRA })] },
    { user: { uid: 'u2' }, empresa_id: EMPRESA_OUTRA },
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /apenas para autônomos/i);
  assert.equal(supabase.__registro.selectFaturasCols, null); // nem chegou a ler faturas
});

// ── 4. Sem faturas → [] ──────────────────────────────────────────────────────
test('autonomo sem faturas → lista vazia', async () => {
  const { res } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' }, faturas: [] },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);
});

// ── 5. Ordenação: due_date desc, depois created_at desc ──────────────────────
test('ordena por due_date desc e created_at desc', async () => {
  const { supabase } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' }, faturas: [faturaCompleta()] },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  const orders = supabase.__registro.orders;
  assert.equal(orders[0].col, 'due_date');
  assert.equal(orders[0].opts.ascending, false);
  assert.equal(orders[1].col, 'created_at');
  assert.equal(orders[1].opts.ascending, false);
});

// ── 6. Whitelist de campos — não vaza sensíveis ──────────────────────────────
test('whitelist: retorna só campos permitidos, nunca sensíveis', async () => {
  const { res, supabase } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' }, faturas: [faturaCompleta()] },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  // O SELECT pediu exatamente a whitelist.
  assert.deepEqual(supabase.__registro.selectFaturasCols.sort(), [...CAMPOS_PERMITIDOS].sort());
  // E o objeto retornado não contém nenhum campo proibido.
  const chaves = Object.keys(res.body[0]);
  for (const proibido of CAMPOS_PROIBIDOS) {
    assert.equal(chaves.includes(proibido), false, `vazou campo sensível: ${proibido}`);
  }
});

// ── 7 & 8 & 9. Não chama Asaas, não sincroniza, não escreve ──────────────────
test('read-only: não chama Asaas, não sincroniza, não escreve', async () => {
  const { supabase, axios } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' }, faturas: [faturaCompleta()] },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  assert.equal(axios.chamadas.posts.length, 0);
  assert.equal(axios.chamadas.gets.length, 0);
  assert.equal(supabase.__registro.escritas, 0); // só leu empresas + faturas
});

// ── 10. Isolamento tenant — filtra por empresa_id do token ───────────────────
test('isolamento tenant: só faturas da empresa do token', async () => {
  const { res, supabase } = await chamar(
    {
      empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' },
      faturas: [
        faturaCompleta({ id: 'minha', empresa_id: EMPRESA_AUTONOMO }),
        faturaCompleta({ id: 'de-outra', empresa_id: EMPRESA_OUTRA }),
      ],
    },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  assert.equal(supabase.__registro.faturasEqEmpresa, EMPRESA_AUTONOMO);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'minha');
});

// ── empresa não encontrada → 404 ─────────────────────────────────────────────
test('empresa inexistente → 404', async () => {
  const { res } = await chamar(
    { empresa: null },
    { user: { uid: 'u1' }, empresa_id: EMPRESA_AUTONOMO },
  );
  assert.equal(res.statusCode, 404);
});

// ── sem empresa_id (token sem empresa) → 400 ─────────────────────────────────
test('sem empresa_id → 400', async () => {
  const { res } = await chamar(
    { empresa: { id: EMPRESA_AUTONOMO, tipo: 'autonomo' } },
    { user: { uid: 'u1' }, empresa_id: null },
  );
  assert.equal(res.statusCode, 400);
});

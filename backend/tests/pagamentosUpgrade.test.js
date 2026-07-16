// Frente #8-C (Billing v2 / Macrofrente 1) — PR 2: rota POST /pagamentos/upgrade/solicitar.
// Testa a CAMADA DE ROTA (gate sandbox, empresa_id, mapeamento de status HTTP),
// injetando supabase/axios mockados via Module._load (padrão de pagamentosCobrancas).
// A lógica de negócio já é coberta por upgradeRequestService.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');

const PLANO_NOVO_UUID = '11111111-1111-1111-1111-111111111111';

function empresaBase(over = {}) {
  return {
    id: 'e1',
    status: 'ativo',
    plano_id: 'p-basico',
    asaas_customer_id: 'cus_1',
    nome: 'Empresa Alfa',
    cnpj: '12345678000199',
    email_contato: 'alfa@example.com',
    telefone_contato: '',
    planos: { id: 'p-basico', nome: 'Plano Básico', preco_mensal: 49.9 },
    ...over,
  };
}
const PLANO_NOVO = { id: PLANO_NOVO_UUID, nome: 'Plano Profissional', preco_mensal: 99.9, ativo: true };

// ── Mock supabase (configuracoes + tabelas do fluxo) ─────────────────────────
function criarSupabaseMock(cenario = {}) {
  const registro = { inserts: [], updates: [] };
  let solSeq = 0, fatSeq = 0;

  function builder(tabela) {
    const ctx = { tabela, filtros: {}, op: 'select', payload: null, maybe: false };
    const b = {
      select() { return b; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; registro.inserts.push({ tabela, payload: p }); return b; },
      update(p) { ctx.op = 'update'; ctx.payload = p; registro.updates.push({ tabela, payload: p }); return b; },
      eq(c, v) { ctx.filtros[c] = v; return b; },
      order() { return b; },
      limit() { return b; },
      in() { return b; },
      single() { return resolve(ctx); },
      maybeSingle() { ctx.maybe = true; return resolve(ctx); },
      then(onF, onR) { return resolve(ctx).then(onF, onR); },
    };
    return b;
  }

  async function resolve(ctx) {
    const { tabela, op, filtros, payload } = ctx;
    if (tabela === 'configuracoes') {
      const environment = cenario.environment || 'sandbox';
      return { data: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment } } }, error: null };
    }
    if (tabela === 'empresas' && op === 'select') {
      return { data: cenario.empresa ?? null, error: cenario.empresaError ?? null };
    }
    if (tabela === 'empresas' && op === 'update') return { data: null, error: null };
    if (tabela === 'planos' && op === 'select') {
      return { data: cenario.planoNovo ?? null, error: null };
    }
    if (tabela === 'solicitacoes_upgrade_plano') {
      if (op === 'insert') { solSeq += 1; return { data: { id: `sol-${solSeq}`, status: 'pendente', ...payload }, error: null }; }
      if (op === 'update') return { data: null, error: null };
      if (ctx.maybe) return { data: cenario.solicRecuperada ?? null, error: null };
      return { data: cenario.pendentes ?? [], error: null };
    }
    if (tabela === 'faturas') {
      if (op === 'insert') { fatSeq += 1; return { data: { id: `fat-${fatSeq}`, ...payload }, error: null }; }
      if (filtros.id) return { data: cenario.faturaById ?? null, error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  return { from: (t) => builder(t), __registro: registro };
}

// ── Mock axios ────────────────────────────────────────────────────────────────
function criarAxiosMock(cenario = {}) {
  const chamadas = { post: 0, get: 0 };
  return {
    chamadas,
    async post(url) {
      chamadas.post += 1;
      if (/\/customers$/.test(url)) return { data: { id: 'cus_new' } };
      if (cenario.asaasPaymentError) throw cenario.asaasPaymentError;
      return { data: cenario.asaasPayment || { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' } };
    },
    async get(url) {
      chamadas.get += 1;
      if (/\/pixQrCode$/.test(url)) return { data: { payload: 'PIX-COPIA-COLA' } };
      return { data: {} };
    },
  };
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

function getHandler(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method.toLowerCase()]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`Handler não encontrado: ${method} ${path}`);
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const adminComum = { uid: 'u1', role: 'admin', is_super_admin: false };

async function chamar(cenario, req) {
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/upgrade/solicitar');
  const res = fakeRes();
  await handler(req, res, () => {});
  return { res, supabase, axios };
}

// ── Testes ───────────────────────────────────────────────────────────────────

test('gate sandbox: environment=production → 403 e nenhum payment', async () => {
  const { res, axios } = await chamar(
    { environment: 'production', empresa: empresaBase(), planoNovo: PLANO_NOVO, pendentes: [] },
    { user: adminComum, empresa_id: 'e1', body: { plano_novo_id: PLANO_NOVO_UUID } }
  );
  assert.equal(res.statusCode, 403);
  assert.equal(axios.chamadas.post, 0);
});

test('empresa_id ausente → 400', async () => {
  const { res } = await chamar(
    { empresa: empresaBase(), planoNovo: PLANO_NOVO, pendentes: [] },
    { user: adminComum, empresa_id: null, body: { plano_novo_id: PLANO_NOVO_UUID } }
  );
  assert.equal(res.statusCode, 400);
});

test('sucesso: 201 com solicitacao + fatura + redirect', async () => {
  const { res, axios } = await chamar(
    { empresa: empresaBase(), planoNovo: PLANO_NOVO, pendentes: [] },
    { user: adminComum, empresa_id: 'e1', body: { plano_novo_id: PLANO_NOVO_UUID, client_request_id: 'req-r1' } }
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.solicitacao_id, 'sol-1');
  assert.equal(res.body.fatura.id, 'fat-1');
  assert.equal(res.body.redirect, '/minhas-faturas');
  assert.equal(axios.chamadas.post, 1); // um único payment
});

test('empresa suspensa → 409 regularizacaoNecessaria', async () => {
  const { res, axios } = await chamar(
    { empresa: empresaBase({ status: 'suspenso' }), planoNovo: PLANO_NOVO, pendentes: [] },
    { user: adminComum, empresa_id: 'e1', body: { plano_novo_id: PLANO_NOVO_UUID } }
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.regularizacaoNecessaria, true);
  assert.equal(res.body.redirect, '/minhas-faturas');
  assert.equal(axios.chamadas.post, 0);
});

test('downgrade → 422 planoInvalido', async () => {
  const { res, axios } = await chamar(
    {
      empresa: empresaBase({ planos: { id: 'p-pro', nome: 'Pro', preco_mensal: 199.9 } }),
      planoNovo: { id: PLANO_NOVO_UUID, nome: 'Menor', preco_mensal: 99.9, ativo: true },
      pendentes: [],
    },
    { user: adminComum, empresa_id: 'e1', body: { plano_novo_id: PLANO_NOVO_UUID } }
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.planoInvalido, true);
  assert.equal(axios.chamadas.post, 0);
});

test('idempotência: pendente do mesmo plano com fatura → 200', async () => {
  const { res, axios } = await chamar(
    {
      empresa: empresaBase(),
      planoNovo: PLANO_NOVO,
      pendentes: [{ id: 'sol-9', status: 'pendente', plano_novo_id: PLANO_NOVO_UUID, fatura_id: 'fat-9' }],
      faturaById: { id: 'fat-9', valor: 99.9, tipo_pagamento: 'PIX', status: 'pendente', invoice_url: 'u', pix_qr_code: 'p', due_date: '2026-07-23' },
    },
    { user: adminComum, empresa_id: 'e1', body: { plano_novo_id: PLANO_NOVO_UUID } }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotente, true);
  assert.equal(res.body.fatura.id, 'fat-9');
  assert.equal(axios.chamadas.post, 0);
});

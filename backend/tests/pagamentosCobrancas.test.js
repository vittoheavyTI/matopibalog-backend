const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');

// ── Mock do supabase ─────────────────────────────────────────────────────────
// Query-builder encadeável. Distingue as chamadas por tabela e pelos filtros
// aplicados (client_request_id vs id). Registra inserts/updates para asserção.
function criarSupabaseMock(cenario) {
  const registro = { inserts: [], updates: [] };

  function builder(tabela) {
    const ctx = { tabela, filtros: {}, op: 'select', payload: null };
    const api = {
      select() { return api; },
      insert(payload) { ctx.op = 'insert'; ctx.payload = payload; registro.inserts.push({ tabela, payload }); return api; },
      update(payload) { ctx.op = 'update'; ctx.payload = payload; registro.updates.push({ tabela, payload }); return api; },
      eq(col, val) { ctx.filtros[col] = val; return api; },
      single() { return resolver(ctx); },
      maybeSingle() { return resolver(ctx); },
      // empresas.update(...).eq(...) é aguardado sem terminal → thenable no-op.
      then(resolve) { resolve({ data: null, error: null }); },
    };

    async function resolver() {
      const { tabela, filtros, op, payload } = ctx;
      if (op === 'insert') {
        if (cenario.insertError) return { data: null, error: cenario.insertError };
        return { data: { id: 'fatura-nova', ...payload }, error: null };
      }
      if (op === 'update') {
        if (tabela === 'faturas') return { data: { ...(cenario.faturaById || {}), ...payload }, error: null };
        return { data: null, error: null };
      }
      if (tabela === 'configuracoes') return { data: cenario.config || { dados: {} }, error: null };
      if (tabela === 'faturas') {
        if ('client_request_id' in filtros) return { data: cenario.faturaPorClientRequest ?? null, error: null };
        if ('id' in filtros) {
          return cenario.faturaById
            ? { data: cenario.faturaById, error: null }
            : { data: null, error: { code: 'PGRST116' } };
        }
      }
      if (tabela === 'empresas') {
        return cenario.empresa
          ? { data: cenario.empresa, error: null }
          : { data: null, error: { code: 'PGRST116' } };
      }
      return { data: null, error: null };
    }

    return api;
  }

  return { from: builder, __registro: registro };
}

// ── Mock do axios ────────────────────────────────────────────────────────────
function criarAxiosMock(cenario) {
  const chamadas = { post: 0, get: 0 };
  return {
    chamadas,
    async post() {
      chamadas.post += 1;
      return { data: cenario.asaasPayment || { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' } };
    },
    async get(url) {
      chamadas.get += 1;
      if (/\/pixQrCode$/.test(url)) return { data: cenario.pixQr || { payload: 'PIXCOPIACOLA' } };
      return { data: cenario.asaasPaymentGet || { id: 'pay_1', status: 'RECEIVED' } };
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

// Extrai o handler FINAL de uma rota (ignora verifyToken/isSuperAdmin: testamos
// a lógica de negócio chamando o handler com req.user já autenticado).
function getHandler(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method.toLowerCase()]) {
      const stack = route.stack;
      return stack[stack.length - 1].handle;
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

const superAdmin = { is_super_admin: true, role: 'super_admin' };

// ── Testes ───────────────────────────────────────────────────────────────────

test('criação: status PENDING do Asaas é gravado como pendente', async () => {
  const cenario = {
    faturaPorClientRequest: null,
    empresa: { asaas_customer_id: 'cus_1', nome: 'Empresa X' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    asaasPayment: { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas');

  const res = fakeRes();
  await handler({ user: superAdmin, body: { empresa_id: 'e1', valor: 100, tipo: 'BOLETO', client_request_id: 'req-1' } }, res, () => {});

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'pendente');
  assert.equal(res.body.client_request_id, 'req-1');
  const insert = supabase.__registro.inserts.find((i) => i.tabela === 'faturas');
  assert.equal(insert.payload.status, 'pendente');
  assert.equal(insert.payload.asaas_id, 'pay_1');
});

test('criação PIX: busca e grava o copia-e-cola em pix_qr_code', async () => {
  const cenario = {
    faturaPorClientRequest: null,
    empresa: { asaas_customer_id: 'cus_1', nome: 'Empresa X' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste' } } },
    asaasPayment: { id: 'pay_2', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_2' },
    pixQr: { payload: 'PIX-COPIA-E-COLA-123' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas');

  const res = fakeRes();
  await handler({ user: superAdmin, body: { empresa_id: 'e1', valor: 50, tipo: 'PIX', client_request_id: 'req-pix' } }, res, () => {});

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.pix_qr_code, 'PIX-COPIA-E-COLA-123');
  assert.equal(axios.chamadas.get, 1); // buscou o QR
});

test('idempotência: client_request_id repetido devolve a fatura e NÃO chama o Asaas', async () => {
  const faturaExistente = { id: 'f-old', asaas_id: 'pay_old', status: 'pendente', client_request_id: 'req-1' };
  const cenario = { faturaPorClientRequest: faturaExistente };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas');

  const res = fakeRes();
  await handler({ user: superAdmin, body: { empresa_id: 'e1', valor: 100, tipo: 'BOLETO', client_request_id: 'req-1' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotente, true);
  assert.equal(res.body.id, 'f-old');
  assert.equal(axios.chamadas.post, 0); // nenhuma cobrança nova no Asaas
  assert.equal(supabase.__registro.inserts.length, 0);
});

test('conciliação: RECEIVED marca fatura paga e empresa ativa', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', status: 'pendente', pago_em: null },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste' } } },
    asaasPaymentGet: { id: 'pay_1', status: 'RECEIVED' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas/:id/conciliar');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' }, body: {} }, res, () => {});

  assert.equal(res.body.status, 'pago');
  const updFatura = supabase.__registro.updates.find((u) => u.tabela === 'faturas');
  assert.equal(updFatura.payload.status, 'pago');
  assert.ok(updFatura.payload.pago_em, 'deve preencher pago_em');
  const updEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.equal(updEmpresa.payload.status, 'ativo');
});

test('conciliação: OVERDUE marca fatura vencida e empresa suspensa', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', status: 'pendente', pago_em: null },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste' } } },
    asaasPaymentGet: { id: 'pay_1', status: 'OVERDUE' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas/:id/conciliar');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' }, body: {} }, res, () => {});

  assert.equal(res.body.status, 'vencido');
  const updEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.equal(updEmpresa.payload.status, 'suspenso');
});

test('conciliação: fatura sem asaas_id retorna 400', async () => {
  const cenario = { faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: null, status: 'pendente', pago_em: null } };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas/:id/conciliar');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' }, body: {} }, res, () => {});

  assert.equal(res.statusCode, 400);
});

test('conciliação: fatura inexistente retorna 404', async () => {
  const cenario = { faturaById: null };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas/:id/conciliar');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'nao-existe' }, body: {} }, res, () => {});

  assert.equal(res.statusCode, 404);
});

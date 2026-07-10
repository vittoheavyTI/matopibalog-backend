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
        if ('client_request_id' in filtros) {
          // 1ª leitura = pré-check (nada ainda); 2ª = re-fetch pós-corrida 23505.
          registro.clientReqSelects = (registro.clientReqSelects || 0) + 1;
          if (registro.clientReqSelects === 1) return { data: cenario.faturaPorClientRequest ?? null, error: null };
          return { data: cenario.faturaAposCorrida ?? cenario.faturaPorClientRequest ?? null, error: null };
        }
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
  const chamadas = { post: 0, get: 0, postBodies: [] };
  return {
    chamadas,
    async post(url, body) {
      chamadas.post += 1;
      chamadas.postBodies.push({ url, body });
      if (/\/customers$/.test(url)) {
        if (cenario.clienteAsaasError) throw cenario.clienteAsaasError;
        return { data: cenario.asaasCustomer || { id: 'cus_new' } };
      }
      if (cenario.asaasPaymentError) throw cenario.asaasPaymentError;
      return { data: cenario.asaasPayment || { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' } };
    },
    async get(url) {
      chamadas.get += 1;
      if (/\/pixQrCode$/.test(url)) {
        if (cenario.asaasPaymentError) throw cenario.asaasPaymentError;
        return { data: cenario.pixQr || { payload: 'PIXCOPIACOLA' } };
      }
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

// ── GATE 1: trava hard de sandbox ────────────────────────────────────────────

test('criação em production é bloqueada (403) e NÃO chama o Asaas', async () => {
  const cenario = {
    config: { dados: { integracao_asaas: { apiKey: 'chave-prod', environment: 'production' } } },
    empresa: { asaas_customer_id: 'cus_1', nome: 'Empresa X' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas');

  const res = fakeRes();
  await handler({ user: superAdmin, body: { empresa_id: 'e1', valor: 100, tipo: 'BOLETO', client_request_id: 'req-prod' } }, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /sandbox/i);
  assert.equal(axios.chamadas.post, 0);
  assert.equal(supabase.__registro.inserts.length, 0);
});

test('conciliação em production é bloqueada (403) e NÃO chama o Asaas', async () => {
  const cenario = {
    config: { dados: { integracao_asaas: { apiKey: 'chave-prod', environment: 'production' } } },
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', status: 'pendente', pago_em: null },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas/:id/conciliar');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' }, body: {} }, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /sandbox/i);
  assert.equal(axios.chamadas.get, 0);
  assert.equal(supabase.__registro.updates.length, 0);
});

// ── GATE 3: idempotência por corrida (unique 23505) ──────────────────────────

test('corrida: insert com 23505 devolve a fatura existente (idempotente)', async () => {
  const faturaConcorrente = { id: 'f-concorrente', asaas_id: 'pay_1', status: 'pendente', client_request_id: 'req-corrida' };
  const cenario = {
    faturaPorClientRequest: null,          // pré-check não encontra
    faturaAposCorrida: faturaConcorrente,  // re-fetch pós-23505 encontra
    empresa: { asaas_customer_id: 'cus_1', nome: 'Empresa X' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste' } } },
    asaasPayment: { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' },
    insertError: { code: '23505' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/cobrancas');

  const res = fakeRes();
  await handler({ user: superAdmin, body: { empresa_id: 'e1', valor: 100, tipo: 'BOLETO', client_request_id: 'req-corrida' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotente, true);
  assert.equal(res.body.id, 'f-concorrente');
});

// ── POST /clientes: validação e tradução do erro do Asaas ────────────────────

const configSandbox = { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } };

function chamarClientes(cenario, body) {
  const supabase = criarSupabaseMock({ config: configSandbox, ...cenario });
  const axios = criarAxiosMock({ config: configSandbox, ...cenario });
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/clientes');
  const res = fakeRes();
  return handler({ user: superAdmin, body }, res, () => {}).then(() => ({ res, axios, supabase }));
}

test('clientes: conta sem CPF/CNPJ retorna 400 e NÃO chama o Asaas', async () => {
  const { res, axios } = await chamarClientes({}, { empresa_id: 'e1', nome: 'Empresa X', email: 'x@x.com' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /CPF ou CNPJ/i);
  assert.equal(axios.chamadas.post, 0);
});

test('clientes: CNPJ mascarado é normalizado (só dígitos) antes de enviar', async () => {
  const { res, axios } = await chamarClientes(
    { asaasCustomer: { id: 'cus_ok' } },
    { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12.345.678/0001-95', email: 'x@x.com' }
  );
  assert.equal(res.statusCode, 200);
  const enviado = axios.chamadas.postBodies.find((p) => /\/customers$/.test(p.url));
  assert.equal(enviado.body.cpfCnpj, '12345678000195');
});

test('clientes: documento com dígitos insuficientes retorna 400 e não chama Asaas', async () => {
  const { res, axios } = await chamarClientes({}, { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '123', email: 'x@x.com' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /CPF ou CNPJ/i);
  assert.equal(axios.chamadas.post, 0);
});

test('clientes: e-mail inválido retorna 400 claro', async () => {
  const { res, axios } = await chamarClientes({}, { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12345678000195', email: 'sem-arroba' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /e-?mail/i);
  assert.equal(axios.chamadas.post, 0);
});

test('clientes: telefone inválido opcional é omitido, não quebra', async () => {
  const { res, axios } = await chamarClientes(
    { asaasCustomer: { id: 'cus_ok' } },
    { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12345678000195', email: 'x@x.com', telefone: '123' }
  );
  assert.equal(res.statusCode, 200);
  const enviado = axios.chamadas.postBodies.find((p) => /\/customers$/.test(p.url));
  assert.equal(enviado.body.phone, undefined);
});

test('clientes: erro do Asaas em CPF/CNPJ vira 422 traduzido, sem vazar payload', async () => {
  const { res } = await chamarClientes(
    { clienteAsaasError: { response: { status: 400, data: { errors: [{ description: 'O CPF/CNPJ informado é inválido.' }] } } } },
    { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12345678000195', email: 'x@x.com' }
  );
  assert.equal(res.statusCode, 422);
  assert.match(res.body.message, /CPF\/CNPJ.*Asaas/i);
  assert.equal(res.body.error, undefined); // não vaza payload/segredo
});

test('clientes: cliente válido cria no Asaas e salva asaas_customer_id', async () => {
  const { res, axios, supabase } = await chamarClientes(
    { asaasCustomer: { id: 'cus_123' } },
    { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12345678000195', email: 'x@x.com', telefone: '(77) 99999-8888' }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.customer_id, 'cus_123');
  const enviado = axios.chamadas.postBodies.find((p) => /\/customers$/.test(p.url));
  assert.equal(enviado.body.phone, '77999998888'); // telefone válido normalizado
  const upd = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.equal(upd.payload.asaas_customer_id, 'cus_123');
});

test('clientes: em production é bloqueado (403) sem chamar Asaas', async () => {
  const { res, axios } = await chamarClientes(
    { config: { dados: { integracao_asaas: { environment: 'production' } } } },
    { empresa_id: 'e1', nome: 'Empresa X', cpfCnpj: '12345678000195', email: 'x@x.com' }
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /sandbox/i);
  assert.equal(axios.chamadas.post, 0);
});

// ── GET /pagamentos/faturas/:id/pix — Pix sob demanda ────────────────────────────

test('pix sob demanda: sempre consulta o Asaas mesmo se pix_qr_code legado existe', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', tipo_pagamento: 'BOLETO', pix_qr_code: 'PIX-LEGADO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    pixQr: { encodedImage: 'BASE64_IMAGE', payload: 'PIX-PAYLOAD-ATUAL', expirationDate: '2026-07-16T23:59:59Z' },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.encoded_image, 'BASE64_IMAGE');
  assert.equal(res.body.payload, 'PIX-PAYLOAD-ATUAL');
  assert.equal(res.body.expiration_date, '2026-07-16T23:59:59Z');
  // Confirma que chamou o Asaas (axios.get chamado)
  assert.equal(axios.chamadas.get, 1);
  // Confirma que NÃO retornou o legado
  assert.notEqual(res.body.payload, 'PIX-LEGADO');
  // Confirma que NÃO fez UPDATE em faturas
  const updates = supabase.__registro.updates.filter(u => u.tabela === 'faturas');
  assert.equal(updates.length, 0);
});

test('pix sob demanda: sem encodedImage retorna null mas payload atual', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', tipo_pagamento: 'PIX', pix_qr_code: 'PIX-LEGADO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    pixQr: { payload: 'PIX-PAYLOAD-ATUAL', expirationDate: '2026-07-16T23:59:59Z' }, // sem encodedImage
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.encoded_image, null);
  assert.equal(res.body.payload, 'PIX-PAYLOAD-ATUAL');
  assert.equal(res.body.expiration_date, '2026-07-16T23:59:59Z');
  assert.equal(axios.chamadas.get, 1);
});

test('pix sob demanda: erro do Asaas retorna 502 sanitizado', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', tipo_pagamento: 'BOLETO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    asaasPaymentError: { response: { status: 404, data: { errors: [{ description: 'Payment not found' }] } } },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.message, 'Erro ao consultar Pix no Asaas.');
});

test('pix sob demanda: tenant cross-account bloqueado (403)', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e2', asaas_id: 'pay_1', tipo_pagamento: 'BOLETO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  // Admin comum (não super-admin) tentando acessar fatura de outra empresa
  const adminComum = { is_super_admin: false, role: 'admin', uid: 'u1' };
  // Mock do usuário retornar empresa_id diferente
  const supabaseWithUsuario = criarSupabaseMock({
    ...cenario,
    usuario: { empresa_id: 'e1' }, // diferente de e2
  });
  const router2 = carregarRouter(supabaseWithUsuario, axios);
  const handler2 = getHandler(router2, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler2({ user: adminComum, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Acesso negado.');
});

test('pix sob demanda: tipo não suportado retorna 400', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', tipo_pagamento: 'CARTAO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Esta cobrança não suporta Pix.');
});

test('pix sob demanda: sem asaas_id retorna 400', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: null, tipo_pagamento: 'BOLETO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Fatura sem cobrança Asaas vinculada.');
});

test('pix sob demanda: fatura inexistente retorna 404', async () => {
  const cenario = { faturaById: null };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'nao-existe' } }, res, () => {});

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Fatura não encontrada.');
});

test('pix sob demanda: ignora pix_qr_code legado e sempre consulta Asaas', async () => {
  const cenario = {
    faturaById: {
      id: 'f1',
      empresa_id: 'e1',
      asaas_id: 'pay_1',
      tipo_pagamento: 'BOLETO',
      pix_qr_code: 'PIX_LEGADO_NAO_DEVE_SER_USADO'
    },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    pixQr: {
      encodedImage: 'BASE64_IMAGEM_REAL',
      payload: 'PIX_COPIA_COLA_ATUAL',
      expirationDate: '2026-07-16T15:00:00Z'
    },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(axios.chamadas.get, 1);
  assert.equal(res.body.encoded_image, 'BASE64_IMAGEM_REAL');
  assert.equal(res.body.payload, 'PIX_COPIA_COLA_ATUAL');
  assert.equal(res.body.expiration_date, '2026-07-16T15:00:00Z');
  assert.notEqual(res.body.payload, 'PIX_LEGADO_NAO_DEVE_SER_USADO');
  assert.notEqual(res.body.encoded_image, 'PIX_LEGADO_NAO_DEVE_SER_USADO');
  assert.equal(supabase.__registro.updates.filter(u => u.tabela === 'faturas').length, 0);
  assert.equal(supabase.__registro.inserts.filter(i => i.tabela === 'faturas').length, 0);
});

test('pix sob demanda: sem encodedImage retorna null mas payload atual disponível', async () => {
  const cenario = {
    faturaById: {
      id: 'f1',
      empresa_id: 'e1',
      asaas_id: 'pay_1',
      tipo_pagamento: 'BOLETO',
      pix_qr_code: 'PIX_LEGADO'
    },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'sandbox' } } },
    pixQr: {
      payload: 'PIX_APENAS_PAYLOAD',
      expirationDate: '2026-07-16T15:00:00Z'
    },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.encoded_image, null);
  assert.equal(res.body.payload, 'PIX_APENAS_PAYLOAD');
  assert.equal(res.body.expiration_date, '2026-07-16T15:00:00Z');
  assert.equal(supabase.__registro.updates.filter(u => u.tabela === 'faturas').length, 0);
  assert.equal(supabase.__registro.inserts.filter(i => i.tabela === 'faturas').length, 0);
});

test('pix sob demanda: em production bloqueado (403) sem chamar Asaas', async () => {
  const cenario = {
    faturaById: { id: 'f1', empresa_id: 'e1', asaas_id: 'pay_1', tipo_pagamento: 'BOLETO' },
    config: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment: 'production' } } },
  };
  const supabase = criarSupabaseMock(cenario);
  const axios = criarAxiosMock(cenario);
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'GET', '/faturas/:id/pix');

  const res = fakeRes();
  await handler({ user: superAdmin, params: { id: 'f1' } }, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /sandbox/i);
  assert.equal(axios.chamadas.get, 0);
});

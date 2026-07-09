const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
  garantirAssinatura,
  conciliarAssinatura,
  calcularPrimeiroVencimento,
  BILLING_STATES,
} = require('../services/asaasSubscriptionService');

// ── Fakes por injeção de dependência (sem tocar rede/DB) ─────────────────────

// Supabase fake: empresas.select().eq().single() devolve cenario.empresa;
// updates são capturados. Erro de persistência só quando pedido e só no update
// que grava asaas_subscription_id (para simular "assinatura criada, banco falhou").
function fakeSupabase(cenario) {
  const capture = [];
  function from(table) {
    const ctx = { table, op: 'select', payload: null };
    const api = {
      select() { return api; },
      update(p) { ctx.op = 'update'; ctx.payload = p; capture.push({ table, payload: p }); return api; },
      eq() { return api; },
      single() {
        if (table === 'empresas') {
          return Promise.resolve({ data: cenario.empresa || null, error: cenario.empresa ? null : { code: 'PGRST116' } });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve) {
        let error = null;
        if (ctx.table === 'empresas' && ctx.payload && ctx.payload.asaas_subscription_id && cenario.subscriptionPersistError) {
          error = cenario.subscriptionPersistError;
        }
        resolve({ data: null, error });
      },
    };
    return api;
  }
  return { from, __capture: capture };
}

// HTTP fake do Asaas. Roteia por URL e registra chamadas.
function fakeHttp(cenario) {
  const calls = { customersPost: 0, subscriptionsPost: 0, subGet: 0, subList: 0, payments: 0, bodies: [] };
  return {
    calls,
    async get(url, opts) {
      if (/\/payments$/.test(url)) { calls.payments += 1; return { data: cenario.payments || { data: [], totalCount: 0 } }; }
      if (/\/subscriptions\/[^/]+$/.test(url)) {
        calls.subGet += 1;
        if (cenario.subGet404) { const e = new Error('not found'); e.response = { status: 404 }; throw e; }
        if (cenario.subGetError) throw cenario.subGetError;
        return { data: cenario.subGet || null };
      }
      if (/\/subscriptions$/.test(url)) {
        calls.subList += 1;
        return { data: { data: cenario.subByRef ? [cenario.subByRef] : [] } };
      }
      return { data: null };
    },
    async post(url, body) {
      calls.bodies.push({ url, body });
      if (/\/customers$/.test(url)) {
        calls.customersPost += 1;
        if (cenario.customerError) throw cenario.customerError;
        return { data: cenario.customer || { id: 'cus_new' } };
      }
      if (/\/subscriptions$/.test(url)) {
        calls.subscriptionsPost += 1;
        if (cenario.subCreateError) throw cenario.subCreateError;
        return { data: cenario.subCreated || { id: 'sub_new', status: 'ACTIVE', nextDueDate: '2026-08-01' } };
      }
      return { data: {} };
    },
  };
}

const config = { apiKey: 'chave-teste', baseURL: 'https://sandbox.asaas.com/api/v3' };

function contaCompleta(over = {}) {
  return {
    id: 'e1', nome: 'Empresa X', cnpj: '12345678000195', email_contato: 'x@x.com',
    telefone_contato: '77999998888', tipo: 'transportadora', status: 'trial',
    trial_ends_at: '2999-01-10T00:00:00.000Z', plano_id: 'p1',
    asaas_customer_id: null, asaas_subscription_id: null, billing_status: null, next_due_date: null,
    planos: { nome: 'Plano Profissional', preco_mensal: 99.9, billing_cycle: 'MONTHLY' },
    ...over,
  };
}

// ── calcularPrimeiroVencimento ───────────────────────────────────────────────

test('vencimento: trial futuro é usado como nextDueDate', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento('2026-07-20T00:00:00Z', ref), '2026-07-20');
});

test('vencimento: trial vencido → hoje + 7', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento('2026-06-01T00:00:00Z', ref), '2026-07-15');
});

test('vencimento: trial ausente → hoje + 7', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento(null, ref), '2026-07-15');
});

test('vencimento: trial inválido → hoje + 7', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento('lixo-nao-data', ref), '2026-07-15');
});

test('vencimento: trial == hoje → hoje + 7 (nunca hoje/retroativo)', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento('2026-07-08T23:00:00Z', ref), '2026-07-15');
});

test('vencimento: virada de mês/ano no fallback', () => {
  const ref = new Date('2026-12-28T12:00:00Z');
  assert.equal(calcularPrimeiroVencimento(null, ref), '2027-01-04');
});

test('vencimento: resultado nunca fica no passado', () => {
  const ref = new Date('2026-07-08T12:00:00Z');
  const hoje = '2026-07-08';
  for (const t of [null, 'lixo', '2020-01-01T00:00:00Z', '2026-07-08T10:00:00Z', '2027-03-01T00:00:00Z']) {
    assert.ok(calcularPrimeiroVencimento(t, ref) > hoje, `falhou para ${t}`);
  }
});

// ── garantirAssinatura: plano/isento/sem conta ───────────────────────────────

test('conta inexistente → 404', async () => {
  const supabase = fakeSupabase({ empresa: null });
  const http = fakeHttp({});
  await assert.rejects(
    () => garantirAssinatura({ empresaId: 'e0', config, supabase, http }),
    (e) => e.httpStatus === 404
  );
  assert.equal(http.calls.subscriptionsPost, 0);
});

test('conta sem plano → sem_plano, NÃO cria assinatura', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ plano_id: null, planos: null }) });
  const http = fakeHttp({});
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.SEM_PLANO);
  assert.equal(r.subscription_configured, false);
  assert.equal(http.calls.customersPost, 0);
  assert.equal(http.calls.subscriptionsPost, 0);
});

test('plano gratuito (preço 0) → isento, NÃO cria assinatura paga', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ planos: { nome: 'Free', preco_mensal: 0, billing_cycle: 'MONTHLY' } }) });
  const http = fakeHttp({});
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.ISENTO);
  assert.equal(http.calls.subscriptionsPost, 0);
});

// ── garantirAssinatura: criação feliz ────────────────────────────────────────

test('plano válido: valor vem do backend e assinatura é criada uma vez', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1' }) });
  const http = fakeHttp({ subCreated: { id: 'sub_1', status: 'ACTIVE', nextDueDate: '2999-01-10' } });
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.ATIVO);
  assert.equal(r.created_subscription, true);
  assert.equal(http.calls.subscriptionsPost, 1);
  const body = http.calls.bodies.find((b) => /\/subscriptions$/.test(b.url)).body;
  assert.equal(body.value, 99.9);           // valor do backend, não do cliente
  assert.equal(body.billingType, 'PIX');
  assert.equal(body.cycle, 'MONTHLY');
  assert.equal(body.externalReference, 'e1'); // referência estável
  assert.match(body.description, /Matopiba Log — Plano Profissional/);
});

test('nextDueDate vem do trial futuro', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', trial_ends_at: '2999-01-10T00:00:00Z' }) });
  const http = fakeHttp({});
  await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  const body = http.calls.bodies.find((b) => /\/subscriptions$/.test(b.url)).body;
  assert.equal(body.nextDueDate, '2999-01-10');
});

test('customer existente é reutilizado (sem novo POST /customers)', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_existente' }) });
  const http = fakeHttp({});
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(http.calls.customersPost, 0);
  assert.equal(r.created_customer, false);
  const body = http.calls.bodies.find((b) => /\/subscriptions$/.test(b.url)).body;
  assert.equal(body.customer, 'cus_existente');
});

test('customer ausente é criado uma vez e salvo', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: null }) });
  const http = fakeHttp({ customer: { id: 'cus_criado' } });
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(http.calls.customersPost, 1);
  assert.equal(r.created_customer, true);
  const salvou = supabase.__capture.find((u) => u.payload.asaas_customer_id === 'cus_criado');
  assert.ok(salvou, 'deve salvar asaas_customer_id');
});

test('assinatura existente ACTIVE é reutilizada (idempotente, não recria nem altera)', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_ok' }) });
  const http = fakeHttp({ subGet: { id: 'sub_ok', status: 'ACTIVE', nextDueDate: '2999-02-01' } });
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.ATIVO);
  assert.equal(r.created_subscription, false);
  assert.equal(http.calls.subscriptionsPost, 0); // upgrade/downgrade: assinatura NÃO é alterada aqui
  assert.match(r.mensagem, /já configurada/i);
});

test('assinatura existente INATIVA não é reativada em silêncio', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_x' }) });
  const http = fakeHttp({ subGet: { id: 'sub_x', status: 'EXPIRED', nextDueDate: '2026-01-01' } });
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.INATIVO);
  assert.equal(http.calls.subscriptionsPost, 0);
});

// ── Reconciliação / falhas / não-duplicação ──────────────────────────────────

test('reconciliação preventiva: assinatura já existe no Asaas por externalReference → adota sem criar', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: null }) });
  const http = fakeHttp({ subByRef: { id: 'sub_ref', status: 'ACTIVE', nextDueDate: '2999-03-01' } });
  const r = await garantirAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.created_subscription, false);
  assert.equal(http.calls.subscriptionsPost, 0);
  const salvou = supabase.__capture.find((u) => u.payload.asaas_subscription_id === 'sub_ref');
  assert.ok(salvou, 'deve vincular o id recuperado');
});

test('id de assinatura local órfão (404) e sem reconciliação → erro 409, não cria duplicata', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_sumiu' }) });
  const http = fakeHttp({ subGet404: true, subByRef: null });
  await assert.rejects(
    () => garantirAssinatura({ empresaId: 'e1', config, supabase, http }),
    (e) => e.httpStatus === 409
  );
  assert.equal(http.calls.subscriptionsPost, 0);
});

test('falha ao criar assinatura NÃO duplica customer (retry reutiliza)', async () => {
  // 1ª chamada: customer criado, assinatura falha.
  const sup1 = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: null }) });
  const http1 = fakeHttp({ customer: { id: 'cus_z' }, subCreateError: { response: { status: 500 } } });
  await assert.rejects(() => garantirAssinatura({ empresaId: 'e1', config, supabase: sup1, http: http1 }));
  assert.equal(http1.calls.customersPost, 1);
  assert.ok(sup1.__capture.find((u) => u.payload.asaas_customer_id === 'cus_z'), 'customer salvo antes da falha');
  assert.ok(sup1.__capture.find((u) => u.payload.billing_status === BILLING_STATES.PENDENTE_ASSINATURA));

  // 2ª chamada (retry): empresa já tem customer → não recria.
  const sup2 = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_z' }) });
  const http2 = fakeHttp({ subCreated: { id: 'sub_ok', status: 'ACTIVE', nextDueDate: '2999-01-10' } });
  await garantirAssinatura({ empresaId: 'e1', config, supabase: sup2, http: http2 });
  assert.equal(http2.calls.customersPost, 0);
});

test('falha ao persistir a assinatura → erro; retry NÃO recria (reconcilia por referência)', async () => {
  // 1ª chamada: assinatura criada no Asaas, mas o banco falha ao salvar o id.
  const sup1 = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1' }), subscriptionPersistError: { code: '500' } });
  const http1 = fakeHttp({ subCreated: { id: 'sub_criada', status: 'ACTIVE', nextDueDate: '2999-01-10' } });
  await assert.rejects(
    () => garantirAssinatura({ empresaId: 'e1', config, supabase: sup1, http: http1 }),
    (e) => e.httpStatus === 500 && /reconciliar/i.test(e.message)
  );
  assert.ok(sup1.__capture.find((u) => u.payload.billing_status === BILLING_STATES.ERRO));

  // 2ª chamada (retry): id local ainda nulo, mas a assinatura existe no Asaas por referência → adota, não recria.
  const sup2 = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: null }) });
  const http2 = fakeHttp({ subByRef: { id: 'sub_criada', status: 'ACTIVE', nextDueDate: '2999-01-10' } });
  const r2 = await garantirAssinatura({ empresaId: 'e1', config, supabase: sup2, http: http2 });
  assert.equal(http2.calls.subscriptionsPost, 0);
  assert.equal(r2.billing_status, BILLING_STATES.ATIVO);
});

// ── Tradução de erro do Asaas / não-vazamento ────────────────────────────────

test('Asaas 400 na criação do cliente → 422 traduzido, sem vazar payload/segredo', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: null }) });
  const http = fakeHttp({ customerError: { response: { status: 400, data: { errors: [{ description: 'documento invalido cru' }] } } } });
  await assert.rejects(
    () => garantirAssinatura({ empresaId: 'e1', config, supabase, http }),
    (e) => {
      assert.equal(e.httpStatus, 422);
      assert.doesNotMatch(e.message, /documento invalido cru/); // não vaza descrição bruta
      assert.doesNotMatch(e.message, /chave-teste/);            // não vaza apiKey
      return true;
    }
  );
});

test('Asaas 401 → 422 traduzido genérico', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1' }) });
  const http = fakeHttp({ subCreateError: { response: { status: 401 } } });
  await assert.rejects(
    () => garantirAssinatura({ empresaId: 'e1', config, supabase, http }),
    (e) => e.httpStatus === 422
  );
});

// ── conciliarAssinatura (read-only) ──────────────────────────────────────────

test('conciliar: sem assinatura → count 0 e não configurada', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_subscription_id: null, billing_status: 'sem_plano' }) });
  const http = fakeHttp({});
  const r = await conciliarAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.subscription_configured, false);
  assert.equal(r.subscription_payments_count, 0);
});

test('conciliar: assinatura ACTIVE sincroniza e conta cobranças (sem importar p/ faturas)', async () => {
  const supabase = fakeSupabase({ empresa: contaCompleta({ asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_ok' }) });
  const http = fakeHttp({ subGet: { id: 'sub_ok', status: 'ACTIVE', nextDueDate: '2999-05-01' }, payments: { totalCount: 3, data: [1, 2, 3] } });
  const r = await conciliarAssinatura({ empresaId: 'e1', config, supabase, http });
  assert.equal(r.billing_status, BILLING_STATES.ATIVO);
  assert.equal(r.subscription_payments_count, 3);
  // Nenhum insert em faturas (o serviço não escreve em faturas).
  assert.equal(supabase.__capture.filter((u) => u.table === 'faturas').length, 0);
});

// ── GATE de sandbox no nível da ROTA (production → 403, sem tocar Asaas) ──────

const routerPath = require.resolve('../routes/pagamentos');
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
function supabaseConfig(environment) {
  return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { dados: { integracao_asaas: { environment } } }, error: null }) }) }) }) };
}
function axiosContador() {
  const chamadas = { post: 0, get: 0 };
  return { chamadas, async post() { chamadas.post += 1; return { data: {} }; }, async get() { chamadas.get += 1; return { data: {} }; } };
}

test('garantir em production → 403 e NÃO chama o Asaas', async () => {
  const supabase = supabaseConfig('production');
  const axios = axiosContador();
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/assinaturas/:empresa_id/garantir');
  const res = fakeRes();
  await handler({ user: { is_super_admin: true }, params: { empresa_id: 'e1' }, body: {} }, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /sandbox/i);
  assert.equal(axios.chamadas.post, 0);
  assert.equal(axios.chamadas.get, 0);
});

test('conciliar em production → 403 e NÃO chama o Asaas', async () => {
  const supabase = supabaseConfig('production');
  const axios = axiosContador();
  const router = carregarRouter(supabase, axios);
  const handler = getHandler(router, 'POST', '/assinaturas/:empresa_id/conciliar');
  const res = fakeRes();
  await handler({ user: { is_super_admin: true }, params: { empresa_id: 'e1' }, body: {} }, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.equal(axios.chamadas.get, 0);
});

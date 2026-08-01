const test = require('node:test');
const assert = require('node:assert/strict');

const {
  criarCobrancaImplantacaoPositiva,
  validarSandboxImplantacao,
} = require('../services/implantacaoCobrancaService');

function supabaseMock({ faturaExistente = null } = {}) {
  const state = {
    inserts: [],
    updates: [],
    fatura: faturaExistente,
  };

  function resolver(ctx) {
    if (ctx.tabela === 'empresas') {
      return { data: { id: ctx.filtros.id, nome: 'Empresa Teste', asaas_customer_id: 'cus_123' }, error: null };
    }

    if (ctx.tabela !== 'faturas') return { data: null, error: null };

    if (ctx.op === 'select') {
      return { data: state.fatura, error: null };
    }

    if (ctx.op === 'insert') {
      state.inserts.push(ctx.payload);
      state.fatura = { id: 'fat_impl_1', ...ctx.payload };
      return { data: state.fatura, error: null };
    }

    if (ctx.op === 'update') {
      state.updates.push(ctx.payload);
      state.fatura = { ...state.fatura, ...ctx.payload };
      return { data: state.fatura, error: null };
    }

    return { data: null, error: null };
  }

  return {
    state,
    from(tabela) {
      const ctx = { tabela, op: 'select', payload: null, filtros: {} };
      const api = {
        select() { return api; },
        eq(col, val) { ctx.filtros[col] = val; return api; },
        maybeSingle: async () => resolver(ctx),
        single: async () => resolver(ctx),
        insert(payload) { ctx.op = 'insert'; ctx.payload = payload; return api; },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return api; },
      };
      return api;
    },
  };
}

function httpMock() {
  const calls = { get: [], post: [] };
  return {
    calls,
    async get(url, opts) {
      calls.get.push({ url, opts });
      if (url.endsWith('/payments')) return { data: { data: [] } };
      if (url.includes('/pixQrCode')) return { data: { payload: 'pix-copia-e-cola' } };
      return { data: {} };
    },
    async post(url, payload, opts) {
      calls.post.push({ url, payload, opts });
      return {
        data: {
          id: 'pay_impl_1',
          status: 'PENDING',
          invoiceUrl: 'https://sandbox.example/invoice',
          bankSlipUrl: null,
        },
      };
    },
  };
}

const propostaGratis = {
  snapshot: {
    plano_id: 'plano-1',
    plano_nome: 'Empresa Start',
    valor_implantacao: 0,
    implantacao_gratis: true,
  },
};

const propostaPositiva = {
  snapshot: {
    plano_id: 'plano-1',
    plano_nome: 'Empresa Start',
    valor_implantacao: 299,
    implantacao_gratis: false,
  },
};

const configSandbox = {
  environment: 'sandbox',
  baseURL: 'https://sandbox.asaas.com/api/v3',
  apiKey: 'sandbox-key',
};

test('implantacao gratis nao cria fatura nem chama provedor de pagamento', async () => {
  const supabase = supabaseMock();
  const http = httpMock();

  const r = await criarCobrancaImplantacaoPositiva({
    supabase,
    http,
    config: { environment: 'production' },
    empresaId: 'emp-1',
    proposta: propostaGratis,
  });

  assert.equal(r.resultado, 'pulada');
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(http.calls.post.length, 0);
});

test('implantacao positiva cria cobranca avulsa separada da mensalidade', async () => {
  const supabase = supabaseMock();
  const http = httpMock();

  const r = await criarCobrancaImplantacaoPositiva({
    supabase,
    http,
    config: configSandbox,
    empresaId: 'emp-1',
    proposta: propostaPositiva,
    dueDate: '2026-08-01',
  });

  assert.equal(r.resultado, 'gerada');
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].origem, 'implantacao');
  assert.equal(supabase.state.inserts[0].periodo_referencia, null);
  assert.equal(supabase.state.inserts[0].client_request_id, 'implantacao:emp-1');
  assert.equal(http.calls.post.length, 1);
  assert.equal(http.calls.post[0].payload.externalReference, 'implantacao:emp-1');
  assert.match(http.calls.post[0].payload.description, /^Implantacao Matopiba Log/);
  assert.equal(r.fatura.asaas_id, 'pay_impl_1');
});

test('implantacao positiva reaproveita fatura existente por idempotencia', async () => {
  const supabase = supabaseMock({
    faturaExistente: {
      id: 'fat_existente',
      empresa_id: 'emp-1',
      origem: 'implantacao',
      periodo_referencia: null,
      client_request_id: 'implantacao:emp-1',
      asaas_id: 'pay_existente',
    },
  });
  const http = httpMock();

  const r = await criarCobrancaImplantacaoPositiva({
    supabase,
    http,
    config: configSandbox,
    empresaId: 'emp-1',
    proposta: propostaPositiva,
  });

  assert.equal(r.resultado, 'idempotente');
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(http.calls.post.length, 0);
});

test('implantacao positiva bloqueia fora do sandbox antes de gravar', async () => {
  const supabase = supabaseMock();
  const http = httpMock();

  assert.throws(
    () => validarSandboxImplantacao({ environment: 'production' }),
    /sandbox_obrigatorio/
  );

  await assert.rejects(
    criarCobrancaImplantacaoPositiva({
      supabase,
      http,
      config: { environment: 'production' },
      empresaId: 'emp-1',
      proposta: propostaPositiva,
    }),
    /sandbox_obrigatorio/
  );
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(http.calls.post.length, 0);
});

// Coreografia de I/O da fatura de regularização: reserva-primeiro, corrida
// 23505, reconciliação por externalReference, normalização do motivo de
// suspensão e ausência de dupla cobrança. supabase/http mockados.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../services/regularizacaoService');

const EMPRESA = 'e1';
const CONFIG = { apiKey: 'k', baseURL: 'https://sandbox.asaas.com/api/v3' };

function empresaRow(over = {}) {
  return {
    id: EMPRESA,
    status: 'suspenso',
    suspension_reason: 'financial',
    suspension_source: 'automatic',
    trial_ends_at: null,
    asaas_customer_id: 'cus_1',
    asaas_subscription_id: null,
    plano_id: 'p1',
    nome: 'José Motora',
    cnpj: '39053344705',
    email_contato: 'jose@example.com',
    telefone_contato: '11999998888',
    planos: { id: 'p1', nome: 'Plano Básico', ativo: true, arquivado_em: null, preco_mensal: 99.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5 },
    ...over,
  };
}

// Mock supabase que cobre as consultas do serviço: empresas (maybeSingle),
// faturas abertas (.in → thenable), insert de fatura, update de fatura/empresa,
// busca por client_request_id.
function criarSupabaseMock({ empresa, faturasAbertas = [], insertError = null, faturaPorClientRequest = null } = {}) {
  const registro = { inserts: [], updates: [] };

  function builder(tabela) {
    const ctx = { filtros: {}, op: 'select', payload: null };
    const api = {
      select() { return api; },
      insert(payload) { ctx.op = 'insert'; ctx.payload = payload; registro.inserts.push({ tabela, payload }); return api; },
      update(payload) { ctx.op = 'update'; ctx.payload = payload; return api; },
      eq(col, val) { ctx.filtros[col] = val; return api; },
      in() { return api; },
      maybeSingle() { return resolver(); },
      single() { return resolver(); },
      then(onF, onR) {
        // faturas abertas (select .in sem terminal) e updates aguardados
        if (ctx.op === 'update') {
          registro.updates.push({ tabela, payload: ctx.payload, filtros: { ...ctx.filtros } });
          return Promise.resolve({ data: null, error: null }).then(onF, onR);
        }
        return Promise.resolve({ data: faturasAbertas, error: null }).then(onF, onR);
      },
    };

    async function resolver() {
      if (ctx.op === 'insert') {
        if (insertError) return { data: null, error: insertError };
        return { data: { id: 'fat-nova', ...ctx.payload }, error: null };
      }
      if (ctx.op === 'update') {
        registro.updates.push({ tabela, payload: ctx.payload, filtros: { ...ctx.filtros } });
        if (tabela === 'faturas') return { data: { id: ctx.filtros.id || 'fat-nova', ...ctx.payload }, error: null };
        return { data: null, error: null };
      }
      if (tabela === 'empresas') return { data: empresa ?? null, error: null };
      if (tabela === 'faturas' && 'client_request_id' in ctx.filtros) {
        return { data: faturaPorClientRequest, error: null };
      }
      return { data: null, error: null };
    }

    return api;
  }

  return { from: builder, __registro: registro };
}

function criarHttpMock({ paymentExistente = null } = {}) {
  const chamadas = { posts: [], gets: [] };
  return {
    chamadas,
    async get(url, opts) {
      chamadas.gets.push({ url, opts });
      if (/\/payments$/.test(url)) return { data: { data: paymentExistente ? [paymentExistente] : [] } };
      if (/pixQrCode$/.test(url)) return { data: { payload: 'PIX-COPIA-E-COLA' } };
      return { data: {} };
    },
    async post(url, body) {
      chamadas.posts.push({ url, body });
      if (/\/payments$/.test(url)) {
        return { data: { id: 'pay_novo', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/novo', bankSlipUrl: null } };
      }
      if (/\/customers$/.test(url)) return { data: { id: 'cus_criado' } };
      return { data: {} };
    },
  };
}

function carregarServico() {
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

const { gerarFaturaRegularizacao } = carregarServico();

// ── caminho feliz: suspenso financeiro sem fatura → gera 1 cobrança ──────────
test('gera fatura: reserva local primeiro, depois payment, e completa', async () => {
  const supabase = criarSupabaseMock({ empresa: empresaRow() });
  const http = criarHttpMock();

  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });

  assert.equal(r.resultado, 'gerada');
  // Reserva local nasce sem asaas_id, com origem/chave/snapshot corretos.
  const ins = supabase.__registro.inserts.find((i) => i.tabela === 'faturas');
  assert.equal(ins.payload.asaas_id, null);
  assert.equal(ins.payload.origem, 'regularizacao');
  assert.equal(ins.payload.client_request_id, 'regularizacao:e1:2026-07');
  assert.equal(ins.payload.plano_nome_snapshot, 'Plano Básico');
  // Uma única cobrança criada, com externalReference = chave.
  const posts = http.chamadas.posts.filter((p) => /\/payments$/.test(p.url));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.externalReference, 'regularizacao:e1:2026-07');
  assert.equal(posts[0].body.billingType, 'PIX');
  // Fatura completada com asaas_id.
  const upd = supabase.__registro.updates.find((u) => u.tabela === 'faturas');
  assert.equal(upd.payload.asaas_id, 'pay_novo');
  assert.equal(upd.payload.status, 'pendente');
});

// ── suspensão manual sem motivo é normalizada para financeira ────────────────
test('suspenso reason NULL: normaliza para financial (pagamento poderá reativar)', async () => {
  const supabase = criarSupabaseMock({ empresa: empresaRow({ suspension_reason: null, suspension_source: null }) });
  const http = criarHttpMock();

  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });

  assert.equal(r.resultado, 'gerada');
  const updEmpresa = supabase.__registro.updates.find((u) => u.tabela === 'empresas');
  assert.ok(updEmpresa, 'empresa deve ser normalizada');
  assert.deepEqual(updEmpresa.payload, { suspension_reason: 'financial' });
});

test('suspenso já financial: NÃO toca a empresa', async () => {
  const supabase = criarSupabaseMock({ empresa: empresaRow() });
  const http = criarHttpMock();
  await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });
  assert.equal(supabase.__registro.updates.filter((u) => u.tabela === 'empresas').length, 0);
});

// ── fatura aberta: devolve a existente, zero Asaas, zero insert ──────────────
test('fatura aberta existente → devolve sem criar nada no Asaas', async () => {
  const aberta = { id: 'f-aberta', status: 'pendente', due_date: '2026-07-30', origem: 'recorrente' };
  const supabase = criarSupabaseMock({ empresa: empresaRow(), faturasAbertas: [aberta] });
  const http = criarHttpMock();

  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });

  assert.equal(r.resultado, 'fatura_aberta');
  assert.equal(r.fatura.id, 'f-aberta');
  assert.equal(http.chamadas.posts.length, 0);
  assert.equal(supabase.__registro.inserts.length, 0);
});

// ── corrida 23505: reconcilia em vez de duplicar ─────────────────────────────
test('corrida 23505 com reserva sem asaas_id: reconcilia por externalReference (payment existente, sem POST)', async () => {
  const reserva = { id: 'fat-reservada', asaas_id: null, client_request_id: 'regularizacao:e1:2026-07' };
  const supabase = criarSupabaseMock({
    empresa: empresaRow(),
    insertError: { code: '23505', message: 'duplicate key' },
    faturaPorClientRequest: reserva,
  });
  const http = criarHttpMock({ paymentExistente: { id: 'pay_existente', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/x' } });

  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });

  assert.equal(r.resultado, 'gerada');
  // NÃO criou payment novo: reutilizou o encontrado pela externalReference.
  assert.equal(http.chamadas.posts.filter((p) => /\/payments$/.test(p.url)).length, 0);
  const upd = supabase.__registro.updates.find((u) => u.tabela === 'faturas');
  assert.equal(upd.payload.asaas_id, 'pay_existente');
});

test('corrida 23505 com fatura já completa: idempotente, sem nova cobrança', async () => {
  const completa = { id: 'fat-completa', asaas_id: 'pay_1', client_request_id: 'regularizacao:e1:2026-07', status: 'pendente' };
  const supabase = criarSupabaseMock({
    empresa: empresaRow(),
    insertError: { code: '23505', message: 'duplicate key' },
    faturaPorClientRequest: completa,
  });
  const http = criarHttpMock();

  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });

  assert.equal(r.resultado, 'idempotente');
  assert.equal(r.fatura.id, 'fat-completa');
  assert.equal(http.chamadas.posts.length, 0);
});

// ── puladas ──────────────────────────────────────────────────────────────────
test('estados não elegíveis: nada no Asaas, nada inserido', async () => {
  const casos = [
    empresaRow({ status: 'ativo' }),
    empresaRow({ status: 'suspenso', suspension_reason: 'administrative' }),
    empresaRow({ status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z' }),
    empresaRow({ planos: { ...empresaRow().planos, preco_mensal: 0 } }),
  ];
  for (const empresa of casos) {
    const supabase = criarSupabaseMock({ empresa });
    const http = criarHttpMock();
    const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });
    assert.equal(r.resultado, 'pulada', JSON.stringify({ status: empresa.status, reason: empresa.suspension_reason }));
    assert.equal(http.chamadas.posts.length, 0);
    assert.equal(supabase.__registro.inserts.length, 0);
  }
});

test('trial vencido gera cobrança (primeira mensalidade)', async () => {
  const supabase = criarSupabaseMock({
    empresa: empresaRow({ status: 'trial', suspension_reason: null, suspension_source: null, trial_ends_at: '2026-07-01T00:00:00Z' }),
  });
  const http = criarHttpMock();
  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: EMPRESA, dataReferencia: '2026-07-22' });
  assert.equal(r.resultado, 'gerada');
  // Trial não é suspensão: não normaliza metadados de suspensão.
  assert.equal(supabase.__registro.updates.filter((u) => u.tabela === 'empresas').length, 0);
});

test('empresa inexistente → erro controlado', async () => {
  const supabase = criarSupabaseMock({ empresa: null });
  const http = criarHttpMock();
  const r = await gerarFaturaRegularizacao({ supabase, http, config: CONFIG, empresaId: 'nao-existe', dataReferencia: '2026-07-22' });
  assert.equal(r.resultado, 'erro');
  assert.equal(http.chamadas.posts.length, 0);
});

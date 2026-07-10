const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const jobPath = require.resolve('../jobs/expirarTrials');

function criarSupabaseMock({ empresas = [], fatura = null, faturaError = null, queryError = null } = {}) {
  const chamadas = { updates: [], selects: [] };

  function builder(tabela) {
    const ctx = { tabela, op: 'select', payload: null };
    const api = {
      select(cols) { chamadas.selects.push({ tabela, cols }); return api; },
      update(payload) { ctx.op = 'update'; ctx.payload = payload; chamadas.updates.push({ tabela, payload }); return api; },
      eq() { return api; },
      in() { return api; },
      lt() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() {
        if (tabela === 'faturas') return Promise.resolve({ data: fatura, error: faturaError });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve) {
        if (ctx.op === 'update') return resolve({ data: null, error: null });
        if (tabela === 'empresas') return resolve({ data: empresas, error: queryError });
        return resolve({ data: null, error: null });
      },
    };
    return api;
  }

  return { from: builder, chamadas };
}

function carregarJob(supabaseMock) {
  const originalLoad = Module._load;
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  delete require.cache[jobPath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(jobPath).expirarTrials;
  } finally {
    Module._load = originalLoad;
    process.env.NODE_ENV = originalEnv;
  }
}

const empresaTrial = { id: 'empresa-1', nome: 'Empresa 1', status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };

test('expirarTrials: trial encerrado sem fatura nao suspende', async () => {
  const supabase = criarSupabaseMock({ empresas: [empresaTrial], fatura: null });
  const expirarTrials = carregarJob(supabase);

  await expirarTrials();

  assert.equal(supabase.chamadas.updates.length, 0);
});

test('expirarTrials: trial encerrado com fatura vencida e link suspende', async () => {
  const supabase = criarSupabaseMock({
    empresas: [empresaTrial],
    fatura: {
      id: 'f1',
      empresa_id: 'empresa-1',
      status: 'pendente',
      due_date: '2000-01-01',
      invoice_url: 'https://example.com/pay',
      bank_slip_url: null,
    },
  });
  const expirarTrials = carregarJob(supabase);

  await expirarTrials();

  assert.equal(supabase.chamadas.updates.length, 1);
  assert.deepEqual(supabase.chamadas.updates[0], { tabela: 'empresas', payload: { status: 'suspenso' } });
});

test('expirarTrials: vencimento hoje nao suspende e falha Supabase e fail-safe', async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const supabaseHoje = criarSupabaseMock({
    empresas: [empresaTrial],
    fatura: {
      id: 'f1',
      empresa_id: 'empresa-1',
      status: 'pendente',
      due_date: hoje,
      invoice_url: 'https://example.com/pay',
    },
  });
  await carregarJob(supabaseHoje)();
  assert.equal(supabaseHoje.chamadas.updates.length, 0);

  const supabaseErro = criarSupabaseMock({ empresas: [empresaTrial], faturaError: new Error('db indisponivel') });
  await carregarJob(supabaseErro)();
  assert.equal(supabaseErro.chamadas.updates.length, 0);
});

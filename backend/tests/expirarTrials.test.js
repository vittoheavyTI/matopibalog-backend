const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const jobPath = require.resolve('../jobs/expirarTrials');

function criarSupabaseMock({ empresas = [], fatura = null, faturaError = null, queryError = null, ambiente = null } = {}) {
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
      single() {
        // Config global: define o ambiente Asaas do teste. Default null →
        // não-sandbox → o job NÃO gera fatura (comportamento antigo).
        if (tabela === 'configuracoes') {
          return Promise.resolve({
            data: { dados: { integracao_asaas: ambiente ? { environment: ambiente, apiKey: 'k' } : {} } },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
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

function carregarJob(supabaseMock, { regularizacaoMock = null } = {}) {
  const originalLoad = Module._load;
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  delete require.cache[jobPath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/regularizacaoService' && regularizacaoMock) return regularizacaoMock;
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
  const { tabela, payload } = supabase.chamadas.updates[0];
  assert.equal(tabela, 'empresas');
  // Suspensão financeira automática PRECISA gravar os metadados da 024 —
  // sem reason='financial', o pagamento posterior não reativa a conta.
  assert.equal(payload.status, 'suspenso');
  assert.equal(payload.suspension_reason, 'financial');
  assert.equal(payload.suspension_source, 'automatic');
  assert.ok(payload.suspended_at, 'suspended_at deve ser preenchido');
  assert.equal(payload.suspended_by, null);
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

// ─── Regularização no fim do trial (macrofrente fluxo financeiro) ────────────

test('expirarTrials: sandbox → garante fatura de regularização do trial vencido', async () => {
  const chamadasReg = [];
  const supabase = criarSupabaseMock({ empresas: [empresaTrial], fatura: null, ambiente: 'sandbox' });
  const expirarTrials = carregarJob(supabase, {
    regularizacaoMock: {
      async gerarFaturaRegularizacao(args) {
        chamadasReg.push(args);
        return { resultado: 'gerada', motivo: 'ok', fatura: { id: 'f-reg' } };
      },
    },
  });

  await expirarTrials();

  assert.equal(chamadasReg.length, 1);
  assert.equal(chamadasReg[0].empresaId, 'empresa-1');
  assert.equal(chamadasReg[0].config.baseURL, 'https://sandbox.asaas.com/api/v3');
  // Fatura nova tem vencimento futuro: hoje continua sem suspender.
  assert.equal(supabase.chamadas.updates.length, 0);
});

test('expirarTrials: fora do sandbox NÃO gera cobrança (fail-closed, comportamento antigo)', async () => {
  const chamadasReg = [];
  const supabase = criarSupabaseMock({ empresas: [empresaTrial], fatura: null, ambiente: 'production' });
  const expirarTrials = carregarJob(supabase, {
    regularizacaoMock: {
      async gerarFaturaRegularizacao(args) { chamadasReg.push(args); return { resultado: 'gerada' }; },
    },
  });

  await expirarTrials();

  assert.equal(chamadasReg.length, 0);
  assert.equal(supabase.chamadas.updates.length, 0);
});

test('expirarTrials: falha na regularização NÃO impede a avaliação de suspensão', async () => {
  const supabase = criarSupabaseMock({
    empresas: [empresaTrial],
    ambiente: 'sandbox',
    fatura: {
      id: 'f1',
      empresa_id: 'empresa-1',
      status: 'vencido',
      due_date: '2000-01-05',
      invoice_url: 'https://example.com/pay',
      bank_slip_url: null,
    },
  });
  const expirarTrials = carregarJob(supabase, {
    regularizacaoMock: {
      async gerarFaturaRegularizacao() { throw new Error('asaas fora do ar'); },
    },
  });

  await expirarTrials();

  // A fatura vencida com link continua suspendendo com metadados.
  assert.equal(supabase.chamadas.updates.length, 1);
  assert.equal(supabase.chamadas.updates[0].payload.status, 'suspenso');
  assert.equal(supabase.chamadas.updates[0].payload.suspension_reason, 'financial');
});

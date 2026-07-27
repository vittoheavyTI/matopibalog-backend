const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const jobPath = require.resolve('../jobs/expirarTrials');

// Mock mínimo do supabase-js para o job one-shot. Suporta:
//   empresas.select('*').in('status',[...])              → lista (via then)
//   configuracoes.select('dados').eq('id',1).single()    → ambiente/carência
//   faturas...maybeSingle()                              → fatura elegível
//   empresas.update(...).eq('id',...)                    → registra update
function criarSupabaseMock({ empresas = [], fatura = null, faturaError = null, queryError = null, ambiente = null } = {}) {
  const chamadas = { updates: [], selects: [] };
  function builder(tabela) {
    const ctx = { tabela, op: 'select' };
    const api = {
      select(cols) { chamadas.selects.push({ tabela, cols }); return api; },
      update(payload) { ctx.op = 'update'; chamadas.updates.push({ tabela, payload }); return api; },
      eq() { return api; },
      in() { return api; },
      lt() { return api; },
      order() { return api; },
      limit() { return api; },
      single() {
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

// Carrega o núcleo com o regularizacaoService opcionalmente mockado.
function carregarCore(regularizacaoMock = null) {
  const originalLoad = Module._load;
  delete require.cache[jobPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../services/regularizacaoService' && regularizacaoMock) return regularizacaoMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(jobPath).executarVerificacaoSuspensao;
  } finally {
    Module._load = originalLoad;
  }
}
const rodar = (supabase, regMock) => carregarCore(regMock)({ supabase, http: {} });
const rodarDry = (supabase, regMock) => carregarCore(regMock)({ supabase, http: {}, dryRun: true });

const empresaTrialVencido = { id: 'empresa-1', nome: 'E1', status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' };
const faturaVencidaComLink = { id: 'f1', empresa_id: 'empresa-1', status: 'pendente', due_date: '2000-01-01', invoice_url: 'https://ex/pay', bank_slip_url: null };

test('trial vencido SEM fatura → sem_fatura, não suspende', async () => {
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], fatura: null });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.sem_fatura, 1);
  assert.equal(relatorio.suspensas, 0);
});

test('trial vencido COM fatura vencida (>D+3) + link → suspende com metadados', async () => {
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], fatura: faturaVencidaComLink });
  const { relatorio } = await rodar(supabase);
  assert.equal(relatorio.suspensas, 1);
  const { tabela, payload } = supabase.chamadas.updates[0];
  assert.equal(tabela, 'empresas');
  assert.equal(payload.status, 'suspenso');
  assert.equal(payload.suspension_reason, 'financial');
  assert.equal(payload.suspension_source, 'automatic');
  assert.ok(payload.suspended_at);
  assert.equal(payload.suspended_by, null);
});

test('carência: vencimento recente (dentro de D+3) → dentro_carencia, não suspende', async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const supabase = criarSupabaseMock({
    empresas: [{ id: 'empresa-1', status: 'ativo' }],
    fatura: { id: 'f1', empresa_id: 'empresa-1', status: 'pendente', due_date: hoje, invoice_url: 'https://ex/pay' },
  });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.dentro_carencia, 1);
});

test('extensão manual ativa → prazo_estendido, não suspende (mesmo pós-D+3)', async () => {
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const supabase = criarSupabaseMock({
    empresas: [{ id: 'empresa-1', status: 'ativo', suspensao_prazo_ate: futuro }],
    fatura: faturaVencidaComLink, // due 2000 (bem pós-D+3)
  });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.prazo_estendido, 1);
});

test('conta ATIVA com fatura vencida (>D+3) + link → suspende', async () => {
  const supabase = criarSupabaseMock({
    empresas: [{ id: 'empresa-1', status: 'ativo' }],
    fatura: faturaVencidaComLink,
  });
  const { relatorio } = await rodar(supabase);
  assert.equal(relatorio.suspensas, 1);
  assert.equal(supabase.chamadas.updates[0].payload.status, 'suspenso');
});

test('já suspensa → ja_suspensa, NÃO faz nada (idempotência, não regride)', async () => {
  const supabase = criarSupabaseMock({ empresas: [{ id: 'empresa-1', status: 'suspenso' }], fatura: faturaVencidaComLink });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.ja_suspensa, 1);
  assert.equal(relatorio.suspensas, 0);
});

test('trial ainda vigente (trial_ends_at futuro) → trial_ativa, não suspende', async () => {
  const futuro = new Date(Date.now() + 5 * 86400000).toISOString();
  const supabase = criarSupabaseMock({ empresas: [{ id: 'empresa-1', status: 'trial', trial_ends_at: futuro }] });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.trial_ativa, 1);
});

test('arquivada → arquivadas, fora da avaliação', async () => {
  const supabase = criarSupabaseMock({ empresas: [{ id: 'empresa-1', status: 'trial', trial_ends_at: '2000-01-01', arquivada_em: '2026-01-01T00:00:00Z' }], fatura: faturaVencidaComLink });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.arquivadas, 1);
  assert.equal(relatorio.total_avaliadas, 0);
});

test('falha na consulta de fatura → fail-safe, não suspende', async () => {
  const supabase = criarSupabaseMock({ empresas: [{ id: 'empresa-1', status: 'ativo' }], faturaError: new Error('db') });
  const { relatorio } = await rodar(supabase);
  assert.equal(supabase.chamadas.updates.length, 0);
  assert.equal(relatorio.suspensas, 0);
});

// ─── Regularização (sandbox-gated) ───────────────────────────────────────────
test('sandbox → gera fatura de regularização do trial vencido', async () => {
  const chamadasReg = [];
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], fatura: null, ambiente: 'sandbox' });
  const { relatorio } = await rodar(supabase, {
    async gerarFaturaRegularizacao(args) { chamadasReg.push(args); return { resultado: 'gerada', fatura: { id: 'f-reg' } }; },
  });
  assert.equal(chamadasReg.length, 1);
  assert.equal(chamadasReg[0].empresaId, 'empresa-1');
  assert.equal(chamadasReg[0].config.baseURL, 'https://sandbox.asaas.com/api/v3');
  assert.equal(relatorio.regularizacoes_geradas, 1);
});

test('fora do sandbox NÃO gera cobrança (fail-closed)', async () => {
  const chamadasReg = [];
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], fatura: null, ambiente: 'production' });
  await rodar(supabase, { async gerarFaturaRegularizacao(a) { chamadasReg.push(a); return { resultado: 'gerada' }; } });
  assert.equal(chamadasReg.length, 0);
});

test('falha na regularização NÃO impede a avaliação de suspensão', async () => {
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], ambiente: 'sandbox', fatura: faturaVencidaComLink });
  const { relatorio } = await rodar(supabase, { async gerarFaturaRegularizacao() { throw new Error('asaas fora'); } });
  assert.equal(relatorio.suspensas, 1);
  assert.equal(supabase.chamadas.updates[0].payload.status, 'suspenso');
});

test('dry-run: conta quantas SERIAM suspensas SEM gravar nem gerar fatura', async () => {
  const chamadasReg = [];
  const supabase = criarSupabaseMock({ empresas: [empresaTrialVencido], ambiente: 'sandbox', fatura: faturaVencidaComLink });
  const { relatorio } = await rodarDry(supabase, { async gerarFaturaRegularizacao(a) { chamadasReg.push(a); return { resultado: 'gerada' }; } });
  assert.equal(relatorio.dry_run, true);
  assert.equal(relatorio.suspensas, 1);         // seria suspensa
  assert.equal(supabase.chamadas.updates.length, 0); // mas NÃO gravou
  assert.equal(chamadasReg.length, 0);          // NÃO gerou fatura
  assert.equal(relatorio.regularizacoes_geradas, 0);
});

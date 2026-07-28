const test = require('node:test');
const assert = require('node:assert/strict');

const { executarNotificacaoInadimplencia } = require('../jobs/notificarInadimplencia');

const HOJE = '2026-07-28T12:00:00.000Z';

// Mock mínimo do supabase-js para o job de notificação. Suporta:
//   empresas.select('*').in('status',[...])            → lista (via then)
//   configuracoes.select('dados').eq('id',1).single()  → carência
//   faturas...eq('empresa_id',X)...maybeSingle()        → fatura por empresa
function criarSupabaseMock({ empresas = [], fatura = null, faturasPorEmpresa = null, faturaError = null, queryError = null, carencia = 3 } = {}) {
  function builder(tabela) {
    const ctx = { tabela, empresaId: null };
    const api = {
      select() { return api; },
      eq(col, val) { if (col === 'empresa_id') ctx.empresaId = val; return api; },
      in() { return api; },
      lte() { return api; },
      lt() { return api; },
      order() { return api; },
      limit() { return api; },
      single() {
        if (tabela === 'configuracoes') {
          return Promise.resolve({ data: { dados: { dias_carencia_suspensao: carencia } }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        if (tabela === 'faturas') {
          if (faturaError) return Promise.resolve({ data: null, error: faturaError });
          const f = faturasPorEmpresa ? (faturasPorEmpresa[ctx.empresaId] || null) : fatura;
          return Promise.resolve({ data: f, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve) {
        if (tabela === 'empresas') return resolve({ data: empresas, error: queryError });
        return resolve({ data: null, error: null });
      },
    };
    return api;
  }
  return { from: builder };
}

function spyNotificar() {
  const chamadas = [];
  const fn = async (empresaId, dados) => { chamadas.push({ empresaId, dados }); };
  fn.chamadas = chamadas;
  return fn;
}

const empresaAtiva = { id: 'e1', status: 'ativo' };
function fatura(due, extra = {}) {
  return { id: 'f1', empresa_id: 'e1', status: 'pendente', due_date: due, invoice_url: 'https://ex/pay', bank_slip_url: null, ...extra };
}

test('D+0 (real): cria 1 notificação com dedupe determinística', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [empresaAtiva], fatura: fatura('2026-07-28') });
  const { relatorio, exitCode } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(exitCode, 0);
  assert.equal(relatorio.notificadas, 1);
  assert.equal(relatorio.por_passo.d0, 1);
  assert.equal(notificar.chamadas.length, 1);
  assert.equal(notificar.chamadas[0].empresaId, 'e1');
  assert.equal(notificar.chamadas[0].dados.dedupe_key, 'inadimplencia:d0:f1');
  assert.equal(notificar.chamadas[0].dados.tipo, 'inadimplencia');
});

test('dry-run: CONTA mas NÃO cria notificação (sem push)', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [empresaAtiva], fatura: fatura('2026-07-28') });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE, dryRun: true });
  assert.equal(relatorio.dry_run, true);
  assert.equal(relatorio.notificadas, 1);       // SERIA notificada
  assert.equal(relatorio.por_passo.d0, 1);
  assert.equal(notificar.chamadas.length, 0);   // mas NÃO notificou (sem push)
});

test('dia da suspensão (D+3, carência 3) → passo suspensao', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [empresaAtiva], fatura: fatura('2026-07-25') });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.por_passo.suspensao, 1);
  assert.equal(notificar.chamadas[0].dados.dedupe_key, 'inadimplencia:suspensao:f1');
});

test('carência 2 (config): D+2 vira suspensao', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [empresaAtiva], fatura: fatura('2026-07-26'), carencia: 2 });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.por_passo.suspensao, 1);
  assert.equal(relatorio.por_passo.d2, 0);
});

test('arquivada → fora da avaliação, não notifica', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [{ ...empresaAtiva, arquivada_em: '2026-01-01T00:00:00Z' }], fatura: fatura('2026-07-28') });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.arquivadas, 1);
  assert.equal(relatorio.total_avaliadas, 0);
  assert.equal(notificar.chamadas.length, 0);
});

test('sem fatura → sem_fatura, não notifica', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [empresaAtiva], fatura: null });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.sem_fatura, 1);
  assert.equal(relatorio.notificadas, 0);
  assert.equal(notificar.chamadas.length, 0);
});

test('várias empresas em passos diferentes', async () => {
  const notificar = spyNotificar();
  const empresas = [
    { id: 'e1', status: 'ativo' },
    { id: 'e2', status: 'ativo' },
    { id: 'e3', status: 'ativo' },
  ];
  const faturasPorEmpresa = {
    e1: { id: 'fa', empresa_id: 'e1', status: 'pendente', due_date: '2026-07-28', invoice_url: 'https://x' }, // d0
    e2: { id: 'fb', empresa_id: 'e2', status: 'vencido', due_date: '2026-07-27', invoice_url: 'https://x' },  // d1
    e3: { id: 'fc', empresa_id: 'e3', status: 'vencido', due_date: '2026-07-25', invoice_url: 'https://x' },  // suspensao
  };
  const supabase = criarSupabaseMock({ empresas, faturasPorEmpresa });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.notificadas, 3);
  assert.equal(relatorio.por_passo.d0, 1);
  assert.equal(relatorio.por_passo.d1, 1);
  assert.equal(relatorio.por_passo.suspensao, 1);
  assert.equal(notificar.chamadas.length, 3);
});

test('erro na consulta de empresas → abort, exit 1', async () => {
  const notificar = spyNotificar();
  const supabase = criarSupabaseMock({ empresas: [], queryError: new Error('db') });
  const { relatorio, exitCode } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(exitCode, 1);
  assert.equal(relatorio.abort, 'erro_consulta_empresas');
});

test('falha ao notificar uma empresa → conta em erros, segue as demais', async () => {
  const chamadas = [];
  let primeira = true;
  const notificar = async (empresaId, dados) => {
    if (primeira) { primeira = false; throw new Error('push fora'); }
    chamadas.push({ empresaId, dados });
  };
  const empresas = [{ id: 'e1', status: 'ativo' }, { id: 'e2', status: 'ativo' }];
  const faturasPorEmpresa = {
    e1: { id: 'fa', empresa_id: 'e1', status: 'pendente', due_date: '2026-07-28', invoice_url: 'https://x' },
    e2: { id: 'fb', empresa_id: 'e2', status: 'pendente', due_date: '2026-07-28', invoice_url: 'https://x' },
  };
  const supabase = criarSupabaseMock({ empresas, faturasPorEmpresa });
  const { relatorio } = await executarNotificacaoInadimplencia({ supabase, notificar, agora: HOJE });
  assert.equal(relatorio.erros, 1);
  assert.equal(relatorio.notificadas, 1);
  assert.equal(chamadas.length, 1);
});

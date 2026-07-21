// Frente #5 (Billing v2) — PR 4: job one-shot de faturas recorrentes.
// Testa o NÚCLEO (executarJob) com supabase/http mockados: gate sandbox,
// allowlist fail-closed, dry-run, seleção restrita e formato do relatório.
// A coreografia real é coberta por faturaRecorrenteService.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executarJob,
  parseArgs,
  normalizarLimite,
  normalizarDataReferencia,
  lerAllowlist,
  ENV_ALLOWLIST,
} = require('../jobs/gerarFaturasRecorrentes');

const ALFA = 'e5afecd6-2335-4436-86a7-0dfb495b9cbc';

// ── Mock supabase: configuracoes (ambiente) + empresas (seleção) ─────────────
function makeSupabase({ environment = 'sandbox', cfgError = null, empresas = [] } = {}) {
  const q = { limitArg: null, eq: {}, isNull: {}, inArg: null };
  function builder(tabela) {
    const ctx = { tabela };
    const b = {
      select() { return b; },
      eq(c, v) { q.eq[c] = v; return b; },
      is(c, v) { q.isNull[c] = v; return b; },
      in(c, v) { q.inArg = v; return b; },
      limit(n) { q.limitArg = n; return b; },
      single() { return resolve(ctx); },
      then(onF, onR) { return resolve(ctx).then(onF, onR); },
    };
    return b;
  }
  async function resolve(ctx) {
    if (ctx.tabela === 'configuracoes') {
      if (cfgError) return { data: null, error: cfgError };
      return { data: { dados: { integracao_asaas: { apiKey: 'chave-teste', environment } } }, error: null };
    }
    if (ctx.tabela === 'empresas') return { data: empresas, error: null };
    return { data: null, error: null };
  }
  return { from: (t) => builder(t), _q: q };
}

// http espião — não deve ser tocado em dry-run / abortos
function makeHttp() {
  const calls = { posts: [], gets: [] };
  return {
    calls,
    async post(url, body) { calls.posts.push({ url, body }); return { data: {} }; },
    async get(url) { calls.gets.push({ url }); return { data: {} }; },
  };
}

// ── parsing puro ─────────────────────────────────────────────────────────────
test('parseArgs lê --dry-run, --data-referencia e --limite', () => {
  const a = parseArgs(['--dry-run', '--data-referencia=2026-07-20', '--limite=5']);
  assert.equal(a.dryRun, true);
  assert.equal(a.dataReferencia, '2026-07-20');
  assert.equal(a.limite, '5');
});

test('normalizarLimite: default 20, teto 100, rejeita inválido', () => {
  assert.equal(normalizarLimite(undefined), 20);
  assert.equal(normalizarLimite('0'), 20);
  assert.equal(normalizarLimite('7'), 7);
  assert.equal(normalizarLimite('9999'), 100);
});

test('normalizarDataReferencia: aceita YYYY-MM-DD, senão hoje', () => {
  assert.equal(normalizarDataReferencia('2026-07-20'), '2026-07-20');
  assert.match(normalizarDataReferencia('lixo'), /^\d{4}-\d{2}-\d{2}$/);
});

test('lerAllowlist: split por vírgula, trim, dedup; vazia quando ausente', () => {
  assert.deepEqual(lerAllowlist({ [ENV_ALLOWLIST]: ` ${ALFA}, ${ALFA} ,x ` }), [ALFA, 'x']);
  assert.deepEqual(lerAllowlist({}), []);
});

// ── 1. sem allowlist → não processa ninguém (exit 0) ─────────────────────────
test('allowlist vazia → abort allowlist_vazia, exit 0, nada tocado', async () => {
  const supabase = makeSupabase({ environment: 'sandbox' });
  const http = makeHttp();
  const { relatorio, exitCode } = await executarJob({ supabase, http, allowlist: [], dryRun: false, dataReferencia: '2026-07-20', limite: 20 });
  assert.equal(exitCode, 0);
  assert.equal(relatorio.abort, 'allowlist_vazia');
  assert.equal(relatorio.totalCandidatas, 0);
  assert.equal(http.calls.posts.length, 0);
  assert.equal(supabase._q.inArg, null); // nem chegou a selecionar empresas
});

// ── 2. fora de sandbox → aborta antes do serviço (exit 1) ────────────────────
test('ambiente production → abort ambiente_nao_sandbox, exit 1, sem seleção/Asaas', async () => {
  const supabase = makeSupabase({ environment: 'production' });
  const http = makeHttp();
  const { relatorio, exitCode } = await executarJob({ supabase, http, allowlist: [ALFA], dryRun: false, dataReferencia: '2026-07-20', limite: 20 });
  assert.equal(exitCode, 1);
  assert.equal(relatorio.abort, 'ambiente_nao_sandbox');
  assert.equal(supabase._q.inArg, null); // não selecionou empresas
  assert.equal(http.calls.posts.length, 0);
});

test('ambiente ausente (fail-closed) → aborta', async () => {
  const supabase = makeSupabase({ environment: null }); // null não aciona o default do mock
  const { relatorio, exitCode } = await executarJob({ supabase, http: makeHttp(), allowlist: [ALFA], dataReferencia: '2026-07-20', limite: 20 });
  assert.equal(exitCode, 1);
  assert.equal(relatorio.abort, 'ambiente_nao_sandbox');
});

test('erro ao ler configuração → exit 1', async () => {
  const supabase = makeSupabase({ cfgError: { message: 'boom' } });
  const { relatorio, exitCode } = await executarJob({ supabase, http: makeHttp(), allowlist: [ALFA], dataReferencia: '2026-07-20', limite: 20 });
  assert.equal(exitCode, 1);
  assert.equal(relatorio.abort, 'erro_ler_configuracao');
});

// ── 3. dry-run com allowlist → não cria cobrança ─────────────────────────────
test('dry-run: seleciona e avalia, mas não chama Asaas', async () => {
  const supabase = makeSupabase({
    environment: 'sandbox',
    empresas: [{ id: ALFA, status: 'ativo', asaas_subscription_id: null, asaas_customer_id: 'cus_1', plano_id: 'p', planos: { id: 'p', nome: 'Pro', ativo: true, arquivado_em: null, preco_mensal: 149.99, modelo_cobranca: 'fixo' } }],
  });
  const http = makeHttp();
  const { relatorio, exitCode } = await executarJob({ supabase, http, allowlist: [ALFA], dryRun: true, dataReferencia: '2026-07-20', limite: 20 });
  assert.equal(exitCode, 0);
  assert.equal(relatorio.dryRun, true);
  assert.equal(relatorio.totalCandidatas, 1);
  assert.equal(relatorio.geradas.length, 1); // avaliada como gerável
  assert.equal(http.calls.posts.length, 0);  // nenhuma cobrança criada
});

// ── 4 & 5. allowlist restringe empresas + limite respeitado ──────────────────
test('seleção usa allowlist (in), status=ativo, sem assinatura e limite', async () => {
  const supabase = makeSupabase({ environment: 'sandbox', empresas: [] });
  await executarJob({ supabase, http: makeHttp(), allowlist: [ALFA], dryRun: true, dataReferencia: '2026-07-20', limite: 5 });
  assert.deepEqual(supabase._q.inArg, [ALFA]);              // restrito à allowlist
  assert.equal(supabase._q.eq.status, 'ativo');             // só ativas
  assert.equal(supabase._q.isNull.asaas_subscription_id, null); // sem assinatura
  assert.equal(supabase._q.limitArg, 5);                    // limite aplicado
});

// ── 10. relatório contém os campos esperados ─────────────────────────────────
test('relatório tem periodo, dryRun, totalCandidatas, geradas, puladas, erros, dur_ms', async () => {
  const supabase = makeSupabase({ environment: 'sandbox', empresas: [] });
  const { relatorio } = await executarJob({ supabase, http: makeHttp(), allowlist: [ALFA], dryRun: true, dataReferencia: '2026-07-20', limite: 20 });
  for (const campo of ['periodo', 'dryRun', 'totalCandidatas', 'geradas', 'puladas', 'erros', 'dur_ms']) {
    assert.ok(Object.prototype.hasOwnProperty.call(relatorio, campo), `faltou campo ${campo}`);
  }
  assert.equal(relatorio.periodo, '2026-07-01');
});

// ── 11. módulo não usa setInterval e não auto-executa ao ser importado ───────
test('módulo do job não chama setInterval', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../jobs/gerarFaturasRecorrentes.js'), 'utf8');
  // Sem timer/loop interno (o antipadrão do expirarTrials). Menções a "Railway
  // Cron" em comentário são o agendamento EXTERNO, não código de cron interno.
  assert.equal(/setInterval\s*\(/.test(src), false);
  // Não auto-executa no require: o import no topo deste arquivo não abriu
  // conexão nem exigiu env — se rodasse (require.main), teria quebrado. Guardado
  // por `if (require.main === module)`.
  assert.equal(/if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(src), true);
});

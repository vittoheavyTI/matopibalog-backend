// check_db_schema.mjs — Diagnóstico NÍVEL 1, read-only, OPT-IN.
// Confirma invariantes de schema (foco: migration 018 / idempotência).
// Não executa DDL. Não imprime a service key. Nada destrutivo.
//
// OPT-IN: só roda se SUPABASE_URL e SUPABASE_SERVICE_KEY estiverem no ambiente.
//   Sem elas → SKIP (não falha o relatório). Por isso a service key NUNCA é
//   obrigatória no caminho default do smoke.
//
// Como verifica (sem SQL bruto, sem dep nova): faz um SELECT read-only de
// `client_request_id` (limit 1) em cada tabela. Coluna ausente → PostgREST
// devolve erro 42703 → FAIL. Coluna presente → PASS.
//
// Índices únicos parciais NÃO são verificáveis via PostgREST; são reportados
// como SKIP com o SQL de verificação manual no detalhe (rodar no SQL Editor).
//
// Uso direto:   node backend/scripts/reliability/check_db_schema.mjs
// Exit:         0 se nenhum FAIL (SKIP é tolerado), 1 se houver FAIL.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TABELAS = ['despesas', 'abastecimentos', 'vales'];
const INDICES = [
  'ux_despesas_motorista_client_request_id',
  'ux_abastecimentos_motorista_client_request_id',
  'ux_vales_motorista_client_request_id',
];

export async function run() {
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    add('schema (opt-in)', 'SKIP', 'defina SUPABASE_URL + SUPABASE_SERVICE_KEY para habilitar');
    return { name: 'db_schema', ok: true, checks };
  }

  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch (e) {
    add('dependência @supabase/supabase-js', 'FAIL', `import falhou: ${e.message}`);
    return { name: 'db_schema', ok: false, checks };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Coluna client_request_id em cada tabela (probe read-only)
  for (const tabela of TABELAS) {
    try {
      const { error } = await supabase.from(tabela).select('client_request_id').limit(1);
      if (!error) {
        add(`coluna ${tabela}.client_request_id`, 'PASS', 'presente');
      } else if (error.code === '42703' || /client_request_id/.test(error.message || '')) {
        add(`coluna ${tabela}.client_request_id`, 'FAIL', 'AUSENTE (aplicar migration 018)');
      } else {
        // Nunca inclui a key; só a mensagem do PostgREST.
        add(`coluna ${tabela}.client_request_id`, 'FAIL', `erro inesperado: ${error.message}`);
      }
    } catch (e) {
      add(`coluna ${tabela}.client_request_id`, 'FAIL', `exceção: ${e.message}`);
    }
  }

  // Índices: verificação manual (PostgREST não lista índices)
  add('índices únicos parciais', 'SKIP', `verificar manualmente no SQL Editor: SELECT indexname FROM pg_indexes WHERE indexname IN (${INDICES.map((i) => `'${i}'`).join(', ')});`);

  const ok = checks.every((c) => c.status !== 'FAIL');
  return { name: 'db_schema', ok, checks };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const r = await run();
  console.log('# check_db_schema');
  console.log(`  supabase: ${process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? 'configurado (key oculta)' : 'NÃO configurado → SKIP'}`);
  for (const c of r.checks) console.log(`  [${c.status}] ${c.check} — ${c.detail}`);
  console.log(r.ok ? '✅ schema OK (ou SKIP)' : '❌ schema FALHOU');
  process.exit(r.ok ? 0 : 1);
}

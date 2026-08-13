// Aplica, em ordem, no Postgres isolado (CI): pré-bootstrap → migration 060 real
// → migration 061 real. Usa node-postgres (sem depender de psql no runner).
// NUNCA rodar contra produção: exige DATABASE_URL apontando para o banco de teste.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('DATABASE_URL ausente'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', 'migrations');
const arquivos = [
  join(here, '00_bootstrap_pre.sql'),
  join(migrations, '060_catalogo_funcionalidades.sql'),
  join(migrations, '061_matriz_publicacao_transacional.sql'),
  join(here, '99_grants_service_role_test.sql'),   // test-only: grants padrão do Supabase p/ service_role
  // 062 por ÚLTIMO: assim a matriz de privilégios da migration (INSERT/SELECT na
  // auditoria; REVOKE UPDATE/DELETE/TRUNCATE) é a autoridade final sobre as tabelas
  // de auth — o `GRANT ALL ON ALL TABLES` do 99_grants (test-only) roda ANTES e não
  // as alcança (fiel à produção, onde a 062 revoga logo após o create).
  join(migrations, '062_auth_sessions_revogaveis.sql'),   // SEC-1: sessões revogáveis
  // 064 depois da 062 (FK → auth_sessions). O gap 063 é intencional (reservado ao
  // #416 congelado); o applier usa lista explícita, então o gap é inócuo.
  join(migrations, '064_frete_tracking_credenciais.sql'), // SEC-1: credencial de rastreamento
  join(migrations, '065_fretes_financeiro_auditoria.sql'), // Fretes: correcao financeira atomica
];

const client = new pg.Client({ connectionString: CONN });
await client.connect();
try {
  for (const f of arquivos) {
    const sql = readFileSync(f, 'utf8');
    process.stdout.write(`→ aplicando ${f.split(/[\\/]/).pop()} ... `);
    await client.query(sql);
    console.log('ok');
  }
  console.log('Schema de teste aplicado (pré-bootstrap + 060 + 061 + 062 + 064).');
} finally {
  await client.end();
}

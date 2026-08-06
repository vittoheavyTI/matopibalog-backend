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
  join(migrations, '062_auth_sessions_revogaveis.sql'),   // SEC-1: sessões revogáveis
  join(here, '99_grants_service_role_test.sql'),   // test-only: grants padrão do Supabase p/ service_role
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
  console.log('Schema de teste aplicado (pré-bootstrap + 060 + 061).');
} finally {
  await client.end();
}

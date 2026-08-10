// Testes REAIS (PostgreSQL isolado) do outbox de billing — migration 063 (3A-2).
//
// Prova a garantia PERSISTENTE de idempotência multi-processo (§8):
//   - dedupe_key UNIQUE → enfileirar o mesmo evento 10x cria 1 linha só;
//   - claim CAS (UPDATE ... WHERE status='pending' AND attempts=$ RETURNING) →
//     N workers concorrentes reivindicam o MESMO evento apenas 1 vez.
//
// Executado no workflow pg-rpc-ci (Postgres efêmero), NUNCA contra produção.
// Fixtures 100% sintéticas. Pula silenciosamente sem DATABASE_URL.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('billing_outbox PG tests (pulados: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 8 });
  let empresaId;

  before(async () => {
    empresaId = randomUUID();
    await pool.query(
      `INSERT INTO public.empresas (id, nome) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [empresaId, 'E2E-OUTBOX-' + Date.now()],
    );
  });

  after(async () => {
    await pool.query('DELETE FROM public.billing_outbox WHERE empresa_id = $1', [empresaId]).catch(() => {});
    await pool.query('DELETE FROM public.empresas WHERE id = $1', [empresaId]).catch(() => {});
    await pool.end();
  });

  test('enfileirar o mesmo dedupe_key 10x → 1 linha (idempotência de enfileiramento)', async () => {
    const dedupe = `${empresaId}:contrato_assinado`;
    const inserts = Array.from({ length: 10 }, () =>
      pool.query(
        `INSERT INTO public.billing_outbox (empresa_id, event_type, dedupe_key)
         VALUES ($1, 'contrato_assinado', $2)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [empresaId, dedupe],
      ),
    );
    await Promise.all(inserts);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM public.billing_outbox WHERE dedupe_key = $1', [dedupe]);
    assert.equal(rows[0].n, 1, 'apenas 1 linha para o dedupe_key');
  });

  test('claim CAS concorrente → 1 vencedor', async () => {
    const dedupe = `${empresaId}:trial_iniciado`;
    const { rows: ins } = await pool.query(
      `INSERT INTO public.billing_outbox (empresa_id, event_type, dedupe_key)
       VALUES ($1, 'trial_iniciado', $2) RETURNING id, attempts`,
      [empresaId, dedupe],
    );
    const id = ins[0].id;

    // 8 workers tentam reivindicar simultaneamente via CAS.
    const claim = () => pool.query(
      `UPDATE public.billing_outbox
         SET status='processing', attempts=attempts+1, processing_started_at=now()
       WHERE id=$1 AND status='pending' AND attempts=0
       RETURNING id`,
      [id],
    );
    const resultados = await Promise.all(Array.from({ length: 8 }, () => claim()));
    const vencedores = resultados.filter((r) => r.rowCount === 1).length;
    assert.equal(vencedores, 1, 'exatamente 1 worker reivindica o evento');

    const { rows } = await pool.query('SELECT status, attempts FROM public.billing_outbox WHERE id=$1', [id]);
    assert.equal(rows[0].status, 'processing');
    assert.equal(rows[0].attempts, 1, 'attempts incrementado uma única vez');
  });

  test('privilégios: anon/authenticated NÃO acessam billing_outbox', async () => {
    // service_role é o dono no teste; garantimos que os papéis públicos não têm grant.
    const { rows } = await pool.query(`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name='billing_outbox' AND grantee IN ('anon','authenticated','PUBLIC')
    `);
    assert.equal(rows.length, 0, 'nenhum grant para anon/authenticated/PUBLIC');
  });
}

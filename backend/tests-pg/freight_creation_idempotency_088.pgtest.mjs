import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONN = process.env.DATABASE_URL;
const ENABLED = process.env.FREIGHT_IDEMPOTENCY_088_PG === '1';
const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(here, '..', 'migrations', '088_freight_creation_idempotency.sql'),
  'utf8',
);
const rollbackSql = `
  DROP INDEX IF EXISTS public.ux_fretes_empresa_client_request;
  ALTER TABLE public.fretes
    DROP CONSTRAINT IF EXISTS fretes_creation_intent_pair_check,
    DROP COLUMN IF EXISTS creation_intent_hash,
    DROP COLUMN IF EXISTS client_request_id;
`;

let pg;

if (!CONN || !ENABLED) {
  const reason = !CONN
    ? 'DATABASE_URL ausente'
    : 'FREIGHT_IDEMPOTENCY_088_PG diferente de 1';
  test(`088 freight idempotency PG (pulado: ${reason})`, { skip: true }, () => {});
}

async function connect() {
  pg ||= (await import('pg')).default;
  const client = new pg.Client({ connectionString: CONN });
  await client.connect();
  return client;
}

async function resetBase(client, { clientRequestType = null } = {}) {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const preexistingClientColumn = clientRequestType
    ? `, client_request_id ${clientRequestType}`
    : '';
  await client.query(`
    CREATE TABLE public.fretes (
      id uuid PRIMARY KEY,
      empresa_id uuid NOT NULL,
      motorista_id uuid,
      unidade_operacional_id uuid,
      placa text,
      origem text,
      destino text
      ${preexistingClientColumn}
    )
  `);
}

async function count(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0].count);
}

async function expectPgError(promise, code, messagePattern = null) {
  await assert.rejects(promise, (error) => (
    error?.code === code
    && (!messagePattern || messagePattern.test(error.message))
  ));
}

test('088: migration, NULL, concorrencia, tenant, drift, reapply e rollback reais', {
  skip: !CONN || !ENABLED,
  timeout: 60_000,
}, async (t) => {
  const c1 = await connect();
  const c2 = await connect();
  try {
    await t.test('aplica estrutura exata e fecha a semantica UNKNOWN de CHECK', async () => {
      await resetBase(c1);
      await c1.query(migrationSql);

      const columns = await c1.query(`
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'fretes'
           AND column_name IN ('client_request_id', 'creation_intent_hash')
         ORDER BY column_name
      `);
      assert.deepEqual(columns.rows, [
        {
          column_name: 'client_request_id', data_type: 'uuid',
          is_nullable: 'YES', column_default: null,
        },
        {
          column_name: 'creation_intent_hash', data_type: 'text',
          is_nullable: 'YES', column_default: null,
        },
      ]);

      const constraint = await c1.query(`
        SELECT convalidated, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
         WHERE conrelid = 'public.fretes'::regclass
           AND conname = 'fretes_creation_intent_pair_check'
      `);
      assert.equal(constraint.rowCount, 1);
      assert.equal(constraint.rows[0].convalidated, true);
      assert.match(constraint.rows[0].definition, /creation_intent_hash IS NOT NULL/i);

      const index = await c1.query(`
        SELECT i.indisunique, i.indisvalid, i.indisready,
               pg_get_expr(i.indpred, i.indrelid) AS predicate
          FROM pg_index i
         WHERE i.indexrelid = 'public.ux_fretes_empresa_client_request'::regclass
      `);
      assert.deepEqual(index.rows, [{
        indisunique: true,
        indisvalid: true,
        indisready: true,
        predicate: '(client_request_id IS NOT NULL)',
      }]);

      await c1.query(`
        INSERT INTO public.fretes (id, empresa_id, origem)
        VALUES ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'legacy')
      `);
      await expectPgError(c1.query(`
        INSERT INTO public.fretes (id, empresa_id, client_request_id, creation_intent_hash)
        VALUES (
          '00000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          NULL
        )
      `), '23514');
      await expectPgError(c1.query(`
        INSERT INTO public.fretes (id, empresa_id, client_request_id, creation_intent_hash)
        VALUES (
          '00000000-0000-4000-8000-000000000003',
          '10000000-0000-4000-8000-000000000001',
          NULL,
          '${'a'.repeat(64)}'
        )
      `), '23514');
      await expectPgError(c1.query(`
        INSERT INTO public.fretes (id, empresa_id, client_request_id, creation_intent_hash)
        VALUES (
          '00000000-0000-4000-8000-000000000004',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000004',
          'HASH_INVALIDO'
        )
      `), '23514');
    });

    await t.test('unicidade decide corrida real e permite a mesma chave em tenants distintos', async () => {
      const tenantA = '10000000-0000-4000-8000-00000000000a';
      const tenantB = '10000000-0000-4000-8000-00000000000b';
      const tenantC = '10000000-0000-4000-8000-00000000000c';
      const requestId = '20000000-0000-4000-8000-00000000000a';
      const insertSql = `
        INSERT INTO public.fretes
          (id, empresa_id, client_request_id, creation_intent_hash, origem)
        VALUES ($1, $2, $3, $4, 'race')
      `;

      const sameTenant = await Promise.allSettled([
        c1.query(insertSql, [
          '00000000-0000-4000-8000-000000000011', tenantA, requestId, 'b'.repeat(64),
        ]),
        c2.query(insertSql, [
          '00000000-0000-4000-8000-000000000012', tenantA, requestId, 'b'.repeat(64),
        ]),
      ]);
      assert.equal(sameTenant.filter((result) => result.status === 'fulfilled').length, 1);
      const loser = sameTenant.find((result) => result.status === 'rejected');
      assert.equal(loser?.reason?.code, '23505');
      assert.equal(await count(
        c1,
        'SELECT count(*) FROM public.fretes WHERE empresa_id=$1 AND client_request_id=$2',
        [tenantA, requestId],
      ), 1);

      const differentTenants = await Promise.allSettled([
        c1.query(insertSql, [
          '00000000-0000-4000-8000-000000000013', tenantB, requestId, 'b'.repeat(64),
        ]),
        c2.query(insertSql, [
          '00000000-0000-4000-8000-000000000014', tenantC, requestId, 'b'.repeat(64),
        ]),
      ]);
      assert.equal(differentTenants.every((result) => result.status === 'fulfilled'), true);
    });

    await t.test('clientes legados e atributos derivados posteriores permanecem compativeis', async () => {
      const tenant = '10000000-0000-4000-8000-000000000020';
      const requestId = '20000000-0000-4000-8000-000000000020';
      const hash = 'c'.repeat(64);
      await c1.query(`
        INSERT INTO public.fretes (id, empresa_id, origem)
        VALUES
          ('00000000-0000-4000-8000-000000000021', $1, 'legacy-1'),
          ('00000000-0000-4000-8000-000000000022', $1, 'legacy-2')
      `, [tenant]);
      assert.equal(await count(
        c1,
        'SELECT count(*) FROM public.fretes WHERE empresa_id=$1 AND client_request_id IS NULL',
        [tenant],
      ), 2);

      await c1.query(`
        INSERT INTO public.fretes
          (id, empresa_id, client_request_id, creation_intent_hash, unidade_operacional_id, placa)
        VALUES ($1, $2, $3, $4, $5, 'AAA1A11')
      `, [
        '00000000-0000-4000-8000-000000000023',
        tenant,
        requestId,
        hash,
        '30000000-0000-4000-8000-000000000001',
      ]);
      await c1.query(`
        UPDATE public.fretes
           SET unidade_operacional_id = $2, placa = 'ZZZ9Z99'
         WHERE id = $1
      `, [
        '00000000-0000-4000-8000-000000000023',
        '30000000-0000-4000-8000-000000000002',
      ]);
      const stored = await c1.query(`
        SELECT creation_intent_hash, unidade_operacional_id, placa
          FROM public.fretes
         WHERE id = '00000000-0000-4000-8000-000000000023'
      `);
      assert.deepEqual(stored.rows[0], {
        creation_intent_hash: hash,
        unidade_operacional_id: '30000000-0000-4000-8000-000000000002',
        placa: 'ZZZ9Z99',
      });
    });

    await t.test('reaplicacao e no-op e drift estrutural falha fechado', async () => {
      await c1.query(migrationSql);

      await c1.query(`
        ALTER TABLE public.fretes DROP CONSTRAINT fretes_creation_intent_pair_check;
        ALTER TABLE public.fretes
          ADD CONSTRAINT fretes_creation_intent_pair_check
          CHECK (client_request_id IS NULL OR creation_intent_hash IS NULL) NOT VALID;
      `);
      await expectPgError(c1.query(migrationSql), 'P0001', /088 drift: unexpected.*constraint/i);
      await c1.query('ALTER TABLE public.fretes DROP CONSTRAINT fretes_creation_intent_pair_check');
      await c1.query(migrationSql);

      await c1.query(`
        DROP INDEX public.ux_fretes_empresa_client_request;
        CREATE INDEX ux_fretes_empresa_client_request
          ON public.fretes (empresa_id);
      `);
      await expectPgError(c1.query(migrationSql), 'P0001', /088 drift: ux_fretes/i);
      await c1.query('DROP INDEX public.ux_fretes_empresa_client_request');
      await c1.query(migrationSql);

      await resetBase(c1, { clientRequestType: 'text' });
      await expectPgError(c1.query(migrationSql), 'P0001', /088 drift: client_request_id/i);
    });

    await t.test('rollback preserva linhas legadas e permite nova aplicacao', async () => {
      await resetBase(c1);
      await c1.query(migrationSql);
      await c1.query(`
        INSERT INTO public.fretes (id, empresa_id, origem)
        VALUES ('00000000-0000-4000-8000-000000000030', '10000000-0000-4000-8000-000000000030', 'preservar')
      `);
      const before = await count(c1, 'SELECT count(*) FROM public.fretes');
      await c1.query(rollbackSql);
      const after = await count(c1, 'SELECT count(*) FROM public.fretes');
      assert.equal(after, before);
      assert.equal(await count(c1, `
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='fretes'
           AND column_name IN ('client_request_id','creation_intent_hash')
      `), 0);
      assert.equal(await count(c1, `
        SELECT count(*) FROM pg_constraint
         WHERE conrelid='public.fretes'::regclass
           AND conname='fretes_creation_intent_pair_check'
      `), 0);
      assert.equal((await c1.query(
        "SELECT to_regclass('public.ux_fretes_empresa_client_request') AS index_name",
      )).rows[0].index_name, null);

      await c1.query(migrationSql);
      assert.equal(await count(c1, `
        SELECT count(*) FROM pg_constraint
         WHERE conrelid='public.fretes'::regclass
           AND conname='fretes_creation_intent_pair_check'
           AND convalidated
      `), 1);
    });
  } finally {
    await c1.end();
    await c2.end();
  }
});

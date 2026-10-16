import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_URL = process.env.FREIGHT_IDEMPOTENCY_088_ADMIN_URL;
const ENABLED_VALUE = process.env.FREIGHT_IDEMPOTENCY_088_PG;
const EXECUTION_REQUESTED = ADMIN_URL !== undefined || ENABLED_VALUE !== undefined;
const EXPECTED_ADMIN_DATABASE = 'postgres';
const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_PORT = '5432';
const EXPECTED_USER = 'postgres';
const EXPECTED_PG_MAJOR = 17;
const EXPECTED_DATA_DIRECTORY = '/var/lib/postgresql/data';
const MAX_SERVER_AGE_SECONDS = 15 * 60;
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

class HarnessSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessSafetyError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new HarnessSafetyError(code, message);
}

function validateHarnessTarget({ enabled, connectionString }) {
  if (enabled !== '1') {
    refuse('HARNESS_DISABLED', 'FREIGHT_IDEMPOTENCY_088_PG must be exactly 1');
  }
  if (!connectionString) {
    refuse('ADMIN_URL_MISSING', 'FREIGHT_IDEMPOTENCY_088_ADMIN_URL is required');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    refuse('ADMIN_URL_INVALID', 'PostgreSQL admin URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    refuse('PROTOCOL_REJECTED', 'Only PostgreSQL URLs are accepted');
  }
  if (url.hostname !== EXPECTED_HOST) {
    refuse('REMOTE_TARGET_REJECTED', `PostgreSQL host must be ${EXPECTED_HOST}`);
  }
  if (url.port !== EXPECTED_PORT) {
    refuse('PORT_REJECTED', `PostgreSQL port must be ${EXPECTED_PORT}`);
  }
  if (decodeURIComponent(url.pathname) !== `/${EXPECTED_ADMIN_DATABASE}`) {
    refuse('UNEXPECTED_DATABASE_REJECTED', `Admin database must be ${EXPECTED_ADMIN_DATABASE}`);
  }
  if (decodeURIComponent(url.username) !== EXPECTED_USER) {
    refuse('USER_REJECTED', `PostgreSQL user must be ${EXPECTED_USER}`);
  }
  if (url.search || url.hash) {
    refuse('URL_OPTIONS_REJECTED', 'Connection URL options are not accepted by this harness');
  }
  return Object.freeze({ connectionString, url });
}

function isExpectedServerAddress(address) {
  return address === EXPECTED_HOST
    || /^10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(address)
    || /^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$/.test(address)
    || /^192\.168\.[0-9]{1,3}\.[0-9]{1,3}$/.test(address);
}

function validateServerIdentity(row) {
  const serverVersionNum = Number(row.server_version_num);
  const serverMajor = Math.floor(serverVersionNum / 10000);
  const serverAgeSeconds = Number(row.server_age_seconds);
  if (row.database_name !== EXPECTED_ADMIN_DATABASE) {
    refuse('SERVER_DATABASE_REJECTED', 'Connected server reported an unexpected database');
  }
  if (row.user_name !== EXPECTED_USER || row.is_superuser !== true) {
    refuse('SERVER_ROLE_REJECTED', 'Connected role is not the expected disposable-server superuser');
  }
  if (!isExpectedServerAddress(row.server_address)
      || String(row.server_port) !== EXPECTED_PORT) {
    refuse('SERVER_ENDPOINT_REJECTED', 'Connected server did not attest a private CI container endpoint');
  }
  if (row.in_recovery !== false) {
    refuse('SERVER_RECOVERY_REJECTED', 'Read replicas and recovery servers are not accepted');
  }
  if (serverMajor !== EXPECTED_PG_MAJOR) {
    refuse('SERVER_VERSION_REJECTED', `PostgreSQL major must be ${EXPECTED_PG_MAJOR}`);
  }
  if (!Number.isFinite(serverAgeSeconds)
      || serverAgeSeconds < 0
      || serverAgeSeconds > MAX_SERVER_AGE_SECONDS) {
    refuse('SERVER_AGE_REJECTED', 'PostgreSQL server is not a freshly started disposable service');
  }
  if (!Array.isArray(row.connectable_databases)
      || row.connectable_databases.length !== 1
      || row.connectable_databases[0] !== EXPECTED_ADMIN_DATABASE) {
    refuse('SERVER_INVENTORY_REJECTED', 'PostgreSQL server contains unexpected connectable databases');
  }
  if (row.data_directory !== EXPECTED_DATA_DIRECTORY) {
    refuse('SERVER_LAYOUT_REJECTED', 'PostgreSQL data directory is not the official disposable container layout');
  }
  if (!Array.isArray(row.installed_extensions)
      || row.installed_extensions.length !== 1
      || row.installed_extensions[0] !== 'plpgsql'
      || row.user_relation_count !== 0) {
    refuse('SERVER_CONTENT_REJECTED', 'PostgreSQL admin database is not empty');
  }
  return Object.freeze({ serverMajor, serverAgeSeconds });
}

async function attestDisposableServer(admin) {
  const result = await admin.query(`
    SELECT current_database() AS database_name,
           current_user AS user_name,
           inet_server_addr()::text AS server_address,
           inet_server_port() AS server_port,
           pg_is_in_recovery() AS in_recovery,
           current_setting('server_version_num') AS server_version_num,
           current_setting('data_directory') AS data_directory,
           extract(epoch FROM (clock_timestamp() - pg_postmaster_start_time())) AS server_age_seconds,
           r.rolsuper AS is_superuser,
           ARRAY(
             SELECT datname
               FROM pg_database
              WHERE datallowconn
                AND NOT datistemplate
              ORDER BY datname
           ) AS connectable_databases,
           ARRAY(SELECT extname FROM pg_extension ORDER BY extname) AS installed_extensions,
           (
             SELECT count(*)::integer
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND n.nspname !~ '^pg_toast'
                AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
           ) AS user_relation_count
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);
  if (result.rowCount !== 1) {
    refuse('SERVER_ATTESTATION_FAILED', 'PostgreSQL server identity query returned no unique result');
  }
  return validateServerIdentity(result.rows[0]);
}

function quoteIdentifier(identifier) {
  if (!/^freight_idempotency_088_[0-9a-f]{16}$/.test(identifier)) {
    refuse('DATABASE_NAME_REJECTED', 'Disposable database name is outside the harness namespace');
  }
  return `"${identifier}"`;
}

async function createDisposableDatabase(admin) {
  const databaseName = `freight_idempotency_088_${randomBytes(8).toString('hex')}`;
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (existing.rowCount !== 0) {
    refuse('DATABASE_ALREADY_EXISTS', 'Generated disposable database already exists');
  }
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0`);
  const created = await admin.query(`
    SELECT datname, datallowconn, datistemplate
      FROM pg_database
     WHERE datname = $1
  `, [databaseName]);
  assert.deepEqual(created.rows, [{
    datname: databaseName,
    datallowconn: true,
    datistemplate: false,
  }]);
  return databaseName;
}

function disposableConnectionString(target, databaseName) {
  quoteIdentifier(databaseName);
  const url = new URL(target.connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function dropDisposableDatabase(admin, databaseName) {
  quoteIdentifier(databaseName);
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await admin.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
}

async function connect(connectionString) {
  pg ||= (await import('pg')).default;
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function assertDisposableConnection(client, databaseName) {
  quoteIdentifier(databaseName);
  const result = await client.query(`
    SELECT current_database() AS database_name,
           inet_server_addr()::text AS server_address,
           inet_server_port() AS server_port
  `);
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].database_name, databaseName);
  assert.equal(isExpectedServerAddress(result.rows[0].server_address), true);
  assert.equal(result.rows[0].server_port, Number(EXPECTED_PORT));
}

async function resetBase(client, { clientRequestType = null } = {}) {
  await client.query('DROP TABLE IF EXISTS public.fretes');
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

const validAdminUrl = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const validServerIdentity = (overrides = {}) => ({
  database_name: EXPECTED_ADMIN_DATABASE,
  user_name: EXPECTED_USER,
  server_address: EXPECTED_HOST,
  server_port: Number(EXPECTED_PORT),
  in_recovery: false,
  server_version_num: '170011',
  server_age_seconds: '30',
  data_directory: EXPECTED_DATA_DIRECTORY,
  is_superuser: true,
  connectable_databases: [EXPECTED_ADMIN_DATABASE],
  installed_extensions: ['plpgsql'],
  user_relation_count: 0,
  ...overrides,
});

test('guard recusa tentativa sem habilitacao explicita', () => {
  assert.throws(
    () => validateHarnessTarget({ enabled: undefined, connectionString: validAdminUrl }),
    (error) => error instanceof HarnessSafetyError && error.code === 'HARNESS_DISABLED',
  );
});

test('guard recusa banco administrativo com nome inesperado', () => {
  assert.throws(
    () => validateHarnessTarget({
      enabled: '1',
      connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/matopiba_production',
    }),
    (error) => error instanceof HarnessSafetyError
      && error.code === 'UNEXPECTED_DATABASE_REJECTED',
  );
});

test('guard recusa endpoints remotos Supabase e Railway antes de conectar', () => {
  for (const connectionString of [
    'postgres://postgres:secret@db.project.supabase.co:5432/postgres',
    'postgres://postgres:secret@containers-us-west.railway.app:5432/postgres',
  ]) {
    assert.throws(
      () => validateHarnessTarget({ enabled: '1', connectionString }),
      (error) => error instanceof HarnessSafetyError && error.code === 'REMOTE_TARGET_REJECTED',
    );
  }
});

test('guard exige atestacao independente de servidor novo, local e vazio', () => {
  assert.doesNotThrow(() => validateServerIdentity(validServerIdentity()));
  for (const [overrides, expectedCode] of [
    [{ server_address: '8.8.8.8' }, 'SERVER_ENDPOINT_REJECTED'],
    [{ database_name: 'production' }, 'SERVER_DATABASE_REJECTED'],
    [{ server_age_seconds: String(MAX_SERVER_AGE_SECONDS + 1) }, 'SERVER_AGE_REJECTED'],
    [{ connectable_databases: ['app', 'postgres'] }, 'SERVER_INVENTORY_REJECTED'],
    [{ is_superuser: false }, 'SERVER_ROLE_REJECTED'],
    [{ server_version_num: '160010' }, 'SERVER_VERSION_REJECTED'],
    [{ data_directory: '/var/lib/postgresql/production' }, 'SERVER_LAYOUT_REJECTED'],
    [{ installed_extensions: ['pgcrypto', 'plpgsql'] }, 'SERVER_CONTENT_REJECTED'],
    [{ user_relation_count: 1 }, 'SERVER_CONTENT_REJECTED'],
  ]) {
    assert.throws(
      () => validateServerIdentity(validServerIdentity(overrides)),
      (error) => error instanceof HarnessSafetyError && error.code === expectedCode,
    );
  }
});

let target = null;
if (EXECUTION_REQUESTED) {
  target = validateHarnessTarget({ enabled: ENABLED_VALUE, connectionString: ADMIN_URL });
} else {
  test('088 PostgreSQL real requer solicitacao explicita completa', { skip: true }, () => {});
}

test('088: migration, NULL, concorrencia, tenant, drift, reapply e rollback reais', {
  skip: !EXECUTION_REQUESTED,
  timeout: 90_000,
}, async (t) => {
  const admin = await connect(target.connectionString);
  let databaseName = null;
  let c1 = null;
  let c2 = null;
  try {
    await attestDisposableServer(admin);
    databaseName = await createDisposableDatabase(admin);
    const isolatedConnectionString = disposableConnectionString(target, databaseName);
    c1 = await connect(isolatedConnectionString);
    c2 = await connect(isolatedConnectionString);
    await assertDisposableConnection(c1, databaseName);
    await assertDisposableConnection(c2, databaseName);

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
      await expectPgError(
        c1.query(migrationSql),
        'P0001',
        /088 drift: unexpected fretes_creation_intent_pair_check/i,
      );
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
    await Promise.allSettled([
      c1?.end(),
      c2?.end(),
    ].filter(Boolean));
    try {
      if (databaseName) await dropDisposableDatabase(admin, databaseName);
    } finally {
      await admin.end();
    }
  }
});

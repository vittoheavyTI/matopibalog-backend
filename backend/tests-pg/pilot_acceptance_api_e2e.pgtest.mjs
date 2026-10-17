import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { Pool, Client } = require('pg');
const {
  createFreight,
  FreightCreationError,
} = require('../services/freights/freightCreationService');
const { createFreteSchema } = require('../schemas/fretes');

const ADMIN_URL = process.env.PILOT_API_E2E_ADMIN_URL;
const ENABLED = process.env.PILOT_API_E2E_PG;
const REQUESTED = ADMIN_URL !== undefined || ENABLED !== undefined;
const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_DATABASE = 'postgres';
const EXPECTED_PORT = '5432';
const EXPECTED_USER = 'postgres';

class SafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuse = (code, message) => { throw new SafetyError(code, message); };

function validateTarget(enabled, connectionString) {
  if (enabled !== '1') refuse('HARNESS_DISABLED', 'PILOT_API_E2E_PG must be exactly 1');
  if (!connectionString) refuse('ADMIN_URL_MISSING', 'PILOT_API_E2E_ADMIN_URL is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) refuse('PROTOCOL_REJECTED', 'PostgreSQL required');
  if (url.hostname !== EXPECTED_HOST) refuse('REMOTE_TARGET_REJECTED', 'Remote PostgreSQL is forbidden');
  if (url.port !== EXPECTED_PORT) refuse('PORT_REJECTED', 'Unexpected PostgreSQL port');
  if (decodeURIComponent(url.pathname) !== `/${EXPECTED_DATABASE}`) refuse('DATABASE_REJECTED', 'Admin database must be postgres');
  if (decodeURIComponent(url.username) !== EXPECTED_USER) refuse('USER_REJECTED', 'Disposable superuser required');
  if (url.search || url.hash) refuse('OPTIONS_REJECTED', 'URL options are forbidden');
  return connectionString;
}

function quoteDatabase(name) {
  if (!/^pilot_api_e2e_[0-9a-f]{16}$/.test(name)) refuse('DATABASE_NAME_REJECTED', 'Invalid disposable namespace');
  return `"${name}"`;
}

async function attest(admin) {
  const result = await admin.query(`
    SELECT current_database() database_name,
           current_user user_name,
           inet_server_addr()::text server_address,
           inet_server_port() server_port,
           current_setting('server_version_num') server_version_num,
           current_setting('data_directory') data_directory,
           extract(epoch from (clock_timestamp() - pg_postmaster_start_time())) server_age,
           (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) is_superuser,
           (SELECT count(*)::int FROM pg_database WHERE datallowconn AND NOT datistemplate) database_count,
           (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname NOT IN ('pg_catalog','information_schema')
               AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')) relation_count
  `);
  const row = result.rows[0];
  const address = String(row.server_address || '').replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  const privateAddress = address === EXPECTED_HOST || address === '::1'
    || /^10\./.test(address) || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
  if (row.database_name !== EXPECTED_DATABASE || row.user_name !== EXPECTED_USER
      || !row.is_superuser || !privateAddress || String(row.server_port) !== EXPECTED_PORT
      || Math.floor(Number(row.server_version_num) / 10000) !== 17
      || Number(row.server_age) > 15 * 60
      || row.data_directory !== '/var/lib/postgresql/data'
      || row.database_count !== 1 || row.relation_count !== 0) {
    refuse('SERVER_ATTESTATION_REJECTED', 'Server is not the expected fresh disposable PostgreSQL 17');
  }
}

class PgQuery {
  constructor(pool, table) {
    this.pool = pool;
    this.table = table;
    this.filters = {};
    this.insertPayload = null;
  }
  select() { return this; }
  eq(field, value) { this.filters[field] = value; return this; }
  insert(payload) { this.insertPayload = { ...payload }; return this; }

  async single() {
    if (this.insertPayload) {
      const payload = { id: randomUUID(), ...this.insertPayload };
      const fields = Object.keys(payload);
      const values = fields.map((field) => payload[field]);
      const placeholders = fields.map((_, index) => `$${index + 1}`);
      try {
        const result = await this.pool.query(
          `INSERT INTO ${this.table} (${fields.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
          values,
        );
        return { data: result.rows[0], error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    }
    const fields = Object.keys(this.filters);
    const values = fields.map((field) => this.filters[field]);
    const where = fields.map((field, index) => `${field}=$${index + 1}`).join(' AND ');
    const result = await this.pool.query(
      `SELECT * FROM ${this.table}${where ? ` WHERE ${where}` : ''} LIMIT 1`,
      values,
    );
    if (result.rowCount !== 1) return { data: null, error: { message: 'not found' } };
    return { data: result.rows[0], error: null };
  }

  async maybeSingle() {
    const result = await this.single();
    return result.error ? { data: null, error: null } : result;
  }
}

class PgSupabaseAdapter {
  constructor(pool) { this.pool = pool; }
  from(table) {
    if (!['usuarios', 'motoristas', 'empresas', 'fretes'].includes(table)) {
      throw new Error(`Unexpected table ${table}`);
    }
    return new PgQuery(this.pool, table);
  }
}

const ids = {
  tenantA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  driverA: '11111111-1111-4111-8111-111111111111',
  driverB: '22222222-2222-4222-8222-222222222222',
  requestA: '33333333-3333-4333-8333-333333333333',
  requestB: '44444444-4444-4444-8444-444444444444',
};

function createApp(adapter, actors, notifications) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    const actor = actors[token];
    if (!actor) return res.status(401).json({ message: 'Synthetic test authentication required.' });
    req.actor = actor;
    next();
  });
  app.post('/fretes', async (req, res) => {
    if (!req.actor.canCreate) return res.status(403).json({ message: 'freight.create revoked' });
    const parsed = createFreteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Dados invalidos.' });
    try {
      const result = await createFreight(adapter, {
        user: { role: 'admin', uid: req.actor.userId },
        body: parsed.data,
        motoristaId: parsed.data.motorista_id,
        clientRequestId: parsed.data.client_request_id || null,
        resolveOperationalUnit: async ({ motorista }) => {
          if (motorista.empresa_id !== req.actor.tenantId) {
            throw new FreightCreationError('Cross-tenant driver denied.', { status: 403, code: 'cross_tenant' });
          }
          return motorista.unidade_operacional_id;
        },
        authorizeReplay: async ({ existing }) =>
          req.actor.canCreate && existing.empresa_id === req.actor.tenantId,
      });
      if (!result.replay) notifications.count += 1;
      return res.status(201).json({ ...result.data, idempotent: result.replay });
    } catch (error) {
      if (error instanceof FreightCreationError) {
        return res.status(error.status).json({ code: error.code, message: error.message });
      }
      return res.status(500).json({ message: 'Unexpected test server error.' });
    }
  });
  return app;
}

async function post(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/fretes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const baseBody = (driver, overrides = {}) => ({
  motorista_id: driver,
  origem: 'Balsas',
  destino: 'Palmas',
  valor_frete: 1500,
  quem_recebeu: 'proprietario',
  ...overrides,
});

test('guard do API E2E recusa ausencia, banco inesperado e endpoints remotos', () => {
  assert.throws(() => validateTarget(undefined, 'postgres://postgres:postgres@127.0.0.1:5432/postgres'), { code: 'HARNESS_DISABLED' });
  assert.throws(() => validateTarget('1', 'postgres://postgres:postgres@127.0.0.1:5432/production'), { code: 'DATABASE_REJECTED' });
  assert.throws(() => validateTarget('1', 'postgres://postgres:secret@db.example.supabase.co:5432/postgres'), { code: 'REMOTE_TARGET_REJECTED' });
  assert.throws(() => validateTarget('1', 'postgres://postgres:secret@railway.example:5432/postgres'), { code: 'REMOTE_TARGET_REJECTED' });
});

if (!REQUESTED) {
  test('API E2E real requer ambiente descartavel explicito', { skip: true }, () => {});
}

test('POST /fretes usa HTTP real, servico real e PostgreSQL 17 descartavel', {
  skip: !REQUESTED,
  timeout: 120_000,
}, async (t) => {
  const target = validateTarget(ENABLED, ADMIN_URL);
  const admin = new Client({ connectionString: target });
  await admin.connect();
  let databaseName;
  let pool;
  let server;
  try {
    await attest(admin);
    databaseName = `pilot_api_e2e_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE DATABASE ${quoteDatabase(databaseName)} TEMPLATE template0`);
    const url = new URL(target);
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString(), max: 12 });
    const migration = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../migrations/088_freight_creation_idempotency.sql', import.meta.url), 'utf8'));
    await pool.query(`
      CREATE TABLE empresas (id uuid PRIMARY KEY, tipo text NOT NULL);
      CREATE TABLE usuarios (id uuid PRIMARY KEY, status text NOT NULL);
      CREATE TABLE motoristas (
        id uuid PRIMARY KEY REFERENCES usuarios(id),
        placa_veiculo text,
        percentual_comissao numeric,
        empresa_id uuid NOT NULL REFERENCES empresas(id),
        unidade_operacional_id uuid
      );
      CREATE TABLE fretes (
        id uuid PRIMARY KEY,
        motorista_id uuid NOT NULL REFERENCES motoristas(id),
        empresa_id uuid NOT NULL REFERENCES empresas(id),
        unidade_operacional_id uuid,
        origem text,
        destino text,
        km_inicial numeric,
        valor_frete numeric,
        modalidade_calculo text,
        toneladas numeric,
        valor_tonelada_km numeric,
        quem_recebeu text,
        placa text,
        status text
      );
    `);
    await pool.query(migration);
    await pool.query(
      'INSERT INTO empresas(id,tipo) VALUES ($1,$3),($2,$3)',
      [ids.tenantA, ids.tenantB, 'transportadora'],
    );
    await pool.query(
      'INSERT INTO usuarios(id,status) VALUES ($1,$3),($2,$3)',
      [ids.driverA, ids.driverB, 'ativo'],
    );
    await pool.query(
      `INSERT INTO motoristas(id,placa_veiculo,percentual_comissao,empresa_id)
       VALUES ($1,'AAA1A11',10,$3),($2,'BBB2B22',12,$4)`,
      [ids.driverA, ids.driverB, ids.tenantA, ids.tenantB],
    );

    const actors = {
      'actor-a': { userId: randomUUID(), tenantId: ids.tenantA, canCreate: true },
      'actor-b': { userId: randomUUID(), tenantId: ids.tenantB, canCreate: true },
    };
    const notifications = { count: 0 };
    const app = createApp(new PgSupabaseAdapter(pool), actors, notifications);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('auth, persistencia, replay e notificacao unica', async () => {
      assert.equal((await post(baseUrl, 'missing', baseBody(ids.driverA))).status, 401);
      const first = await post(baseUrl, 'actor-a', baseBody(ids.driverA, { client_request_id: ids.requestA }));
      const retry = await post(baseUrl, 'actor-a', baseBody(ids.driverA, { client_request_id: ids.requestA }));
      assert.equal(first.status, 201);
      assert.equal(retry.status, 201);
      assert.equal(retry.body.id, first.body.id);
      assert.equal(retry.body.idempotent, true);
      assert.equal(notifications.count, 1);
      const persisted = await pool.query('SELECT * FROM fretes WHERE id=$1', [first.body.id]);
      assert.equal(persisted.rowCount, 1);
      assert.equal(persisted.rows[0].origem, 'Balsas');
    });

    await t.test('concorrencia converge para uma linha', async () => {
      const body = baseBody(ids.driverA, { client_request_id: ids.requestB, destino: 'Londrina' });
      const results = await Promise.all([
        post(baseUrl, 'actor-a', body),
        post(baseUrl, 'actor-a', body),
      ]);
      assert.deepEqual(results.map((item) => item.status), [201, 201]);
      assert.equal(results[0].body.id, results[1].body.id);
      const count = await pool.query('SELECT count(*)::int n FROM fretes WHERE empresa_id=$1 AND client_request_id=$2', [ids.tenantA, ids.requestB]);
      assert.equal(count.rows[0].n, 1);
    });

    await t.test('payload divergente retorna 409 e preserva intencao original', async () => {
      const conflict = await post(baseUrl, 'actor-a', baseBody(ids.driverA, {
        client_request_id: ids.requestA,
        destino: 'Destino divergente',
      }));
      assert.equal(conflict.status, 409);
      const original = await pool.query('SELECT destino FROM fretes WHERE empresa_id=$1 AND client_request_id=$2', [ids.tenantA, ids.requestA]);
      assert.equal(original.rows[0].destino, 'Palmas');
    });

    await t.test('revogacao e cross-tenant falham fechado', async () => {
      actors['actor-a'].canCreate = false;
      assert.equal((await post(baseUrl, 'actor-a', baseBody(ids.driverA, { client_request_id: ids.requestA }))).status, 403);
      actors['actor-a'].canCreate = true;
      assert.equal((await post(baseUrl, 'actor-a', baseBody(ids.driverB))).status, 403);
    });

    await t.test('mesma chave em tenant B e cliente legado permanecem compativeis', async () => {
      const tenantB = await post(baseUrl, 'actor-b', baseBody(ids.driverB, { client_request_id: ids.requestA }));
      assert.equal(tenantB.status, 201);
      assert.notEqual(tenantB.body.empresa_id, ids.tenantA);
      const legacyA = await post(baseUrl, 'actor-a', baseBody(ids.driverA, { destino: 'Legacy A' }));
      const legacyB = await post(baseUrl, 'actor-a', baseBody(ids.driverA, { destino: 'Legacy B' }));
      assert.equal(legacyA.status, 201);
      assert.equal(legacyB.status, 201);
      assert.notEqual(legacyA.body.id, legacyB.body.id);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    if (databaseName) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await admin.query(`DROP DATABASE ${quoteDatabase(databaseName)}`);
    }
    await admin.end();
  }
});

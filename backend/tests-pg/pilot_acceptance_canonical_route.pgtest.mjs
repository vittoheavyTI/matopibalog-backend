import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');
const { Pool, Client } = require('pg');

const ADMIN_URL = process.env.PILOT_API_E2E_ADMIN_URL;
const ENABLED = process.env.PILOT_API_E2E_PG;
const REQUESTED = ADMIN_URL !== undefined || ENABLED !== undefined;
const JWT_SECRET = 'pilot-canonical-route-synthetic-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.AUTH_SESSIONS_ENABLED = 'false';

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
  if (url.hostname !== '127.0.0.1') refuse('REMOTE_TARGET_REJECTED', 'Remote PostgreSQL is forbidden');
  if (url.port !== '5432') refuse('PORT_REJECTED', 'Unexpected PostgreSQL port');
  if (decodeURIComponent(url.pathname) !== '/postgres') refuse('DATABASE_REJECTED', 'Admin database must be postgres');
  if (decodeURIComponent(url.username) !== 'postgres') refuse('USER_REJECTED', 'Disposable superuser required');
  if (url.search || url.hash) refuse('OPTIONS_REJECTED', 'URL options are forbidden');
  return connectionString;
}

function quoteDatabase(name) {
  if (!/^pilot_canonical_[0-9a-f]{16}$/.test(name)) refuse('DATABASE_NAME_REJECTED', 'Invalid disposable namespace');
  return `"${name}"`;
}

function isExpectedServerAddress(value) {
  const address = String(value || '').replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  return address === '127.0.0.1' || address === '::1'
    || /^10\./.test(address) || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

async function attest(admin) {
  const result = await admin.query(`
    SELECT current_database() database_name, current_user user_name,
           inet_server_addr()::text server_address, inet_server_port() server_port,
           current_setting('server_version_num') server_version_num,
           current_setting('data_directory') data_directory,
           extract(epoch from (clock_timestamp() - pg_postmaster_start_time())) server_age,
           (SELECT count(*)::int FROM pg_database WHERE datallowconn AND NOT datistemplate) database_count
  `);
  const row = result.rows[0];
  if (row.database_name !== 'postgres' || row.user_name !== 'postgres'
      || !isExpectedServerAddress(row.server_address) || String(row.server_port) !== '5432'
      || Math.floor(Number(row.server_version_num) / 10000) !== 17
      || row.data_directory !== '/var/lib/postgresql/data'
      || Number(row.server_age) > 15 * 60 || row.database_count !== 1) {
    refuse('SERVER_ATTESTATION_REJECTED', 'Server is not the expected fresh disposable PostgreSQL 17');
  }
}

class PgQuery {
  constructor(pool, table) {
    this.pool = pool;
    this.table = table;
    this.filters = [];
    this.insertPayload = null;
  }
  select() { return this; }
  eq(field, value) { this.filters.push({ field, op: '=', value }); return this; }
  in(field, values) { this.filters.push({ field, op: 'IN', value: values }); return this; }
  order() { return this; }
  limit() { return this; }
  lt(field, value) { this.filters.push({ field, op: '<', value }); return this; }
  insert(payload) { this.insertPayload = { ...payload }; return this; }
  _where(start = 1) {
    const values = [];
    const clauses = this.filters.map((filter) => {
      if (filter.op === 'IN') {
        values.push(filter.value);
        return `${filter.field} = ANY($${start + values.length - 1})`;
      }
      values.push(filter.value);
      return `${filter.field} ${filter.op} $${start + values.length - 1}`;
    });
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
  }
  async _execute({ single = false, maybe = false } = {}) {
    try {
      if (this.insertPayload) {
        const payload = { id: randomUUID(), ...this.insertPayload };
        const fields = Object.keys(payload);
        const values = fields.map((field) => payload[field]);
        const placeholders = fields.map((_, index) => `$${index + 1}`);
        const result = await this.pool.query(
          `INSERT INTO ${this.table} (${fields.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
          values,
        );
        return { data: result.rows[0], error: null };
      }
      const where = this._where();
      const result = await this.pool.query(
        `SELECT * FROM ${this.table}${where.sql}${single || maybe ? ' LIMIT 1' : ''}`,
        where.values,
      );
      if ((single || maybe) && result.rowCount !== 1) {
        return maybe ? { data: null, error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: single || maybe ? result.rows[0] : result.rows, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code, message: error.message } };
    }
  }
  single() { return this._execute({ single: true }); }
  maybeSingle() { return this._execute({ maybe: true }); }
  then(resolve, reject) { return this._execute().then(resolve, reject); }
}

class PgSupabaseAdapter {
  constructor(pool) { this.pool = pool; }
  from(table) {
    const allowed = new Set([
      'usuarios', 'motoristas', 'empresas', 'fretes', 'contratos_comerciais',
      'unidades_operacionais', 'usuario_operacional_memberships',
      'regiao_operacional_unidades', 'grupo_empresarial_empresas',
    ]);
    if (!allowed.has(table)) {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; },
        maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'synthetic table absent' } }),
        single: async () => ({ data: null, error: { code: '42P01', message: 'synthetic table absent' } }),
        then: (resolve) => resolve({ data: [], error: { code: '42P01', message: 'synthetic table absent' } }),
      };
    }
    return new PgQuery(this.pool, table);
  }
}

const ids = {
  tenantA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  adminA: '10000000-0000-4000-8000-000000000001',
  driverA: '10000000-0000-4000-8000-000000000002',
  driverB: '10000000-0000-4000-8000-000000000003',
  requestA: '20000000-0000-4000-8000-000000000001',
  requestB: '20000000-0000-4000-8000-000000000002',
  unitAllowed: '30000000-0000-4000-8000-000000000001',
  unitForbidden: '30000000-0000-4000-8000-000000000002',
};

const baseBody = (driver = ids.driverA, overrides = {}) => ({
  motorista_id: driver,
  origem: 'Balsas',
  destino: 'Palmas',
  valor_frete: 1500,
  quem_recebeu: 'proprietario',
  ...overrides,
});

async function post(baseUrl, token, body, { permission = true } = {}) {
  const headers = { 'content-type': 'application/json', 'x-test-effective-permission': permission ? 'allow' : 'deny' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/fretes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('guard da rota canonica recusa ausencia, banco inesperado e endpoints remotos', () => {
  assert.throws(() => validateTarget(undefined, 'postgres://postgres:postgres@127.0.0.1:5432/postgres'), { code: 'HARNESS_DISABLED' });
  assert.throws(() => validateTarget('1', 'postgres://postgres:postgres@127.0.0.1:5432/production'), { code: 'DATABASE_REJECTED' });
  assert.throws(() => validateTarget('1', 'postgres://postgres:secret@db.example.supabase.co:5432/postgres'), { code: 'REMOTE_TARGET_REJECTED' });
  assert.equal(isExpectedServerAddress('172.18.0.2'), true);
  assert.equal(isExpectedServerAddress('203.0.113.10'), false);
});

if (!REQUESTED) {
  test('rota canonica requer PostgreSQL descartavel explicito', { skip: true }, () => {});
}

test('POST /fretes percorre router, middlewares, controller e servico de producao', {
  skip: !REQUESTED,
  timeout: 120_000,
}, async (t) => {
  const target = validateTarget(ENABLED, ADMIN_URL);
  const admin = new Client({ connectionString: target });
  await admin.connect();
  let databaseName;
  let pool;
  let server;
  const notifications = { count: 0 };
  const originalLoad = Module._load;
  try {
    await attest(admin);
    databaseName = `pilot_canonical_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE DATABASE ${quoteDatabase(databaseName)} TEMPLATE template0`);
    const url = new URL(target);
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString(), max: 12 });
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE empresas (
        id uuid PRIMARY KEY, tipo text NOT NULL, status text NOT NULL DEFAULT 'ativo',
        trial_ends_at timestamptz, operational_scope_mode text DEFAULT 'legacy'
      );
      CREATE TABLE usuarios (
        id uuid PRIMARY KEY, empresa_id uuid REFERENCES empresas(id), tipo text NOT NULL,
        status text NOT NULL, is_super_admin boolean NOT NULL DEFAULT false
      );
      CREATE TABLE motoristas (
        id uuid PRIMARY KEY REFERENCES usuarios(id), placa_veiculo text,
        percentual_comissao numeric, empresa_id uuid NOT NULL REFERENCES empresas(id),
        unidade_operacional_id uuid
      );
      CREATE TABLE fretes (
        id uuid PRIMARY KEY, motorista_id uuid NOT NULL REFERENCES motoristas(id),
        empresa_id uuid NOT NULL REFERENCES empresas(id), unidade_operacional_id uuid,
        origem text, destino text, km_inicial numeric, valor_frete numeric,
        modalidade_calculo text, toneladas numeric, valor_tonelada_km numeric,
        quem_recebeu text, placa text, status text
      );
      CREATE TABLE contratos_comerciais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, status text, obrigatorio boolean
      );
      CREATE TABLE unidades_operacionais (
        id uuid PRIMARY KEY, empresa_id uuid, grupo_id uuid, nome text, codigo text,
        tipo text, status text, is_default boolean
      );
      CREATE TABLE usuario_operacional_memberships (
        id uuid PRIMARY KEY, usuario_id uuid, empresa_id uuid, grupo_id uuid,
        unidade_operacional_id uuid, regiao_operacional_id uuid,
        scope_level text, papel text, status text
      );
      CREATE TABLE regiao_operacional_unidades (regiao_id uuid, empresa_id uuid, unidade_operacional_id uuid, status text);
      CREATE TABLE grupo_empresarial_empresas (grupo_id uuid, empresa_id uuid, status text);
    `);
    const migration = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../migrations/088_freight_creation_idempotency.sql', import.meta.url), 'utf8'));
    await pool.query(migration);
    await pool.query(
      `INSERT INTO empresas(id,tipo,status,operational_scope_mode)
       VALUES ($1,'transportadora','ativo','enforced'),($2,'transportadora','ativo','legacy')`,
      [ids.tenantA, ids.tenantB],
    );
    await pool.query(
      `INSERT INTO usuarios(id,empresa_id,tipo,status)
       VALUES ($1,$2,'admin','ativo'),($3,$2,'motorista','ativo'),($4,$5,'motorista','ativo')`,
      [ids.adminA, ids.tenantA, ids.driverA, ids.driverB, ids.tenantB],
    );
    await pool.query(
      `INSERT INTO motoristas(id,placa_veiculo,percentual_comissao,empresa_id)
       VALUES ($1,'AAA1A11',10,$2),($3,'BBB2B22',12,$4)`,
      [ids.driverA, ids.tenantA, ids.driverB, ids.tenantB],
    );
    await pool.query(
      `INSERT INTO unidades_operacionais(id,empresa_id,nome,codigo,tipo,status,is_default)
       VALUES ($1,$3,'Permitida','PA037-A','filial','ativo',true),
              ($2,$3,'Fora do escopo','PA037-B','filial','ativo',false)`,
      [ids.unitAllowed, ids.unitForbidden, ids.tenantA],
    );
    await pool.query(
      `INSERT INTO usuario_operacional_memberships
         (id,usuario_id,empresa_id,unidade_operacional_id,scope_level,papel,status)
       VALUES ($1,$2,$3,$4,'LOCAL','admin','ativo')`,
      [randomUUID(), ids.adminA, ids.tenantA, ids.unitAllowed],
    );

    const adapter = new PgSupabaseAdapter(pool);
    Module._load = function (request, parent, isMain) {
      const normalized = typeof request === 'string' ? request.replace(/\\/g, '/') : request;
      if (normalized.endsWith('config/supabase')) return adapter;
      if (normalized.endsWith('services/notificacaoService')) {
        return {
          notificarFreteCriado: async () => { notifications.count += 1; },
          notificarViagemFinalizada: async () => {},
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    for (const modulePath of [
      '../routes/fretes', '../controllers/fretesController', '../middlewares/tenant',
      '../middlewares/verificarPlano', '../middlewares/requirePermission',
      '../services/operationalScopeService',
    ]) {
      delete require.cache[require.resolve(modulePath)];
    }
    const router = require('../routes/fretes');
    Module._load = originalLoad;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req._effectivePermissions = {
        permissions: { 'freight.create': req.get('x-test-effective-permission') === 'allow' },
      };
      next();
    });
    app.use('/fretes', router);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ uid: ids.adminA, role: 'admin', is_super_admin: false }, JWT_SECRET);
    const invalidToken = 'invalid.jwt.token';

    await t.test('API-001/002 auth ausente ou invalida e rejeitada pelo verifyToken real', async () => {
      assert.equal((await post(baseUrl, null, baseBody())).status, 401);
      assert.equal((await post(baseUrl, invalidToken, baseBody())).status, 403);
    });
    await t.test('API-003 permission middleware real nega freight.create', async () => {
      assert.equal((await post(baseUrl, adminToken, baseBody(), { permission: false })).status, 403);
    });
    await t.test('API-004 plano bloqueado impede a escrita', async () => {
      await pool.query(`UPDATE empresas SET status='bloqueado' WHERE id=$1`, [ids.tenantA]);
      assert.equal((await post(baseUrl, adminToken, baseBody())).status, 403);
      await pool.query(`UPDATE empresas SET status='ativo' WHERE id=$1`, [ids.tenantA]);
    });
    await t.test('API-005 motorista de outro tenant e rejeitado', async () => {
      assert.equal((await post(baseUrl, adminToken, baseBody(ids.driverB))).status, 403);
    });
    await t.test('API-006 unidade solicitada fora do escopo e rejeitada', async () => {
      const response = await post(baseUrl, adminToken, baseBody(ids.driverA, {
        unidade_operacional_id: ids.unitForbidden,
      }));
      assert.equal(response.status, 403);
    });
    await t.test('API-007/008/012/016 persiste, replays e notifica uma vez', async () => {
      const notificationsBefore = notifications.count;
      const body = baseBody(ids.driverA, { client_request_id: ids.requestA });
      const first = await post(baseUrl, adminToken, body);
      const replay = await post(baseUrl, adminToken, body);
      assert.equal(first.status, 201);
      assert.equal(replay.status, 201);
      assert.equal(replay.body.id, first.body.id);
      assert.equal(replay.body.idempotent, true);
      assert.equal(notifications.count, notificationsBefore + 1);
      const audit = await pool.query(
        'SELECT empresa_id,client_request_id FROM fretes WHERE id=$1', [first.body.id],
      );
      assert.deepEqual(audit.rows[0], {
        empresa_id: ids.tenantA,
        client_request_id: ids.requestA,
      });
    });
    await t.test('API-009 concorrencia converge para uma linha', async () => {
      const body = baseBody(ids.driverA, { client_request_id: ids.requestB, destino: 'Londrina' });
      const responses = await Promise.all([
        post(baseUrl, adminToken, body),
        post(baseUrl, adminToken, body),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [201, 201]);
      assert.equal(responses[0].body.id, responses[1].body.id);
      const count = await pool.query(
        'SELECT count(*)::int n FROM fretes WHERE empresa_id=$1 AND client_request_id=$2',
        [ids.tenantA, ids.requestB],
      );
      assert.equal(count.rows[0].n, 1);
    });
    await t.test('API-010 payload divergente retorna conflito', async () => {
      const response = await post(baseUrl, adminToken, baseBody(ids.driverA, {
        client_request_id: ids.requestA,
        destino: 'Destino divergente',
      }));
      assert.equal(response.status, 409);
    });
    await t.test('API-011 replay com permissao revogada e rejeitado', async () => {
      assert.equal((await post(
        baseUrl,
        adminToken,
        baseBody(ids.driverA, { client_request_id: ids.requestA }),
        { permission: false },
      )).status, 403);
    });
    await t.test('API-013 cliente legado cria requisicoes independentes', async () => {
      const first = await post(baseUrl, adminToken, baseBody(ids.driverA, { destino: 'Legacy A' }));
      const second = await post(baseUrl, adminToken, baseBody(ids.driverA, { destino: 'Legacy B' }));
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.notEqual(first.body.id, second.body.id);
    });
    await t.test('API-014 placa derivada mutavel nao cria falso conflito', async () => {
      await pool.query(`UPDATE motoristas SET placa_veiculo='CCC3C33' WHERE id=$1`, [ids.driverA]);
      const replay = await post(baseUrl, adminToken, baseBody(ids.driverA, {
        client_request_id: ids.requestA,
      }));
      assert.equal(replay.status, 201);
      assert.equal(replay.body.idempotent, true);
      assert.equal(replay.body.placa, 'AAA1A11');
    });
  } finally {
    Module._load = originalLoad;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    if (databaseName) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await admin.query(`DROP DATABASE ${quoteDatabase(databaseName)}`);
    }
    await admin.end();
  }
});

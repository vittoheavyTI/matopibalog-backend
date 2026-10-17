import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// O client inicializa o modulo Realtime mesmo quando esta prova usa somente
// Auth/PostgREST/Storage. Node 20 nao possui WebSocket global; este construtor
// inerte impede apenas a inicializacao de Realtime, que esta excluido do stack.
globalThis.WebSocket ??= class WebSocket {};

const { Client } = pg;
const API_URL = process.env.PA037_SUPABASE_API_URL;
const DB_URL = process.env.PA037_SUPABASE_DB_URL;
const ANON_KEY = process.env.PA037_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.PA037_SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.PA037_ISOLATED_SUPABASE === '1';

function assertIsolatedTarget({
  enabled = ENABLED,
  apiUrl = API_URL,
  dbUrl = DB_URL,
  anonKey = ANON_KEY,
  serviceRoleKey = SERVICE_ROLE_KEY,
} = {}) {
  assert.equal(enabled, true, 'PA037_ISOLATED_SUPABASE must be exactly 1');
  const api = new URL(apiUrl);
  const db = new URL(dbUrl);
  assert.equal(api.protocol, 'http:');
  assert.equal(api.hostname, '127.0.0.1');
  assert.equal(api.port, '54321');
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, '54322');
  assert.equal(db.pathname, '/postgres');
  assert.equal(db.username, 'postgres');
  assert.ok(anonKey);
  assert.ok(serviceRoleKey);
  for (const value of [apiUrl, dbUrl]) {
    assert.doesNotMatch(value, /supabase\.co|railway|production/i);
  }
}

const ids = {
  tenantA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  freightA: '11111111-1111-4111-8111-111111111111',
  freightB: '22222222-2222-4222-8222-222222222222',
};

const schemaSql = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE public.empresas (id uuid PRIMARY KEY, tipo text NOT NULL);
  CREATE TABLE public.usuarios (
    id uuid PRIMARY KEY,
    empresa_id uuid REFERENCES public.empresas(id),
    tipo text NOT NULL,
    is_super_admin boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'ativo'
  );
  CREATE TABLE public.motoristas (
    id uuid PRIMARY KEY REFERENCES public.usuarios(id),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id),
    placa_veiculo text,
    percentual_comissao numeric,
    unidade_operacional_id uuid
  );
  CREATE TABLE public.fretes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    motorista_id uuid NOT NULL REFERENCES public.motoristas(id),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id),
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
  CREATE TABLE public.despesas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), motorista_id uuid NOT NULL, empresa_id uuid NOT NULL);
  CREATE TABLE public.abastecimentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), motorista_id uuid NOT NULL, empresa_id uuid NOT NULL);
  CREATE TABLE public.vales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), motorista_id uuid NOT NULL, empresa_id uuid NOT NULL);
  CREATE TABLE public.planos (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
`;

test('guard PA-037 recusa desabilitacao, banco inesperado e endpoints remotos', () => {
  const local = {
    enabled: true,
    apiUrl: 'http://127.0.0.1:54321',
    dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    anonKey: 'synthetic-anon',
    serviceRoleKey: 'synthetic-service-role',
  };
  assert.doesNotThrow(() => assertIsolatedTarget(local));
  assert.throws(() => assertIsolatedTarget({ ...local, enabled: false }), /must be exactly 1/);
  assert.throws(() => assertIsolatedTarget({
    ...local,
    dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/production',
  }));
  assert.throws(() => assertIsolatedTarget({
    ...local,
    apiUrl: 'https://project.supabase.co',
  }));
  assert.throws(() => assertIsolatedTarget({
    ...local,
    dbUrl: 'postgresql://postgres:secret@remote.example:5432/postgres',
  }));
});

function authenticatedClient(token) {
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

test('PA-037 usa Auth, PostgREST, Storage e RLS oficiais em Supabase CLI descartavel', {
  skip: !ENABLED,
  timeout: 180_000,
}, async (t) => {
  assertIsolatedTarget();
  const db = new Client({ connectionString: DB_URL });
  const service = createClient(API_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const createdUsers = [];
  const createdBuckets = ['comprovantes', 'fretes-documentos', 'fretes-evidencias', 'fretes-odometro'];
  await db.connect();
  try {
    const identity = await db.query(`
      SELECT current_database() database_name,
             current_user user_name,
             inet_server_addr()::text server_address,
             inet_server_port() server_port,
             current_setting('server_version_num') server_version_num
    `);
    assert.equal(identity.rows[0].database_name, 'postgres');
    assert.equal(identity.rows[0].user_name, 'postgres');
    // DB_URL reaches the CLI port mapping on 54322; PostgreSQL itself listens
    // on 5432 inside the disposable container.
    assert.equal(String(identity.rows[0].server_port), '5432');
    assert.equal(Math.floor(Number(identity.rows[0].server_version_num) / 10000), 17);

    await db.query(schemaSql);
    for (const migrationName of [
      '088_freight_creation_idempotency.sql',
      '015_enable_rls_critical_tables.sql',
      '026_create_frete_documentos.sql',
    ]) {
      const sql = await readFile(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8');
      await db.query(sql);
    }
    await db.query(`
      INSERT INTO public.empresas(id,tipo) VALUES ($1,'transportadora'),($2,'transportadora');
    `, [ids.tenantA, ids.tenantB]);

    const credentials = [
      { email: 'pa037-a@example.invalid', password: 'Synthetic-PA037-A-2026!' },
      { email: 'pa037-b@example.invalid', password: 'Synthetic-PA037-B-2026!' },
    ];
    for (const credential of credentials) {
      const { data, error } = await service.auth.admin.createUser({
        ...credential,
        email_confirm: true,
      });
      assert.ifError(error);
      createdUsers.push(data.user.id);
    }
    await db.query(
      `INSERT INTO public.usuarios(id,empresa_id,tipo,status)
       VALUES ($1,$2,'motorista','ativo'),($3,$4,'motorista','ativo')`,
      [createdUsers[0], ids.tenantA, createdUsers[1], ids.tenantB],
    );
    await db.query(
      `INSERT INTO public.motoristas(id,empresa_id,placa_veiculo,percentual_comissao)
       VALUES ($1,$2,'AAA1A11',10),($3,$4,'BBB2B22',10)`,
      [createdUsers[0], ids.tenantA, createdUsers[1], ids.tenantB],
    );
    await db.query(
      `INSERT INTO public.fretes(id,motorista_id,empresa_id,origem,destino,status)
       VALUES ($1,$2,$3,'A','B','ativo'),($4,$5,$6,'C','D','ativo')`,
      [ids.freightA, createdUsers[0], ids.tenantA, ids.freightB, createdUsers[1], ids.tenantB],
    );
    await db.query(
      `INSERT INTO public.frete_documentos(frete_id,empresa_id,tipo,storage_path)
       VALUES ($1,$2,'cte','tenant-a/a.pdf'),($3,$4,'cte','tenant-b/b.pdf')`,
      [ids.freightA, ids.tenantA, ids.freightB, ids.tenantB],
    );
    await db.query("NOTIFY pgrst, 'reload schema'");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await t.test('Auth real emite sessoes distintas', async (authTest) => {
      const sessions = [];
      for (const credential of credentials) {
        const { data, error } = await anon.auth.signInWithPassword(credential);
        assert.ifError(error);
        assert.ok(data.session?.access_token);
        sessions.push(data.session.access_token);
      }
      const clientA = authenticatedClient(sessions[0]);
      const clientB = authenticatedClient(sessions[1]);

      await authTest.test('PostgREST aplica as policies reais 015 e 026 por tenant', async () => {
        const { data: anonymousFreights, error: anonymousError } = await anon.from('fretes').select('id');
        assert.ifError(anonymousError);
        assert.deepEqual(anonymousFreights, []);

        const { data: freightA, error: freightAError } = await clientA.from('fretes').select('id,empresa_id');
        assert.ifError(freightAError);
        assert.deepEqual(freightA.map((row) => row.id), [ids.freightA]);
        const { data: freightB, error: freightBError } = await clientB.from('fretes').select('id,empresa_id');
        assert.ifError(freightBError);
        assert.deepEqual(freightB.map((row) => row.id), [ids.freightB]);

        const { data: documentsA, error: documentsAError } = await clientA
          .from('frete_documentos').select('empresa_id,storage_path');
        assert.ifError(documentsAError);
        assert.deepEqual(documentsA.map((row) => row.storage_path), ['tenant-a/a.pdf']);
      });

      await authTest.test('Storage real preserva bucket publico e bloqueia buckets privados', async () => {
        for (const bucket of createdBuckets) {
          const { error } = await service.storage.createBucket(bucket, {
            public: bucket === 'comprovantes',
            allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'application/xml', 'text/xml'],
            fileSizeLimit: 1024 * 1024,
          });
          assert.ifError(error);
        }
        const publicBody = new TextEncoder().encode('synthetic avatar');
        const privateA = new TextEncoder().encode('%PDF synthetic tenant A');
        const privateB = new TextEncoder().encode('%PDF synthetic tenant B sentinel');
        assert.ifError((await service.storage.from('comprovantes').upload(
          'avatars/pa037-avatar.png', publicBody, { contentType: 'image/png' },
        )).error);
        assert.ifError((await service.storage.from('fretes-documentos').upload(
          'tenant-a/a.pdf', privateA, { contentType: 'application/pdf' },
        )).error);
        assert.ifError((await service.storage.from('fretes-documentos').upload(
          'tenant-b/sentinel.pdf', privateB, { contentType: 'application/pdf' },
        )).error);

        const publicUrl = service.storage.from('comprovantes')
          .getPublicUrl('avatars/pa037-avatar.png').data.publicUrl;
        assert.equal((await fetch(publicUrl)).status, 200);
        const privatePublicUrl = service.storage.from('fretes-documentos')
          .getPublicUrl('tenant-b/sentinel.pdf').data.publicUrl;
        assert.notEqual((await fetch(privatePublicUrl)).status, 200);
        assert.ok((await anon.storage.from('fretes-documentos').download('tenant-b/sentinel.pdf')).error);
        assert.ok((await clientA.storage.from('fretes-documentos').download('tenant-b/sentinel.pdf')).error);
        assert.ok((await clientA.storage.from('fretes-documentos').upload(
          'tenant-a/direct.pdf', privateA, { contentType: 'application/pdf' },
        )).error);
        assert.ok((await clientA.storage.from('fretes-documentos').upload(
          '../tenant-b/escape.pdf', privateA, { contentType: 'application/pdf' },
        )).error);

        const mimeDenied = await service.storage.from('fretes-documentos').upload(
          'tenant-a/denied.txt', new TextEncoder().encode('no'), { contentType: 'text/plain' },
        );
        assert.ok(mimeDenied.error);

        const signed = await service.storage.from('fretes-documentos')
          .createSignedUrl('tenant-a/a.pdf', 1);
        assert.ifError(signed.error);
        assert.equal((await fetch(signed.data.signedUrl)).status, 200);
        await new Promise((resolve) => setTimeout(resolve, 2200));
        assert.notEqual((await fetch(signed.data.signedUrl)).status, 200);
        const missing = await service.storage.from('fretes-documentos').download('tenant-a/missing.pdf');
        assert.ok(missing.error);

        assert.ifError((await service.storage.from('fretes-documentos').upload(
          'tenant-a/idempotent.pdf', privateA, { contentType: 'application/pdf', upsert: true },
        )).error);
        assert.ifError((await service.storage.from('fretes-documentos').upload(
          'tenant-a/idempotent.pdf', privateA, { contentType: 'application/pdf', upsert: true },
        )).error);
        const listed = await service.storage.from('fretes-documentos').list('tenant-a');
        assert.ifError(listed.error);
        assert.equal(listed.data.filter((entry) => entry.name === 'idempotent.pdf').length, 1);

        assert.ifError((await service.storage.from('fretes-documentos').upload(
          'tenant-a/metadata-failure.pdf', privateA, { contentType: 'application/pdf' },
        )).error);
        await assert.rejects(db.query(
          `INSERT INTO public.frete_documentos(frete_id,empresa_id,tipo,storage_path)
           VALUES ('99999999-9999-4999-8999-999999999999',$1,'cte','tenant-a/metadata-failure.pdf')`,
          [ids.tenantA],
        ));
        assert.ifError((await service.storage.from('fretes-documentos')
          .remove(['tenant-a/metadata-failure.pdf'])).error);
        assert.ifError((await service.storage.from('fretes-documentos')
          .download('tenant-b/sentinel.pdf')).error);

        const buckets = await service.storage.listBuckets();
        assert.ifError(buckets.error);
        assert.equal(buckets.data.filter((bucket) => bucket.id === 'avatars').length, 0);
        assert.ok(buckets.data.some((bucket) => bucket.id === 'comprovantes'));
      });
    });
  } finally {
    for (const bucket of createdBuckets) {
      const listed = await service.storage.from(bucket).list('', { limit: 100 }).catch(() => ({ data: [] }));
      const rootFiles = (listed.data || []).filter((entry) => entry.id).map((entry) => entry.name);
      if (rootFiles.length) await service.storage.from(bucket).remove(rootFiles);
      for (const prefix of ['avatars', 'tenant-a', 'tenant-b']) {
        const nested = await service.storage.from(bucket).list(prefix, { limit: 100 }).catch(() => ({ data: [] }));
        const paths = (nested.data || []).filter((entry) => entry.id).map((entry) => `${prefix}/${entry.name}`);
        if (paths.length) await service.storage.from(bucket).remove(paths);
      }
      await service.storage.deleteBucket(bucket).catch(() => {});
    }
    for (const userId of createdUsers) {
      await service.auth.admin.deleteUser(userId).catch(() => {});
    }
    await db.end();
  }
});

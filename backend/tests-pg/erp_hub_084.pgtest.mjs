import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  test('DATABASE_URL ausente', { skip: true }, () => {});
}

async function client() {
  const c = new pg.Client({ connectionString: CONN });
  await c.connect();
  return c;
}

async function one(c, sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows[0];
}

function envelope(empresaId, eventId, payload = { valor: 1 }) {
  return {
    schema_version: 1,
    event_id: eventId,
    request_id: null,
    correlation_id: null,
    empresa_id: empresaId,
    entity_type: 'frete',
    entity_id: 'frete-1',
    event_type: 'frete.updated',
    occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    source: 'pgtest',
    payload,
    metadata: {},
  };
}

test('084 ERP outbox: idempotency conflict, claim race, stale claim and reconcile-before-resend', async () => {
  const c = await client();
  const c2 = await client();
  try {
    const empresa = await one(c, "insert into public.empresas(nome) values ('ERP PG A') returning id");
    const env = envelope(empresa.id, 'evt-1');

    const inserted = await one(c, 'select * from public.erp_enqueue_outbox($1,$2,$3,$4)', [
      'fake', env, 'a'.repeat(64), 'erp:fake:' + '1'.repeat(64),
    ]);
    assert.equal(inserted.code, 'inserted');

    const dup = await one(c, 'select * from public.erp_enqueue_outbox($1,$2,$3,$4)', [
      'fake', env, 'a'.repeat(64), 'erp:fake:' + '1'.repeat(64),
    ]);
    assert.equal(dup.code, 'duplicate');

    const conflict = await one(c, 'select * from public.erp_enqueue_outbox($1,$2,$3,$4)', [
      'fake', { ...env, payload: { valor: 2 } }, 'b'.repeat(64), 'erp:fake:' + '2'.repeat(64),
    ]);
    assert.equal(conflict.code, 'idempotency_conflict');

    const claim1 = await one(c, "select * from public.erp_claim_next_outbox('SEND','worker-a',300)");
    assert.equal(claim1.code, 'claimed');
    const claim2 = await one(c2, "select * from public.erp_claim_next_outbox('SEND','worker-b',300)");
    assert.equal(claim2.code, 'empty');

    const failed = await one(c, 'select * from public.erp_mark_outbox_failed($1,$2,$3,$4,$5)', [
      claim1.item_id, claim1.claim_token, 'timeout Bearer secret-token-value', false, null,
    ]);
    assert.equal(failed.code, 'failed');
    assert.equal(failed.next_action, 'RECONCILE');

    const noSend = await one(c, "select * from public.erp_claim_next_outbox('SEND','worker-c',300)");
    assert.equal(noSend.code, 'empty');
    const rec = await one(c, "select * from public.erp_claim_next_outbox('RECONCILE','worker-r',300)");
    assert.equal(rec.code, 'claimed');

    const old = await one(c, 'select * from public.erp_mark_outbox_succeeded($1,$2,$3,$4)', [
      claim1.item_id, claim1.claim_token, 'external-ok', {},
    ]);
    assert.equal(old.code, 'stale_claim');

    const unknown = await one(c, "select * from public.erp_record_outbox_reconcile($1,$2,'UNKNOWN',false,null)", [
      rec.item_id, rec.claim_token,
    ]);
    assert.equal(unknown.code, 'reconcile_again');
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.next_action, 'RECONCILE');
  } finally {
    await c.end();
    await c2.end();
  }
});

test('084 ERP external identity: tenant/provider uniqueness and collision-safe rebind', async () => {
  const c = await client();
  try {
    const a = await one(c, "insert into public.empresas(nome) values ('ERP Tenant A') returning id");
    const b = await one(c, "insert into public.empresas(nome) values ('ERP Tenant B') returning id");

    const bound = await one(c, 'select * from public.erp_bind_external_identity($1,$2,$3,$4,$5,$6)', [
      a.id, 'fake', 'frete', 'int-1', 'ext-1', {},
    ]);
    assert.equal(bound.code, 'bound');

    const sameOtherTenant = await one(c, 'select * from public.erp_bind_external_identity($1,$2,$3,$4,$5,$6)', [
      b.id, 'fake', 'frete', 'int-1', 'ext-1', {},
    ]);
    assert.equal(sameOtherTenant.code, 'bound');

    const sameOtherProvider = await one(c, 'select * from public.erp_bind_external_identity($1,$2,$3,$4,$5,$6)', [
      a.id, 'other', 'frete', 'int-1', 'ext-1', {},
    ]);
    assert.equal(sameOtherProvider.code, 'bound');

    const owner = await one(c, 'select * from public.erp_bind_external_identity($1,$2,$3,$4,$5,$6)', [
      a.id, 'fake', 'frete', 'int-2', 'ext-2', {},
    ]);
    assert.equal(owner.code, 'bound');

    const collision = await one(c, 'select * from public.erp_rebind_external_identity($1,$2,$3,$4,$5,$6)', [
      a.id, 'fake', 'frete', 'int-1', 'ext-2', 'teste de colisao',
    ]);
    assert.equal(collision.code, 'conflict_external_already_bound');

    const preserved = await one(c, 'select external_entity_id from public.erp_external_identity_mappings where empresa_id=$1 and provider=$2 and entity_type=$3 and internal_entity_id=$4', [
      a.id, 'fake', 'frete', 'int-1',
    ]);
    assert.equal(preserved.external_entity_id, 'ext-1');
  } finally {
    await c.end();
  }
});

test('084 DB-SEC: RLS enabled and no anon/authenticated direct grants or public execute', async () => {
  const c = await client();
  try {
    const tables = await c.query(`
      select relname, relrowsecurity
      from pg_class
      where oid in ('public.erp_outbox'::regclass, 'public.erp_external_identity_mappings'::regclass)
      order by relname
    `);
    assert.deepEqual(tables.rows.map((r) => [r.relname, r.relrowsecurity]), [
      ['erp_external_identity_mappings', true],
      ['erp_outbox', true],
    ]);

    const directGrants = await c.query(`
      select grantee, table_name, privilege_type
      from information_schema.table_privileges
      where table_schema='public'
        and table_name in ('erp_outbox','erp_external_identity_mappings')
        and grantee in ('anon','authenticated','PUBLIC')
    `);
    assert.equal(directGrants.rowCount, 0);

    const badExec = await c.query(`
      select p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.rolname in ('anon','authenticated','public')
      where n.nspname='public'
        and p.proname like 'erp_%'
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    `);
    assert.equal(badExec.rowCount, 0);

    const mutablePath = await c.query(`
      select proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public'
        and p.proname like 'erp_%'
        and (p.proconfig is null or not exists (
          select 1 from unnest(p.proconfig) c where c like 'search_path=%'
        ))
    `);
    assert.equal(mutablePath.rowCount, 0);
  } finally {
    await c.end();
  }
});

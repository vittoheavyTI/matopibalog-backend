// PG real (CI): certifica a migration 075 Fleet Operational Closure sobre 074.
// Nunca roda contra producao: exige DATABASE_URL do Postgres efemero da CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('fleet operational closure 075 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const sqlsBefore075 = [
    migration('026_create_frete_documentos.sql'),
    migration('048_create_frete_epod.sql'),
    migration('049_create_frete_ocorrencias.sql'),
    migration('050_epod_evidencia_status.sql'),
    migration('073_documents_foundation_security_web.sql'),
    migration('074_fleet_foundation.sql'),
  ];
  const sql075 = migration('075_fleet_operational_closure.sql');

  const EMP_A = '07500000-0000-4000-a000-000000000001';
  const EMP_B = '07500000-0000-4000-a000-000000000002';
  const PLAN_A = '07500000-0000-4000-a000-0000000000a1';
  const PLAN_B = '07500000-0000-4000-a000-0000000000b1';
  const ADM_A = '07500000-0000-4000-a000-000000000101';
  const ADM_B = '07500000-0000-4000-a000-000000000102';
  const MOT_A = '07500000-0000-4000-a000-000000000201';
  const MOT_A2 = '07500000-0000-4000-a000-000000000203';
  const MOT_B = '07500000-0000-4000-a000-000000000202';
  const UNIT_A = '07500000-0000-4000-a000-000000000301';
  const UNIT_A2 = '07500000-0000-4000-a000-000000000303';
  const UNIT_B = '07500000-0000-4000-a000-000000000302';
  const ASSET_A = '07500000-0000-4000-a000-000000000401';
  const ASSET_A2 = '07500000-0000-4000-a000-000000000403';
  const ASSET_A3 = '07500000-0000-4000-a000-000000000405';
  const ASSET_B = '07500000-0000-4000-a000-000000000402';
  const COMP_A = '07500000-0000-4000-a000-000000000501';
  const FRETE_A = '07500000-0000-4000-a000-000000000601';
  const FRETE_B = '07500000-0000-4000-a000-000000000602';
  const TIRE_INSTALLED = '07500000-0000-4000-a000-000000000701';
  const TIRE_STOCK_A = '07500000-0000-4000-a000-000000000702';
  const TIRE_STOCK_B = '07500000-0000-4000-a000-000000000703';

  const pool = new Pool({ connectionString: CONN });

  async function withRole(role, fn) {
    const client = await pool.connect();
    await client.query(`SET ROLE ${role}`);
    try {
      return await fn(client);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }
  }

  async function withAuth(uid, fn) {
    const client = await pool.connect();
    await client.query('SET ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    try {
      return await fn(client);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query(`SELECT set_config('request.jwt.claim.sub', '', false)`).catch(() => {});
      client.release();
    }
  }

  before(async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT COALESCE((SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_empresa_id()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;
    `);

    await pool.query(
      `INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
       VALUES ($1,'Fleet 075 Plano A','empresa',20,20,false),($2,'Fleet 075 Plano B','empresa',20,20,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Fleet 075 Empresa A','ativo',$2,'enforced'),($3,'Fleet 075 Empresa B','ativo',$4,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A, EMP_B, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'admin','ativo',false,'Admin 075 A'),
              ($3,$4,'admin','ativo',false,'Admin 075 B'),
              ($5,$2,'motorista','ativo',false,'Motorista 075 A'),
              ($6,$4,'motorista','ativo',false,'Motorista 075 B'),
              ($7,$2,'motorista','ativo',false,'Motorista 075 A2')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, ADM_B, EMP_B, MOT_A, MOT_B, MOT_A2],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade 075 A','ativo',true),
              ($3,$4,'Unidade 075 B','ativo',true),
              ($5,$2,'Unidade 075 A2','ativo',false)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A, UNIT_B, EMP_B, UNIT_A2],
    );
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data, modalidade_calculo, valor_frete, km_inicial, km_final)
       VALUES ($1,$2,$3,'ativo',now(),'valor_fixo',100,10,20),
              ($4,$5,$6,'ativo',now(),'valor_fixo',200,30,40)
       ON CONFLICT (id) DO NOTHING`,
      [FRETE_A, EMP_A, MOT_A, FRETE_B, EMP_B, MOT_B],
    );

    for (const sql of sqlsBefore075) await pool.query(sql);

    await pool.query(
      `INSERT INTO public.fleet_assets (id, empresa_id, unidade_operacional_id, asset_type, internal_identifier, plate)
       VALUES ($1,$2,$3,'tractor','075-A-TRACTOR','PGA0A75'),
              ($4,$5,$6,'tractor','075-B-TRACTOR','PGB0B75'),
              ($7,$2,$8,'truck','075-A2-TRUCK','PGA2A75'),
              ($9,$2,$3,'truck','075-A3-TRUCK','PGA3A75')
       ON CONFLICT (id) DO NOTHING`,
      [ASSET_A, EMP_A, UNIT_A, ASSET_B, EMP_B, UNIT_B, ASSET_A2, UNIT_A2, ASSET_A3],
    );
    await pool.query(
      `INSERT INTO public.vehicle_compositions (id, empresa_id, unidade_operacional_id, code)
       VALUES ($1,$2,$3,'075-COMP-A')
       ON CONFLICT (id) DO NOTHING`,
      [COMP_A, EMP_A, UNIT_A],
    );
    await pool.query(
      `INSERT INTO public.tires (id, empresa_id, fire_number, status, current_asset_id)
       VALUES ($1,$2,'075-INSTALLED','installed',$3)
       ON CONFLICT (id) DO NOTHING`,
      [TIRE_INSTALLED, EMP_A, ASSET_A],
    );

    await pool.query(sql075);
    await pool.query(sql075);

    await pool.query(
      `INSERT INTO public.tires (id, empresa_id, fire_number, status, unidade_operacional_id)
       VALUES ($1,$2,'075-STOCK-A','stock',$3),($4,$5,'075-STOCK-B','stock',$6)
       ON CONFLICT (id) DO NOTHING`,
      [TIRE_STOCK_A, EMP_A, UNIT_A, TIRE_STOCK_B, EMP_B, UNIT_B],
    );
  });

  after(async () => {
    await pool.end();
  });

  test('075 cria objetos, constraints, indices e grants sem abrir RPC para anon/authenticated', async () => {
    const { rows: columns } = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name IN ('asset_documents','tires','driver_vehicle_assignments')
       ORDER BY table_name, column_name`,
    );
    const names = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
    for (const column of [
      'asset_documents.nome_arquivo',
      'asset_documents.nome_documento',
      'asset_documents.descricao',
      'asset_documents.mime',
      'asset_documents.tamanho_bytes',
      'asset_documents.file_sha256',
      'asset_documents.document_contract_version',
      'asset_documents.source',
      'asset_documents.request_id',
      'asset_documents.correlation_id',
      'tires.unidade_operacional_id',
      'driver_vehicle_assignments.source',
      'driver_vehicle_assignments.request_id',
      'driver_vehicle_assignments.correlation_id',
    ]) {
      assert.equal(names.has(column), true, column);
    }

    const { rows: constraints } = await pool.query(
      `SELECT conname, contype
       FROM pg_constraint
       WHERE conname = ANY($1::text[])
       ORDER BY conname`,
      [[
        'asset_documents_contract_version_chk',
        'asset_documents_file_size_chk',
        'asset_documents_source_chk',
        'tires_unit_empresa_fk',
        'driver_assignments_source_chk',
      ]],
    );
    assert.deepEqual(constraints.map((row) => row.conname), [
      'asset_documents_contract_version_chk',
      'asset_documents_file_size_chk',
      'asset_documents_source_chk',
      'driver_assignments_source_chk',
      'tires_unit_empresa_fk',
    ]);

    const { rows: indexes } = await pool.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('asset_documents_contract_status_idx','tires_empresa_unit_status_idx','driver_vehicle_assignments_handoff_request_key')
       ORDER BY indexname`,
    );
    assert.deepEqual(indexes.map((row) => row.indexname), [
      'asset_documents_contract_status_idx',
      'driver_vehicle_assignments_handoff_request_key',
      'tires_empresa_unit_status_idx',
    ]);

    const fn = 'public.fleet_driver_handoff(uuid,uuid,uuid,uuid,timestamp with time zone,text,uuid,text,text)';
    const { rows: privileges } = await pool.query(
      `SELECT
         has_function_privilege('anon', $1, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
         has_function_privilege('service_role', $1, 'EXECUTE') AS service_role`,
      [fn],
    );
    assert.equal(privileges[0].anon, false);
    assert.equal(privileges[0].authenticated, false);
    assert.equal(privileges[0].service_role, true);

    const { rows: functionRows } = await pool.query(
      `SELECT prosecdef, proconfig
       FROM pg_proc
       WHERE oid = $1::regprocedure`,
      [fn],
    );
    assert.equal(functionRows[0].prosecdef, true);
    assert.ok((functionRows[0].proconfig || []).includes('search_path=public'));
  });

  test('075 mantem backend antigo compativel com inserts 074 e popula defaults novos', async () => {
    const { rows } = await pool.query(
      `INSERT INTO public.asset_documents (empresa_id, asset_id, document_type, storage_path)
       VALUES ($1,$2,'CRLV','075/fleet/reference.pdf')
       RETURNING document_contract_version, status, nome_arquivo`,
      [EMP_A, ASSET_A],
    );
    assert.equal(rows[0].document_contract_version, 1);
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].nome_arquivo, null);

    await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [EMP_A, MOT_A, ASSET_A],
    );
    await pool.query(
      `INSERT INTO public.tires (empresa_id, fire_number, status)
       VALUES ($1,'075-OLD-STOCK','stock')`,
      [EMP_A],
    );
  });

  test('075 handoff e transacional: fecha anterior, cria novo e preserva historico', async () => {
    await withRole('service_role', async (db) => {
      const { rows: created } = await db.query(
        `SELECT * FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'initial',$4,'req-075-history-1','corr-075')`,
        [EMP_A, MOT_A2, ASSET_A, ADM_A],
      );
      const firstId = created[0].id;
      const { rows: next } = await db.query(
        `SELECT * FROM public.fleet_driver_handoff($1,$2,$3,NULL,now() + interval '1 second','handoff',$4,'req-075-history-2','corr-075')`,
        [EMP_A, MOT_A2, ASSET_A2, ADM_A],
      );
      assert.notEqual(next[0].id, firstId);
      const { rows } = await db.query(
        `SELECT id, asset_id, assignment_status, valid_until, ended_reason
         FROM public.driver_vehicle_assignments
         WHERE driver_id=$1 AND id IN ($2,$3)
         ORDER BY valid_from`,
        [MOT_A2, firstId, next[0].id],
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].assignment_status, 'ended');
      assert.ok(rows[0].valid_until);
      assert.equal(rows[0].ended_reason, 'handoff');
      assert.equal(rows[1].assignment_status, 'active');
      assert.equal(rows[1].asset_id, ASSET_A2);
      assert.equal(rows[1].valid_until, null);
    });
  });

  test('075 handoff idempotente por empresa, actor e request_id', async () => {
    await withRole('service_role', async (db) => {
      const args = [EMP_A, MOT_A, ASSET_A3, ADM_A];
      const first = await db.query(
        `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'retry',$4,'req-075-idem','corr-075')`,
        args,
      );
      const retry = await db.query(
        `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now() + interval '10 seconds','retry-different-payload',$4,'req-075-idem','corr-075')`,
        args,
      );
      assert.equal(retry.rows[0].id, first.rows[0].id);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n
         FROM public.driver_vehicle_assignments
         WHERE empresa_id=$1 AND created_by=$2 AND request_id='req-075-idem'`,
        [EMP_A, ADM_A],
      );
      assert.equal(rows[0].n, 1);
    });
  });

  test('075 handoff nega cross-tenant antes de criar estado', async () => {
    await withRole('service_role', async (db) => {
      await assert.rejects(
        db.query(
          `SELECT public.fleet_driver_handoff($1,$2,$3,NULL,now(),'bad-cross-tenant',$4,'req-075-cross-1','corr-075')`,
          [EMP_A, MOT_A, ASSET_B, ADM_A],
        ),
        /ativo fora do tenant|23503/i,
      );
      await assert.rejects(
        db.query(
          `SELECT public.fleet_driver_handoff($1,$2,$3,NULL,now(),'bad-cross-driver',$4,'req-075-cross-2','corr-075')`,
          [EMP_A, MOT_B, ASSET_A, ADM_A],
        ),
        /motorista fora do tenant|23503/i,
      );
    });
  });

  test('075 handoff rollback: falha no insert desfaz fechamento anterior', async () => {
    const driver = '07500000-0000-4000-a000-000000000204';
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'motorista','ativo',false,'Motorista rollback')
       ON CONFLICT (id) DO NOTHING`,
      [driver, EMP_A],
    );
    const { rows: active } = await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [EMP_A, driver, ASSET_A],
    );
    await withRole('service_role', async (db) => {
      await assert.rejects(
        db.query(
          `SELECT public.fleet_driver_handoff($1,$2,$3,NULL,now(),'will-rollback',$4,'req-075-rollback','corr-075')`,
          [EMP_A, driver, ASSET_A2, '07500000-0000-4000-a000-999999999999'],
        ),
        /violates foreign key|23503/i,
      );
    });
    const { rows } = await pool.query(
      `SELECT assignment_status, valid_until
       FROM public.driver_vehicle_assignments
       WHERE id=$1`,
      [active[0].id],
    );
    assert.equal(rows[0].assignment_status, 'active');
    assert.equal(rows[0].valid_until, null);
  });

  test('075 handoff concorrente serializa mesmo driver e mesmo alvo', async () => {
    const driver = '07500000-0000-4000-a000-000000000205';
    const driver2 = '07500000-0000-4000-a000-000000000206';
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$3,'motorista','ativo',false,'Motorista conc 1'),
              ($2,$3,'motorista','ativo',false,'Motorista conc 2')
       ON CONFLICT (id) DO NOTHING`,
      [driver, driver2, EMP_A],
    );
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('SET ROLE service_role');
      await c2.query('SET ROLE service_role');
      const [r1, r2] = await Promise.all([
        c1.query(
          `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'concurrent-driver',$4,'req-075-conc-driver-1','corr-075')`,
          [EMP_A, driver, ASSET_A, ADM_A],
        ),
        c2.query(
          `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'concurrent-driver',$4,'req-075-conc-driver-2','corr-075')`,
          [EMP_A, driver, ASSET_A2, ADM_A],
        ),
      ]);
      assert.equal(r1.rows.length + r2.rows.length, 2);
      const { rows: activeDriver } = await pool.query(
        `SELECT count(*)::int AS n
         FROM public.driver_vehicle_assignments
         WHERE driver_id=$1 AND assignment_status='active' AND valid_until IS NULL`,
        [driver],
      );
      assert.equal(activeDriver[0].n, 1);

      const [a1, a2] = await Promise.allSettled([
        c1.query(
          `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'concurrent-asset',$4,'req-075-conc-asset-1','corr-075')`,
          [EMP_A, driver, ASSET_A3, ADM_A],
        ),
        c2.query(
          `SELECT id FROM public.fleet_driver_handoff($1,$2,$3,NULL,now(),'concurrent-asset',$4,'req-075-conc-asset-2','corr-075')`,
          [EMP_A, driver2, ASSET_A3, ADM_A],
        ),
      ]);
      assert.equal(a1.status === 'fulfilled' || a2.status === 'fulfilled', true);
      const { rows: activeAsset } = await pool.query(
        `SELECT count(*)::int AS n
         FROM public.driver_vehicle_assignments
         WHERE asset_id=$1 AND assignment_status='active' AND valid_until IS NULL`,
        [ASSET_A3],
      );
      assert.equal(activeAsset[0].n, 1);
    } finally {
      await Promise.allSettled([c1.query('RESET ROLE'), c2.query('RESET ROLE')]);
      c1.release();
      c2.release();
    }
  });

  test('075 asset_documents constraints, idempotency key e RLS tenant', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO public.asset_documents
          (empresa_id, asset_id, document_type, storage_path, tamanho_bytes)
         VALUES ($1,$2,'CRLV','075/fleet/bad.pdf',0)`,
        [EMP_A, ASSET_A],
      ),
      /asset_documents_file_size_chk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.asset_documents
          (empresa_id, asset_id, document_type, storage_path, document_contract_version)
         VALUES ($1,$2,'CRLV','075/fleet/bad.pdf',3)`,
        [EMP_A, ASSET_A],
      ),
      /asset_documents_contract_version_chk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.asset_documents (empresa_id, asset_id, document_type, storage_path)
         VALUES ($1,$2,'CRLV','075/fleet/cross.pdf')`,
        [EMP_A, ASSET_B],
      ),
      /asset_docs_asset_empresa_fk/,
    );

    await pool.query(
      `INSERT INTO public.asset_documents
        (empresa_id, asset_id, document_type, storage_path, nome_arquivo, mime, tamanho_bytes, client_request_id, created_by)
       VALUES ($1,$2,'CRLV','075/fleet/doc.pdf','doc.pdf','application/pdf',10,'req-075-doc',$3)`,
      [EMP_A, ASSET_A, ADM_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.asset_documents
          (empresa_id, asset_id, document_type, storage_path, client_request_id, created_by)
         VALUES ($1,$2,'CRLV','075/fleet/doc-dup.pdf','req-075-doc',$3)`,
        [EMP_A, ASSET_A, ADM_A],
      ),
      /asset_documents_client_request_key/,
    );

    await withAuth(ADM_A, async (db) => {
      const { rows } = await db.query(`SELECT empresa_id FROM public.asset_documents WHERE asset_id=$1`, [ASSET_A]);
      assert.ok(rows.length >= 1);
      assert.equal(rows.every((row) => row.empresa_id === EMP_A), true);
    });
    await withAuth(ADM_B, async (db) => {
      const { rows } = await db.query(`SELECT id FROM public.asset_documents WHERE asset_id=$1`, [ASSET_A]);
      assert.equal(rows.length, 0);
    });
  });

  test('075 tire stock scope tem autoridade por unidade, backfill instalado e isolamento tenant', async () => {
    const { rows: backfill } = await pool.query(
      `SELECT unidade_operacional_id FROM public.tires WHERE id=$1`,
      [TIRE_INSTALLED],
    );
    assert.equal(backfill[0].unidade_operacional_id, UNIT_A);

    await assert.rejects(
      pool.query(
        `INSERT INTO public.tires (empresa_id, fire_number, status, unidade_operacional_id)
         VALUES ($1,'075-BAD-UNIT','stock',$2)`,
        [EMP_A, UNIT_B],
      ),
      /tires_unit_empresa_fk/,
    );

    await withAuth(ADM_A, async (db) => {
      const { rows } = await db.query(
        `SELECT id, empresa_id, unidade_operacional_id
         FROM public.tires
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
        [[TIRE_STOCK_A, TIRE_STOCK_B]],
      );
      assert.deepEqual(rows.map((row) => row.id), [TIRE_STOCK_A]);
      assert.equal(rows[0].unidade_operacional_id, UNIT_A);
    });
  });
}

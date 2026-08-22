// PG real (CI): certifica a migration 074 Fleet Foundation sobre o baseline 072
// e a foundation documental 073. Nunca roda contra producao: exige DATABASE_URL
// do Postgres efemero da CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('fleet foundation 074 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const sqls = [
    migration('026_create_frete_documentos.sql'),
    migration('048_create_frete_epod.sql'),
    migration('049_create_frete_ocorrencias.sql'),
    migration('050_epod_evidencia_status.sql'),
    migration('073_documents_foundation_security_web.sql'),
    migration('074_fleet_foundation.sql'),
  ];

  const EMP_A = '07400000-0000-4000-a000-000000000001';
  const EMP_B = '07400000-0000-4000-a000-000000000002';
  const PLAN_A = '07400000-0000-4000-a000-0000000000a1';
  const PLAN_B = '07400000-0000-4000-a000-0000000000b1';
  const ADM_A = '07400000-0000-4000-a000-000000000101';
  const ADM_B = '07400000-0000-4000-a000-000000000102';
  const MOT_A = '07400000-0000-4000-a000-000000000201';
  const MOT_B = '07400000-0000-4000-a000-000000000202';
  const UNIT_A = '07400000-0000-4000-a000-000000000301';
  const UNIT_B = '07400000-0000-4000-a000-000000000302';
  const ASSET_A = '07400000-0000-4000-a000-000000000401';
  const ASSET_B = '07400000-0000-4000-a000-000000000402';
  const ASSET_C = '07400000-0000-4000-a000-000000000403';
  const ASSET_D = '07400000-0000-4000-a000-000000000404';
  const COMP_A = '07400000-0000-4000-a000-000000000501';
  const COMP_B = '07400000-0000-4000-a000-000000000502';
  const COMP_C = '07400000-0000-4000-a000-000000000503';
  const COMP_D = '07400000-0000-4000-a000-000000000504';
  const FRETE_A = '07400000-0000-4000-a000-000000000601';
  const FRETE_B = '07400000-0000-4000-a000-000000000602';
  const TIRE_A = '07400000-0000-4000-a000-000000000701';

  const fleetTables = [
    'fleet_assets',
    'vehicle_compositions',
    'vehicle_composition_members',
    'driver_vehicle_assignments',
    'freight_vehicle_assignments',
    'asset_documents',
    'odometer_events',
    'tires',
    'tire_installations',
    'tire_events',
    'maintenance_events',
  ];
  const pool = new Pool({ connectionString: CONN });

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
       VALUES ($1,'Fleet Plano A','empresa',20,20,false),($2,'Fleet Plano B','ambos',40,40,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Fleet Empresa A','ativo',$2,'enforced'),($3,'Fleet Empresa B','ativo',$4,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A, EMP_B, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'admin','ativo',false,'Admin A'),
              ($3,$4,'admin','ativo',false,'Admin B'),
              ($5,$2,'motorista','ativo',false,'Motorista A'),
              ($6,$4,'motorista','ativo',false,'Motorista B')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, ADM_B, EMP_B, MOT_A, MOT_B],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade A','ativo',true),($3,$4,'Unidade B','ativo',true)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A, UNIT_B, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data, modalidade_calculo, valor_frete, km_inicial, km_final)
       VALUES ($1,$2,$3,'ativo',now(),'valor_fixo',100,10,20),
              ($4,$5,$6,'ativo',now(),'valor_fixo',200,30,40)
       ON CONFLICT (id) DO NOTHING`,
      [FRETE_A, EMP_A, MOT_A, FRETE_B, EMP_B, MOT_B],
    );

    for (const sql of sqls) await pool.query(sql);
    await pool.query(sqls.at(-1)); // idempotencia: 074 reexecuta sem erro.
  });

  after(async () => {
    await pool.end();
  });

  test('074 cria todas as tabelas, RLS, policies e grants esperados', async () => {
    const { rows: tables } = await pool.query(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname = ANY($1::text[])
       ORDER BY relname`,
      [fleetTables],
    );
    assert.deepEqual(tables.map((r) => r.relname), [...fleetTables].sort());
    assert.equal(tables.every((r) => r.relrowsecurity === true), true);

    const { rows: policies } = await pool.query(
      `SELECT tablename, policyname, cmd, roles
       FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [fleetTables],
    );
    assert.equal(policies.length, fleetTables.length);
    for (const row of policies) {
      assert.equal(row.policyname, `${row.tablename}_tenant_access`);
      assert.equal(row.cmd, 'ALL');
      assert.deepEqual(row.roles, ['authenticated']);
    }

    const { rows: grants } = await pool.query(
      `SELECT table_name, grantee, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name = ANY($1::text[])
         AND grantee IN ('anon','authenticated','service_role')
       ORDER BY table_name, grantee, privilege_type`,
      [fleetTables],
    );
    assert.equal(grants.some((g) => g.grantee === 'anon'), false);
    for (const table of fleetTables) {
      const authPrivs = grants.filter((g) => g.table_name === table && g.grantee === 'authenticated').map((g) => g.privilege_type).sort();
      assert.deepEqual(authPrivs, ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
      const servicePrivs = grants.filter((g) => g.table_name === table && g.grantee === 'service_role').map((g) => g.privilege_type).sort();
      assert.deepEqual(servicePrivs, ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']);
    }
  });

  test('074 registra entitlement fleet e plano default como incluida', async () => {
    const { rows } = await pool.query(
      `SELECT f.codigo, f.status_ciclo_vida, pf.plano_id, pf.disponibilidade
       FROM public.funcionalidades f
       JOIN public.plano_funcionalidades pf ON pf.funcionalidade_id = f.id
       WHERE f.codigo = 'fleet' AND pf.plano_id = ANY($1::uuid[])
       ORDER BY pf.plano_id`,
      [[PLAN_A, PLAN_B]],
    );
    assert.deepEqual(rows.map((r) => [r.codigo, r.status_ciclo_vida, r.disponibilidade]), [
      ['fleet', 'disponivel', 'incluida'],
      ['fleet', 'disponivel', 'incluida'],
    ]);
  });

  test('074 asset types usam CHECK canonico, sem boolean por tipo', async () => {
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='fleet_assets'
       ORDER BY ordinal_position`,
    );
    assert.equal(columns.some((c) => ['truck', 'tractor', 'semitrailer', 'trailer', 'dolly', 'implement'].includes(c.column_name)), false);
    const { rows: checks } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.fleet_assets'::regclass AND contype = 'c'`,
    );
    assert.ok(checks.some((c) => /'truck'.*'tractor'.*'semitrailer'.*'trailer'.*'dolly'.*'implement'.*'other'/.test(c.def)));
  });

  test('074 DB bloqueia tenant/scope cross-reference por FK composta', async () => {
    await pool.query(
      `INSERT INTO public.fleet_assets (id, empresa_id, unidade_operacional_id, asset_type, internal_identifier, plate)
       VALUES ($1,$2,$3,'tractor','A-TRACTOR','AAA1A11'),
              ($4,$5,$6,'trailer','B-TRAILER','BBB1B11'),
              ($7,$2,$3,'truck','A-TRUCK-C','AAC1C11'),
              ($8,$2,$3,'truck','A-TRUCK-D','AAD1D11')
       ON CONFLICT (id) DO NOTHING`,
      [ASSET_A, EMP_A, UNIT_A, ASSET_B, EMP_B, UNIT_B, ASSET_C, ASSET_D],
    );
    await pool.query(
      `INSERT INTO public.vehicle_compositions (id, empresa_id, unidade_operacional_id, code)
       VALUES ($1,$2,$3,'COMP-A'),($4,$5,$6,'COMP-B'),($7,$2,$3,'COMP-C'),($8,$2,$3,'COMP-D')
       ON CONFLICT (id) DO NOTHING`,
      [COMP_A, EMP_A, UNIT_A, COMP_B, EMP_B, UNIT_B, COMP_C, COMP_D],
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO public.fleet_assets (empresa_id, unidade_operacional_id, asset_type, internal_identifier)
         VALUES ($1,$2,'truck','bad-unit')`,
        [EMP_A, UNIT_B],
      ),
      /fleet_assets_unit_empresa_fk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
         VALUES ($1,$2,$3,'trailer')`,
        [EMP_A, COMP_A, ASSET_B],
      ),
      /veh_comp_members_asset_empresa_fk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id)
         VALUES ($1,$2,$3)`,
        [EMP_A, MOT_B, ASSET_A],
      ),
      /driver_assign_driver_empresa_fk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.freight_vehicle_assignments (empresa_id, frete_id, asset_id, primary_driver_id)
         VALUES ($1,$2,$3,$4)`,
        [EMP_A, FRETE_A, ASSET_B, MOT_A],
      ),
      /freight_assign_asset_empresa_fk/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.asset_documents (empresa_id, asset_id, document_type, storage_path)
         VALUES ($1,$2,'CRLV','fleet/bad.pdf')`,
        [EMP_A, ASSET_B],
      ),
      /asset_docs_asset_empresa_fk/,
    );
  });

  test('074 RLS: admin autenticado le/escreve so o proprio tenant', async () => {
    await withAuth(ADM_A, async (db) => {
      const { rows } = await db.query(`SELECT id FROM public.fleet_assets ORDER BY id`);
      assert.ok(rows.some((r) => r.id === ASSET_A));
      assert.equal(rows.some((r) => r.id === ASSET_B), false);

      await db.query(
        `INSERT INTO public.fleet_assets (empresa_id, unidade_operacional_id, asset_type, internal_identifier)
         VALUES ($1,$2,'truck','A-RLS-OK')`,
        [EMP_A, UNIT_A],
      );
      await assert.rejects(
        db.query(
          `INSERT INTO public.fleet_assets (empresa_id, unidade_operacional_id, asset_type, internal_identifier)
           VALUES ($1,$2,'truck','B-RLS-DENY')`,
          [EMP_B, UNIT_B],
        ),
        /row-level security|violates row-level/i,
      );
    });
  });

  test('074 composition active member uniqueness e concorrencia deixam no maximo uma composicao ativa por asset', async () => {
    const direct = await pool.query(
      `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
       VALUES ($1,$2,$3,'primary_power')
       RETURNING id`,
      [EMP_A, COMP_A, ASSET_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
         VALUES ($1,$2,$3,'primary_power')`,
        [EMP_A, COMP_A, ASSET_A],
      ),
      /vehicle_composition_members_active_asset_key|vehicle_composition_members_active_pair_key/,
    );
    await pool.query(
      `UPDATE public.vehicle_composition_members
       SET valid_until = now() + interval '1 second'
       WHERE id = $1`,
      [direct.rows[0].id],
    );
    await pool.query(
      `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
       VALUES ($1,$2,$3,'primary_power')`,
      [EMP_A, COMP_B, ASSET_A],
    );

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const results = await Promise.allSettled([
        c1.query(
          `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
           VALUES ($1,$2,$3,'primary_power')`,
          [EMP_A, COMP_C, ASSET_C],
        ),
        c2.query(
          `INSERT INTO public.vehicle_composition_members (empresa_id, composition_id, asset_id, member_role)
           VALUES ($1,$2,$3,'primary_power')`,
          [EMP_A, COMP_D, ASSET_C],
        ),
      ]);
      await Promise.allSettled([c1.query('COMMIT'), c2.query('COMMIT')]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM public.vehicle_composition_members
         WHERE asset_id=$1 AND valid_until IS NULL`,
        [ASSET_C],
      );
      assert.equal(rows[0].n, 1);
    } finally {
      await Promise.allSettled([c1.query('ROLLBACK'), c2.query('ROLLBACK')]);
      c1.release();
      c2.release();
    }
  });

  test('074 driver assignments: active conflict rejected, ended history preserved', async () => {
    const first = await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, asset_id, valid_from)
       VALUES ($1,$2,$3,now())
       RETURNING id`,
      [EMP_A, MOT_A, ASSET_D],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, composition_id, valid_from)
         VALUES ($1,$2,$3,now())`,
        [EMP_A, MOT_A, COMP_A],
      ),
      /driver_vehicle_assignments_active_driver_key/,
    );
    await pool.query(
      `UPDATE public.driver_vehicle_assignments
       SET assignment_status='ended', valid_until = now() + interval '1 second'
       WHERE id=$1`,
      [first.rows[0].id],
    );
    await pool.query(
      `INSERT INTO public.driver_vehicle_assignments (empresa_id, driver_id, composition_id, valid_from)
       VALUES ($1,$2,$3,now() + interval '2 seconds')`,
      [EMP_A, MOT_A, COMP_A],
    );
    const { rows } = await pool.query(
      `SELECT assignment_status FROM public.driver_vehicle_assignments WHERE driver_id=$1 ORDER BY created_at`,
      [MOT_A],
    );
    assert.deepEqual(rows.map((r) => r.assignment_status), ['ended', 'active']);
  });

  test('074 freight assignments: tenant seguro, active unico por frete e historico preservado', async () => {
    const first = await pool.query(
      `INSERT INTO public.freight_vehicle_assignments (empresa_id, frete_id, asset_id, primary_driver_id)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [EMP_A, FRETE_A, ASSET_A, MOT_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.freight_vehicle_assignments (empresa_id, frete_id, composition_id, primary_driver_id)
         VALUES ($1,$2,$3,$4)`,
        [EMP_A, FRETE_A, COMP_A, MOT_A],
      ),
      /freight_vehicle_assignments_active_frete_key/,
    );
    await pool.query(
      `UPDATE public.freight_vehicle_assignments
       SET assignment_status='replaced', assigned_until = now() + interval '1 second'
       WHERE id=$1`,
      [first.rows[0].id],
    );
    await pool.query(
      `INSERT INTO public.freight_vehicle_assignments (empresa_id, frete_id, composition_id, primary_driver_id, assigned_from)
       VALUES ($1,$2,$3,$4,now() + interval '2 seconds')`,
      [EMP_A, FRETE_A, COMP_A, MOT_A],
    );
    const { rows } = await pool.query(
      `SELECT assignment_status FROM public.freight_vehicle_assignments WHERE frete_id=$1 ORDER BY created_at`,
      [FRETE_A],
    );
    assert.deepEqual(rows.map((r) => r.assignment_status), ['replaced', 'active']);
  });

  test('074 odometro, pneus e manutencao cobrem a foundation declarada', async () => {
    await pool.query(
      `INSERT INTO public.odometer_events (empresa_id, asset_id, frete_id, event_type, reading_km, photo_path, source, recorded_by)
       VALUES ($1,$2,$3,'check_in',100.5,'odometer/a/in.jpg','app',$4),
              ($1,$2,$3,'check_out',180.0,'odometer/a/out.jpg','app',$4)`,
      [EMP_A, ASSET_A, FRETE_A, MOT_A],
    );
    const { rows: odo } = await pool.query(
      `SELECT event_type FROM public.odometer_events WHERE asset_id=$1 ORDER BY occurred_at, event_type`,
      [ASSET_A],
    );
    assert.deepEqual(odo.map((r) => r.event_type), ['check_in', 'check_out']);

    await pool.query(
      `INSERT INTO public.tires (id, empresa_id, fire_number, brand, model, size, purchase_date, purchase_value, status, current_asset_id)
       VALUES ($1,$2,'FIRE-074-A','Marca','Modelo','295/80R22.5',CURRENT_DATE,1200,'installed',$3)
       ON CONFLICT (id) DO NOTHING`,
      [TIRE_A, EMP_A, ASSET_A],
    );
    await pool.query(
      `INSERT INTO public.tire_installations (empresa_id, tire_id, asset_id, position_label, installed_km)
       VALUES ($1,$2,$3,'D1',100.5)`,
      [EMP_A, TIRE_A, ASSET_A],
    );
    await pool.query(
      `INSERT INTO public.tire_events (empresa_id, tire_id, asset_id, event_type, odometer_km, cost, reason)
       VALUES ($1,$2,$3,'retread',150,300,'recapagem')`,
      [EMP_A, TIRE_A, ASSET_A],
    );
    await pool.query(
      `INSERT INTO public.maintenance_events
        (empresa_id, asset_id, maintenance_type, category, status, work_order, supplier, parts, cost, odometer_km, scheduled_at, completed_at, downtime_minutes)
       VALUES ($1,$2,'preventive','oil','completed','OS-074','Oficina','[{"item":"oleo"}]'::jsonb,450,180,now(),now(),120)`,
      [EMP_A, ASSET_A],
    );
  });
}


// PG real (CI): certifica a migration 076 Operation Campaign Foundation.
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
  test('operation campaign 076 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
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
    migration('072_permissions_templates_overrides.sql'),
    migration('073_documents_foundation_security_web.sql'),
    migration('074_fleet_foundation.sql'),
    migration('075_fleet_operational_closure.sql'),
    migration('076_operation_campaign_foundation.sql'),
  ];

  const EMP_A = '07600000-0000-4000-a000-000000000001';
  const EMP_B = '07600000-0000-4000-a000-000000000002';
  const PLAN_A = '07600000-0000-4000-a000-0000000000a1';
  const PLAN_B = '07600000-0000-4000-a000-0000000000b1';
  const ADM_A = '07600000-0000-4000-a000-000000000101';
  const ADM_B = '07600000-0000-4000-a000-000000000102';
  const UNIT_A = '07600000-0000-4000-a000-000000000301';
  const UNIT_B = '07600000-0000-4000-a000-000000000302';
  const CAMP_A = '07600000-0000-4000-a000-000000000401';
  const CAMP_B = '07600000-0000-4000-a000-000000000402';
  const PLAN_VER_A = '07600000-0000-4000-a000-000000000501';
  const PLAN_VER_A2 = '07600000-0000-4000-a000-000000000502';

  const campaignTables = [
    'operation_campaigns',
    'campaign_operational_units',
    'campaign_locations',
    'campaign_demands',
    'campaign_plan_versions',
    'campaign_plan_scenarios',
    'campaign_planned_trips',
    'campaign_approvals',
    'campaign_exceptions',
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
       VALUES ($1,'Campaign Plano A','empresa',20,20,false),($2,'Campaign Plano B','ambos',40,40,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Campaign Empresa A','ativo',$2,'enforced'),($3,'Campaign Empresa B','ativo',$4,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A, EMP_B, PLAN_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'admin','ativo',false,'Admin A'),($3,$4,'admin','ativo',false,'Admin B')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, ADM_B, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade A','ativo',true),($3,$4,'Unidade B','ativo',true)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A, UNIT_B, EMP_B],
    );

    for (const sql of sqls) await pool.query(sql);
    await pool.query(sqls.at(-1)); // idempotencia: 076 reexecuta sem erro.
  });

  after(async () => {
    await pool.end();
  });

  test('076 cria tabelas Campaign, RLS e grants esperados', async () => {
    const { rows: tables } = await pool.query(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname = ANY($1::text[])
       ORDER BY relname`,
      [campaignTables],
    );
    assert.equal(tables.length, campaignTables.length);
    assert.equal(tables.every((row) => row.relrowsecurity === true), true);

    const { rows: grants } = await pool.query(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND grantee = 'authenticated'
         AND table_name = ANY($1::text[])`,
      [campaignTables],
    );
    const grantKeys = new Set(grants.map((row) => `${row.table_name}:${row.privilege_type}`));
    for (const table of campaignTables) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.ok(grantKeys.has(`${table}:${privilege}`), `${table} missing ${privilege}`);
      }
    }
  });

  test('operation_campaign e tecnico sem mapping comercial de plano', async () => {
    const { rows } = await pool.query(`SELECT id, codigo, visivel_publicamente FROM public.funcionalidades WHERE codigo = 'operation_campaign'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].visivel_publicamente, false);
    const { rows: mappings } = await pool.query(
      `SELECT 1
       FROM public.plano_funcionalidades pf
       JOIN public.funcionalidades f ON f.id = pf.funcionalidade_id
       WHERE f.codigo = 'operation_campaign'`,
    );
    assert.equal(mappings.length, 0);
  });

  test('tenant consistency bloqueia unidade de outra empresa', async () => {
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES ($1,$2,'CAMP-A','Campanha A','Soja',$3)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A],
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
         VALUES ($1,$2,$3,$4)`,
        [EMP_A, CAMP_A, UNIT_B, ADM_A],
      ),
      /foreign key|violates/i,
    );
  });

  test('RLS isola campanhas por tenant autenticado', async () => {
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES ($1,$2,'CAMP-B','Campanha B','Milho',$3)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_B, EMP_B, ADM_B],
    );
    await withAuth(ADM_A, async (client) => {
      const { rows } = await client.query(`SELECT id FROM public.operation_campaigns ORDER BY id`);
      assert.equal(rows.some((row) => row.id === CAMP_A), true);
      assert.equal(rows.some((row) => row.id === CAMP_B), false);
    });
  });

  test('um unico plano aprovado por campanha e nenhuma escrita em fretes', async () => {
    const beforeFretes = await pool.query(`SELECT count(*)::int AS n FROM public.fretes`);
    await pool.query(
      `INSERT INTO public.campaign_plan_versions (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by)
       VALUES ($1,$2,$3,1,'APPROVED','campaign-a.test',$4)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_VER_A, EMP_A, CAMP_A, ADM_A],
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.campaign_plan_versions (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by)
         VALUES ($1,$2,$3,2,'APPROVED','campaign-a.test',$4)`,
        [PLAN_VER_A2, EMP_A, CAMP_A, ADM_A],
      ),
      /unique|duplicate/i,
    );
    const afterFretes = await pool.query(`SELECT count(*)::int AS n FROM public.fretes`);
    assert.equal(afterFretes.rows[0].n, beforeFretes.rows[0].n);
  });
}

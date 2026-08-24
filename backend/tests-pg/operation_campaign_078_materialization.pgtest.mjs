// Nunca roda contra producao: exige DATABASE_URL do Postgres efemero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('operation campaign 078 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 078 nao pode ser pulado');
    });
  } else {
    test('operation campaign 078 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
  }
} else {
  const pg = await import('pg');
  registrar(pg.default ?? pg);
}

function registrar(pg) {
  const { Pool } = pg;
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const pgHarness = (name) => readFileSync(join(here, name), 'utf8');
  const pool = new Pool({ connectionString: CONN });

  const bootstrapSql = [
    pgHarness('00_bootstrap_pre.sql'),
    migration('060_catalogo_funcionalidades.sql'),
    migration('061_matriz_publicacao_transacional.sql'),
    pgHarness('99_grants_service_role_test.sql'),
    migration('058_fluxo_comercial_v2.sql'),
    migration('062_auth_sessions_revogaveis.sql'),
    migration('064_frete_tracking_credenciais.sql'),
    migration('065_fretes_financeiro_auditoria.sql'),
    migration('066_billing_outbox.sql'),
    migration('067_grupos_filiais_escopos_operacionais.sql'),
  ];

  const campaignMaterializationSql = [
    migration('068_aquisicao_comercial_v2_rpc.sql'),
    migration('069_portal_cliente_governanca_entitlements.sql'),
    migration('070_lancamentos_audit_safe_realtime.sql'),
    migration('071_lancamento_status_cancelado_check.sql'),
    migration('072_permissions_templates_overrides.sql'),
    migration('026_create_frete_documentos.sql'),
    migration('048_create_frete_epod.sql'),
    migration('049_create_frete_ocorrencias.sql'),
    migration('050_epod_evidencia_status.sql'),
    migration('073_documents_foundation_security_web.sql'),
    migration('074_fleet_foundation.sql'),
    migration('075_fleet_operational_closure.sql'),
    migration('076_operation_campaign_foundation.sql'),
    migration('077_operation_campaign_076_payload_reconciliation.sql'),
    migration('078_operation_campaign_materialization.sql'),
  ];

  const EMP_A = '07800000-0000-4000-a000-000000000001';
  const EMP_B = '07800000-0000-4000-a000-000000000002';
  const PLAN_A = '07800000-0000-4000-a000-0000000000a1';
  const ADM_A = '07800000-0000-4000-a000-000000000101';
  const DRIVER_A = '07800000-0000-4000-a000-000000000201';
  const UNIT_A = '07800000-0000-4000-a000-000000000301';
  const CAMP_A = '07800000-0000-4000-a000-000000000401';
  const PLAN_VER_A = '07800000-0000-4000-a000-000000000501';
  const SCEN_A = '07800000-0000-4000-a000-000000000601';
  const ORIGIN_A = '07800000-0000-4000-a000-000000000701';
  const DEST_A = '07800000-0000-4000-a000-000000000702';
  const DEMAND_A = '07800000-0000-4000-a000-000000000801';
  const TRIP_A = '07800000-0000-4000-a000-000000000901';
  const TRIP_B = '07800000-0000-4000-a000-000000000902';
  const FRETE_A = '07800000-0000-4000-a000-000000000a01';
  const FRETE_B = '07800000-0000-4000-a000-000000000a02';
  const FRETE_OTHER = '07800000-0000-4000-a000-000000000a03';

  async function applySql(sqls) {
    for (const sql of sqls) await pool.query(sql);
  }

  async function resetPublicSchema() {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres');
    await pool.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role').catch(() => {});
  }

  async function installAuthHelpers() {
    await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
    await pool.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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
  }

  async function seedFixtures() {
    await pool.query(
      `INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
       VALUES ($1,'Plano A','empresa',20,20,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Empresa A','ativo',$2,'enforced'),($3,'Empresa B','ativo',$2,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES
         ($1,$2,'admin','ativo',false,'Admin A'),
         ($3,$2,'motorista','ativo',false,'Driver A')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, DRIVER_A],
    );
    await pool.query(
      `INSERT INTO public.motoristas (id, empresa_id)
       VALUES ($1,$2)
       ON CONFLICT (id) DO NOTHING`,
      [DRIVER_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade A','ativo',true)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, status, planning_status, created_by)
       VALUES ($1,$2,'CAMP-078','Campanha 078','Soja','READY_FOR_REVIEW','READY_FOR_REVIEW',$3)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (campaign_id, unidade_operacional_id) DO NOTHING`,
      [EMP_A, CAMP_A, UNIT_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_locations (id, empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,'origin','Origem',$4,$5),($6,$2,$3,'destination','Destino',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ORIGIN_A, EMP_A, CAMP_A, UNIT_A, ADM_A, DEST_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_demands
         (id, empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,$5,'Soja',20,'ton',$6)
       ON CONFLICT (id) DO NOTHING`,
      [DEMAND_A, EMP_A, CAMP_A, ORIGIN_A, DEST_A, ADM_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by, approved_by, approved_at)
       VALUES ($1,$2,$3,1,'APPROVED','campaign-b.test',$4,$4,now())
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_VER_A, EMP_A, CAMP_A, ADM_A],
    );
    await pool.query(
      `UPDATE public.operation_campaigns
          SET status='APPROVED', planning_status='APPROVED', approved_plan_version_id=$1
        WHERE id=$2 AND empresa_id=$3`,
      [PLAN_VER_A, CAMP_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_scenarios (id, empresa_id, campaign_id, plan_version_id, scenario_key, label)
       VALUES ($1,$2,$3,$4,'base','Base')
       ON CONFLICT (id) DO NOTHING`,
      [SCEN_A, EMP_A, CAMP_A, PLAN_VER_A],
    );
    await pool.query(
      `INSERT INTO public.campaign_planned_trips
         (id, empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_driver_id)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,10,'ton',10000,$9),
         ($10,$2,$3,$4,$5,$6,$7,$8,10,'ton',10000,$9)
       ON CONFLICT (id) DO NOTHING`,
      [TRIP_A, EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, DRIVER_A, TRIP_B],
    );
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data)
       VALUES
         ($1,$3,$2,'ativo',now()),
         ($4,$3,$2,'ativo',now()),
         ($5,$6,$2,'ativo',now())
       ON CONFLICT (id) DO NOTHING`,
      [FRETE_A, DRIVER_A, EMP_A, FRETE_B, FRETE_OTHER, EMP_B],
    );
  }

  test('078 cria tabela de vinculo Campaign-Freight com RLS e grants', async () => {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await installAuthHelpers();
    await applySql(campaignMaterializationSql);
    await seedFixtures();

    const { rows: tableRows } = await pool.query(
      `SELECT relrowsecurity
       FROM pg_class
       WHERE relnamespace='public'::regnamespace
         AND relname='campaign_trip_freights'`,
    );
    assert.equal(tableRows.length, 1);
    assert.equal(tableRows[0].relrowsecurity, true);

    const { rows: grants } = await pool.query(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name='campaign_trip_freights'
         AND grantee='authenticated'`,
    );
    assert.deepEqual(new Set(grants.map((row) => row.privilege_type)), new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
  });

  test('078 garante um frete por planned trip e um planned trip por frete', async () => {
    await pool.query(
      `INSERT INTO public.campaign_trip_freights
         (empresa_id, campaign_id, plan_version_id, planned_trip_id, frete_id, created_by, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,'req-1')`,
      [EMP_A, CAMP_A, PLAN_VER_A, TRIP_A, FRETE_A, ADM_A],
    );

    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.campaign_trip_freights
           (empresa_id, campaign_id, plan_version_id, planned_trip_id, frete_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [EMP_A, CAMP_A, PLAN_VER_A, TRIP_A, FRETE_B, ADM_A],
      ),
      /campaign_trip_freights_trip_key/,
    );

    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.campaign_trip_freights
           (empresa_id, campaign_id, plan_version_id, planned_trip_id, frete_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [EMP_A, CAMP_A, PLAN_VER_A, TRIP_B, FRETE_A, ADM_A],
      ),
      /campaign_trip_freights_frete_key/,
    );
  });

  test('078 bloqueia frete de outro tenant no vinculo canônico', async () => {
    await assert.rejects(
      () => pool.query(
        `INSERT INTO public.campaign_trip_freights
           (empresa_id, campaign_id, plan_version_id, planned_trip_id, frete_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [EMP_A, CAMP_A, PLAN_VER_A, TRIP_B, FRETE_OTHER, ADM_A],
      ),
      /campaign_trip_freights_frete_empresa_fk/,
    );
  });

  after(async () => {
    await pool.end();
  });
}

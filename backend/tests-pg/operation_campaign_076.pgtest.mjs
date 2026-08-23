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
  if (process.env.CI) {
    test('operation campaign 076 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 076 nao pode ser pulado');
    });
  } else {
    test('operation campaign 076 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
  }
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const pgHarness = (name) => readFileSync(join(here, name), 'utf8');

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

  const upgrade075Sql = [
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
  ];
  const migration076 = migration('076_operation_campaign_foundation.sql');

  const EMP_A = '07600000-0000-4000-a000-000000000001';
  const EMP_B = '07600000-0000-4000-a000-000000000002';
  const PLAN_A = '07600000-0000-4000-a000-0000000000a1';
  const PLAN_B = '07600000-0000-4000-a000-0000000000b1';
  const ADM_A = '07600000-0000-4000-a000-000000000101';
  const ADM_B = '07600000-0000-4000-a000-000000000102';
  const DRIVER_A = '07600000-0000-4000-a000-000000000111';
  const DRIVER_B = '07600000-0000-4000-a000-000000000112';
  const UNIT_A = '07600000-0000-4000-a000-000000000301';
  const UNIT_A2 = '07600000-0000-4000-a000-000000000303';
  const UNIT_B = '07600000-0000-4000-a000-000000000302';
  const CAMP_A = '07600000-0000-4000-a000-000000000401';
  const CAMP_B = '07600000-0000-4000-a000-000000000402';
  const CAMP_OTHER = '07600000-0000-4000-a000-000000000403';
  const ORIGIN_A = '07600000-0000-4000-a000-000000000601';
  const DEST_A = '07600000-0000-4000-a000-000000000602';
  const ORIGIN_B = '07600000-0000-4000-a000-000000000603';
  const DEST_B = '07600000-0000-4000-a000-000000000604';
  const DEMAND_A = '07600000-0000-4000-a000-000000000701';
  const DEMAND_B = '07600000-0000-4000-a000-000000000702';
  const PLAN_VER_A = '07600000-0000-4000-a000-000000000501';
  const PLAN_VER_B = '07600000-0000-4000-a000-000000000502';
  const SCEN_A = '07600000-0000-4000-a000-000000000801';
  const SCEN_B = '07600000-0000-4000-a000-000000000802';
  const TRIP_A = '07600000-0000-4000-a000-000000000901';
  const TRIP_B = '07600000-0000-4000-a000-000000000902';
  const ASSET_A = '07600000-0000-4000-a000-000000000a01';
  const ASSET_B = '07600000-0000-4000-a000-000000000a02';
  const COMP_A = '07600000-0000-4000-a000-000000000b01';
  const COMP_B = '07600000-0000-4000-a000-000000000b02';

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

  async function expectFkReject(sql, params = []) {
    await assert.rejects(() => pool.query(sql, params), (error) => error?.code === '23503');
  }

  async function applySql(sqls) {
    for (const sql of sqls) await pool.query(sql);
  }

  before(async () => {
    await applySql(bootstrapSql);
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

    await seedCoreFixtures();
    await applySql(upgrade075Sql);
    await pool.query(migration076);
    await seedCampaignFixtures();
    await pool.query(migration076); // idempotencia: 076 reexecuta com dados validos.
  });

  after(async () => {
    await pool.end();
  });

  async function seedCoreFixtures() {
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
       VALUES
         ($1,$2,'admin','ativo',false,'Admin A'),
         ($3,$4,'admin','ativo',false,'Admin B'),
         ($5,$2,'motorista','ativo',false,'Driver A'),
         ($6,$4,'motorista','ativo',false,'Driver B')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A, ADM_B, EMP_B, DRIVER_A, DRIVER_B],
    );
    await pool.query(
      `INSERT INTO public.motoristas (id, empresa_id)
       VALUES ($1,$2),($3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [DRIVER_A, EMP_A, DRIVER_B, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES
         ($1,$2,'Unidade A','ativo',true),
         ($3,$2,'Unidade A2','ativo',false),
         ($4,$5,'Unidade B','ativo',true)
       ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A, UNIT_A2, UNIT_B, EMP_B],
    );
  }

  async function seedCampaignFixtures() {
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES
         ($1,$2,'CAMP-A','Campanha A','Soja',$3),
         ($4,$2,'CAMP-B','Campanha B','Milho',$3),
         ($5,$6,'CAMP-C','Campanha C','Algodao',$7)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A, CAMP_B, CAMP_OTHER, EMP_B, ADM_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4),($1,$5,$3,$4)
       ON CONFLICT (campaign_id, unidade_operacional_id) DO NOTHING`,
      [EMP_A, CAMP_A, UNIT_A, ADM_A, CAMP_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_locations (id, empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES
         ($1,$2,$3,'origin','Origem A',$4,$5),
         ($6,$2,$3,'destination','Destino A',$4,$5),
         ($7,$2,$8,'origin','Origem B',$4,$5),
         ($9,$2,$8,'destination','Destino B',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ORIGIN_A, EMP_A, CAMP_A, UNIT_A, ADM_A, DEST_A, ORIGIN_B, CAMP_B, DEST_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_demands
         (id, empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES
         ($1,$2,$3,$4,$5,'Soja',10,'ton',$6),
         ($7,$2,$8,$9,$10,'Milho',8,'ton',$6)
       ON CONFLICT (id) DO NOTHING`,
      [DEMAND_A, EMP_A, CAMP_A, ORIGIN_A, DEST_A, ADM_A, DEMAND_B, CAMP_B, ORIGIN_B, DEST_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by)
       VALUES
         ($1,$2,$3,1,'READY_FOR_REVIEW','campaign-a.test',$4),
         ($5,$2,$6,1,'READY_FOR_REVIEW','campaign-a.test',$4)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_VER_A, EMP_A, CAMP_A, ADM_A, PLAN_VER_B, CAMP_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_scenarios
         (id, empresa_id, campaign_id, plan_version_id, scenario_key, label)
       VALUES
         ($1,$2,$3,$4,'base','Base A'),
         ($5,$2,$6,$7,'base','Base B')
       ON CONFLICT (id) DO NOTHING`,
      [SCEN_A, EMP_A, CAMP_A, PLAN_VER_A, SCEN_B, CAMP_B, PLAN_VER_B],
    );
    await pool.query(
      `INSERT INTO public.fleet_assets
         (id, empresa_id, unidade_operacional_id, asset_type, plate, internal_identifier, useful_capacity_kg, created_by)
       VALUES
         ($1,$2,$3,'truck','AAA0A00','TRUCK-A',10000,$4),
         ($5,$6,$7,'truck','BBB0B00','TRUCK-B',10000,$8)
       ON CONFLICT (id) DO NOTHING`,
      [ASSET_A, EMP_A, UNIT_A, ADM_A, ASSET_B, EMP_B, UNIT_B, ADM_B],
    );
    await pool.query(
      `INSERT INTO public.vehicle_compositions
         (id, empresa_id, unidade_operacional_id, code, name, created_by)
       VALUES
         ($1,$2,$3,'COMP-A','Composicao A',$4),
         ($5,$6,$7,'COMP-B','Composicao B',$8)
       ON CONFLICT (id) DO NOTHING`,
      [COMP_A, EMP_A, UNIT_A, ADM_A, COMP_B, EMP_B, UNIT_B, ADM_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_planned_trips
         (id, empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_asset_id, candidate_driver_id)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,10,'ton',10000,$9,$10),
         ($11,$2,$12,$13,$14,$15,$16,$17,8,'ton',8000,NULL,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [TRIP_A, EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, ASSET_A, DRIVER_A, TRIP_B, CAMP_B, PLAN_VER_B, SCEN_B, ORIGIN_B, DEST_B, DEMAND_B],
    );
  }

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

  test('cross-campaign structural references sao bloqueadas no banco', async () => {
    await expectFkReject(
      `INSERT INTO public.campaign_demands
         (empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,'Soja',1,'ton',$5)`,
      [EMP_A, CAMP_A, ORIGIN_B, DEST_A, ADM_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_demands
         (empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,'Soja',1,'ton',$5)`,
      [EMP_A, CAMP_A, ORIGIN_A, DEST_B, ADM_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_plan_scenarios
         (empresa_id, campaign_id, plan_version_id, scenario_key, label)
       VALUES ($1,$2,$3,'bad-plan','Bad Plan')`,
      [EMP_A, CAMP_A, PLAN_VER_B],
    );
    await expectFkReject(
      `UPDATE public.campaign_plan_versions
          SET superseded_by = $1
        WHERE id = $2`,
      [PLAN_VER_B, PLAN_VER_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000)`,
      [EMP_A, CAMP_A, PLAN_VER_B, SCEN_B, ORIGIN_A, DEST_A, DEMAND_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_B, ORIGIN_A, DEST_A, DEMAND_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_B, DEST_A, DEMAND_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_B, DEMAND_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_approvals
         (empresa_id, campaign_id, plan_version_id, action, actor_user_id)
       VALUES ($1,$2,$3,'APPROVE',$4)`,
      [EMP_A, CAMP_A, PLAN_VER_B, ADM_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_exceptions
         (empresa_id, campaign_id, plan_version_id, exception_type, severity)
       VALUES ($1,$2,$3,'NO_DRIVER','WARNING')`,
      [EMP_A, CAMP_A, PLAN_VER_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_exceptions
         (empresa_id, campaign_id, planned_trip_id, exception_type, severity)
       VALUES ($1,$2,$3,'NO_DRIVER','WARNING')`,
      [EMP_A, CAMP_A, TRIP_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_exceptions
         (empresa_id, campaign_id, plan_version_id, planned_trip_id, exception_type, severity)
       VALUES ($1,$2,$3,$4,'NO_DRIVER','WARNING')`,
      [EMP_A, CAMP_A, PLAN_VER_A, TRIP_B],
    );
    await expectFkReject(
      `UPDATE public.operation_campaigns
          SET approved_plan_version_id = $1
        WHERE id = $2`,
      [PLAN_VER_B, CAMP_A],
    );
  });

  test('referencias de usuario e driver sao tenant-consistent', async () => {
    await expectFkReject(
      `INSERT INTO public.operation_campaigns (empresa_id, reference_code, name, cargo_name, created_by)
       VALUES ($1,'BAD-CREATED','Bad','Soja',$2)`,
      [EMP_A, ADM_B],
    );
    await expectFkReject(
      `UPDATE public.operation_campaigns SET updated_by = $1 WHERE id = $2`,
      [ADM_B, CAMP_A],
    );
    await expectFkReject(
      `UPDATE public.operation_campaigns SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $1 WHERE id = $2`,
      [ADM_B, CAMP_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4)`,
      [EMP_A, CAMP_A, UNIT_A2, ADM_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_locations (empresa_id, campaign_id, kind, name, created_by)
       VALUES ($1,$2,'origin','Bad creator',$3)`,
      [EMP_A, CAMP_A, ADM_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_demands
         (empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,'Soja',1,'ton',$5)`,
      [EMP_A, CAMP_A, ORIGIN_A, DEST_A, ADM_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_plan_versions
         (empresa_id, campaign_id, version_number, status, rules_version, generated_by)
       VALUES ($1,$2,99,'GENERATED','campaign-a.test',$3)`,
      [EMP_A, CAMP_A, ADM_B],
    );
    await expectFkReject(
      `UPDATE public.campaign_plan_versions SET approved_by = $1 WHERE id = $2`,
      [ADM_B, PLAN_VER_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_driver_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000,$8)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, DRIVER_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_approvals
         (empresa_id, campaign_id, plan_version_id, action, actor_user_id)
       VALUES ($1,$2,$3,'APPROVE',$4)`,
      [EMP_A, CAMP_A, PLAN_VER_A, ADM_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_exceptions
         (empresa_id, campaign_id, plan_version_id, exception_type, severity, acknowledged_by)
       VALUES ($1,$2,$3,'NO_DRIVER','WARNING',$4)`,
      [EMP_A, CAMP_A, PLAN_VER_A, ADM_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_exceptions
         (empresa_id, campaign_id, plan_version_id, exception_type, severity, resolved_by)
       VALUES ($1,$2,$3,'NO_DRIVER','WARNING',$4)`,
      [EMP_A, CAMP_A, PLAN_VER_A, ADM_B],
    );
  });

  test('fleet refs continuam tenant-safe sem FK de campaign inventada', async () => {
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_asset_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000,$8)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, ASSET_B],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_composition_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000,$8)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, COMP_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_planned_trips
         (empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_composition_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ton',1000,$8)`,
      [EMP_A, CAMP_A, PLAN_VER_A, SCEN_A, ORIGIN_A, DEST_A, DEMAND_A, COMP_A],
    );
  });

  test('076 usa unique existente de unidades_operacionais sem criar indice redundante', async () => {
    const uniquePairs = await pool.query(
      `SELECT cls.relname AS index_name,
              pg_get_indexdef(idx.indexrelid) AS indexdef
         FROM pg_index idx
         JOIN pg_class cls ON cls.oid = idx.indexrelid
        WHERE idx.indrelid = 'public.unidades_operacionais'::regclass
          AND idx.indisunique = true
          AND (
            SELECT array_agg(att.attname ORDER BY key_ord.ord)
              FROM unnest(idx.indkey) WITH ORDINALITY AS key_ord(attnum, ord)
              JOIN pg_attribute att
                ON att.attrelid = idx.indrelid
               AND att.attnum = key_ord.attnum
          ) = ARRAY['id','empresa_id']::name[]
        ORDER BY cls.relname`,
    );
    assert.equal(uniquePairs.rows.length, 1);
    assert.match(uniquePairs.rows[0].indexdef, /UNIQUE INDEX .* ON public\.unidades_operacionais .* \(id, empresa_id\)/);

    const redundant = await pool.query(
      `SELECT to_regclass('public.unidades_operacionais_id_empresa_key') AS redundant_index`,
    );
    assert.equal(redundant.rows[0].redundant_index, null);

    const unitFks = await pool.query(
      `SELECT conname, convalidated
         FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN ('public.campaign_operational_units'::regclass, 'public.campaign_locations'::regclass)
          AND confrelid = 'public.unidades_operacionais'::regclass
        ORDER BY conname`,
    );
    assert.deepEqual(unitFks.rows, [
      { conname: 'campaign_locations_unit_campaign_fk', convalidated: true },
      { conname: 'campaign_locations_unit_empresa_fk', convalidated: true },
      { conname: 'campaign_units_unit_empresa_fk', convalidated: true },
    ]);
  });

  test('unidades sao tenant-safe e location.unit pertence a campaign', async () => {
    await expectFkReject(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4)`,
      [EMP_A, CAMP_A, UNIT_B, ADM_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_locations (empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES ($1,$2,'origin','Unit fora da campaign',$3,$4)`,
      [EMP_A, CAMP_A, UNIT_A2, ADM_A],
    );
    await expectFkReject(
      `INSERT INTO public.campaign_locations (empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES ($1,$2,'origin','Unit outro tenant',$3,$4)`,
      [EMP_A, CAMP_A, UNIT_B, ADM_A],
    );
  });

  test('permission helper 076 e tecnico, idempotente e nao sobrescreve deny', async () => {
    const { rows: tplRows } = await pool.query(
      `SELECT id FROM public.permission_templates WHERE empresa_id = $1 AND stable_key = 'operador'`,
      [EMP_A],
    );
    assert.equal(tplRows.length, 1);
    const templateId = tplRows[0].id;

    await pool.query(
      `UPDATE public.permission_template_permissions
          SET allowed = false
        WHERE template_id = $1
          AND permission_key = 'campaign.view'`,
      [templateId],
    );
    const before = await pool.query(
      `SELECT count(*)::int AS n
         FROM public.permission_template_permissions
        WHERE template_id = $1
          AND permission_key LIKE 'campaign.%'`,
      [templateId],
    );

    await pool.query(`SELECT public.ensure_operation_campaign_template_permissions_for_empresa($1)`, [EMP_A]);
    await pool.query(`SELECT public.ensure_operation_campaign_template_permissions_for_empresa($1)`, [EMP_A]);

    const after = await pool.query(
      `SELECT count(*)::int AS n
         FROM public.permission_template_permissions
        WHERE template_id = $1
          AND permission_key LIKE 'campaign.%'`,
      [templateId],
    );
    const deny = await pool.query(
      `SELECT allowed
         FROM public.permission_template_permissions
        WHERE template_id = $1
          AND permission_key = 'campaign.view'`,
      [templateId],
    );
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.equal(deny.rows[0].allowed, false);

    const publicExec = await pool.query(
      `SELECT has_function_privilege('anon', 'public.ensure_operation_campaign_template_permissions_for_empresa(uuid)', 'EXECUTE') AS anon_exec,
              has_function_privilege('authenticated', 'public.ensure_operation_campaign_template_permissions_for_empresa(uuid)', 'EXECUTE') AS auth_exec,
              has_function_privilege('service_role', 'public.ensure_operation_campaign_template_permissions_for_empresa(uuid)', 'EXECUTE') AS service_exec`,
    );
    assert.deepEqual(publicExec.rows[0], { anon_exec: false, auth_exec: false, service_exec: true });
  });

  test('RLS isola campanhas por tenant autenticado; cliente Campaign usa backend API', async () => {
    await withAuth(ADM_A, async (client) => {
      const { rows } = await client.query(`SELECT id FROM public.operation_campaigns ORDER BY id`);
      assert.equal(rows.some((row) => row.id === CAMP_A), true);
      assert.equal(rows.some((row) => row.id === CAMP_OTHER), false);
    });
  });

  test('um unico plano aprovado por campanha e nenhuma escrita em fretes', async () => {
    const beforeFretes = await pool.query(`SELECT count(*)::int AS n FROM public.fretes`);
    await pool.query(
      `UPDATE public.campaign_plan_versions
          SET status = 'APPROVED', approved_by = $1, approved_at = now()
        WHERE id = $2`,
      [ADM_A, PLAN_VER_A],
    );
    await pool.query(
      `UPDATE public.operation_campaigns
          SET approved_plan_version_id = $1,
              status = 'APPROVED',
              planning_status = 'APPROVED'
        WHERE id = $2`,
      [PLAN_VER_A, CAMP_A],
    );
    const afterFretes = await pool.query(`SELECT count(*)::int AS n FROM public.fretes`);
    assert.equal(afterFretes.rows[0].n, beforeFretes.rows[0].n);
  });
}

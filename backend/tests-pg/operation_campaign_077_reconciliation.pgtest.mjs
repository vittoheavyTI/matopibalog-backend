// Nunca roda contra producao: exige DATABASE_URL do Postgres efemero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('operation campaign 077 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 077 nao pode ser pulado');
    });
  } else {
    test('operation campaign 077 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
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
  const migration077 = migration('077_operation_campaign_076_payload_reconciliation.sql');
  const pool = new Pool({ connectionString: CONN });

  const EMP_A = '07700000-0000-4000-a000-000000000001';
  const PLAN_A = '07700000-0000-4000-a000-0000000000a1';
  const ADM_A = '07700000-0000-4000-a000-000000000101';
  const CAMP_A = '07700000-0000-4000-a000-000000000401';
  const CAMP_B = '07700000-0000-4000-a000-000000000402';
  const PLAN_VER_A = '07700000-0000-4000-a000-000000000501';
  const PLAN_VER_B = '07700000-0000-4000-a000-000000000502';

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
  }

  async function seedCoreFixtures() {
    await pool.query(
      `INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
       VALUES ($1,'Campaign 077 Plano','empresa',20,20,false)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Campaign 077 Empresa','ativo',$2,'enforced')
       ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'admin','ativo',false,'Admin 077')
       ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A],
    );
  }

  async function seedCampaignFixtures() {
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES
         ($1,$2,'CAMP-077-A','Campanha 077 A','Soja',$3),
         ($4,$2,'CAMP-077-B','Campanha 077 B','Milho',$3)
       ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A, CAMP_B],
    );
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by)
       VALUES
         ($1,$2,$3,1,'READY_FOR_REVIEW','campaign-077.test',$4),
         ($5,$2,$6,1,'READY_FOR_REVIEW','campaign-077.test',$4)
       ON CONFLICT (id) DO NOTHING`,
      [PLAN_VER_A, EMP_A, CAMP_A, ADM_A, PLAN_VER_B, CAMP_B],
    );
  }

  async function prepareCanonical076() {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await installAuthHelpers();
    await seedCoreFixtures();
    await applySql(upgrade075Sql);
    await pool.query(migration076);
    await seedCampaignFixtures();
  }

  async function applyProductionLikeDrift() {
    await pool.query(`
      ALTER TABLE public.campaign_exceptions
        DROP CONSTRAINT IF EXISTS campaign_exceptions_plan_campaign_fk;
    `);
    await pool.query(`
      ALTER TABLE public.campaign_exceptions
        ADD CONSTRAINT campaign_exceptions_plan_campaign_fk
        FOREIGN KEY (plan_version_id, empresa_id)
        REFERENCES public.campaign_plan_versions (id, empresa_id)
        ON DELETE CASCADE;
    `);
  }

  async function fkDefinition() {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS n,
             min(pg_get_constraintdef(oid)) AS definition
        FROM pg_constraint
       WHERE conname = 'campaign_exceptions_plan_campaign_fk'
         AND conrelid = 'public.campaign_exceptions'::regclass
    `);
    return rows[0];
  }

  async function assertCanonicalFk() {
    const fk = await fkDefinition();
    assert.equal(fk.n, 1);
    assert.equal(
      fk.definition,
      'FOREIGN KEY (plan_version_id, campaign_id, empresa_id) REFERENCES campaign_plan_versions(id, campaign_id, empresa_id) ON DELETE CASCADE',
    );
  }

  async function assertProductionLikeDriftFk() {
    const fk = await fkDefinition();
    assert.equal(fk.n, 1);
    assert.equal(
      fk.definition,
      'FOREIGN KEY (plan_version_id, empresa_id) REFERENCES campaign_plan_versions(id, empresa_id) ON DELETE CASCADE',
    );
  }

  after(async () => {
    await pool.end();
  });

  test('077 corrige fixture com drift real de producao 076', async () => {
    await prepareCanonical076();
    await applyProductionLikeDrift();
    await assertProductionLikeDriftFk();

    await pool.query(migration077);

    await assertCanonicalFk();
  });

  test('077 preserva fresh install canonical 076 -> 077', async () => {
    await prepareCanonical076();
    await assertCanonicalFk();

    await pool.query(migration077);

    await assertCanonicalFk();
  });

  test('077 e idempotente e mantem exatamente uma FK canonica', async () => {
    await prepareCanonical076();

    await pool.query(migration077);
    await pool.query(migration077);

    await assertCanonicalFk();
  });

  test('077 restaura bloqueio negativo cross-campaign de exceptions', async () => {
    await prepareCanonical076();
    await applyProductionLikeDrift();
    await pool.query(migration077);

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO public.campaign_exceptions
             (empresa_id, campaign_id, plan_version_id, exception_type, severity)
           VALUES ($1,$2,$3,'NO_DRIVER','WARNING')`,
          [EMP_A, CAMP_A, PLAN_VER_B],
        ),
      (error) => error?.code === '23503',
    );
  });
}

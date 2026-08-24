// PG real (CI): prova a concorrência do replan pós-aprovação (Campaign-D
// §84/§94/§95). Nunca roda contra producao: exige DATABASE_URL do Postgres
// efemero da CI.
//
// A segurança NÃO vem de uma RPC nova nem de uma migration nova — vem dos
// índices únicos já existentes na migration 076
// (campaign_plan_versions_one_approved_key: no máximo 1 linha APPROVED por
// campaign_id) somados à ORDEM correta que campaignService.approvePlan usa
// para aprovar um replan: superar a versão antiga ANTES de promover a nova.
// Este teste prova, com conexões Postgres concorrentes de verdade (não
// mockadas), que essa ordem é segura e que a ordem inversa é corretamente
// rejeitada pelo banco.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('campaign-d replan concurrency PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste de concorrencia do replan nao pode ser pulado');
    });
  } else {
    test('campaign-d replan concurrency PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
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
  const campaignChainSql = [
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
  ];

  const EMP_A = '0d000000-0000-4000-a000-000000000001';
  const ADM_A = '0d000000-0000-4000-a000-000000000101';
  const UNIT_A = '0d000000-0000-4000-a000-000000000301';
  const CAMP_A = '0d000000-0000-4000-a000-000000000401';
  const ORIGIN_A = '0d000000-0000-4000-a000-000000000701';
  const DEST_A = '0d000000-0000-4000-a000-000000000702';
  const DEMAND_A = '0d000000-0000-4000-a000-000000000801';
  const PLAN_A = '0d000000-0000-4000-a000-000000000000';
  const PLAN_V1 = '0d000000-0000-4000-a000-000000000501';
  const PLAN_V2 = '0d000000-0000-4000-a000-000000000502';

  async function applySql(sqls) {
    for (const sql of sqls) await pool.query(sql);
  }
  async function resetPublicSchema() {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres');
  }

  async function seedFixtures() {
    await pool.query(
      `INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
       VALUES ($1,'Plano D','empresa',20,20,false) ON CONFLICT (id) DO NOTHING`,
      [PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
       VALUES ($1,'Empresa D','ativo',$2,'enforced') ON CONFLICT (id) DO NOTHING`,
      [EMP_A, PLAN_A],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'admin','ativo',false,'Admin D') ON CONFLICT (id) DO NOTHING`,
      [ADM_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade D','ativo',true) ON CONFLICT (id) DO NOTHING`,
      [UNIT_A, EMP_A],
    );
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, status, planning_status, created_by)
       VALUES ($1,$2,'CAMP-D','Campanha D','Soja','APPROVED','APPROVED',$3) ON CONFLICT (id) DO NOTHING`,
      [CAMP_A, EMP_A, ADM_A],
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
       VALUES ($1,$2,$3,$4,$5,'Soja',20,'ton',$6) ON CONFLICT (id) DO NOTHING`,
      [DEMAND_A, EMP_A, CAMP_A, ORIGIN_A, DEST_A, ADM_A],
    );
    // v1: já aprovada (autoridade corrente antes do replan).
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by, approved_by, approved_at)
       VALUES ($1,$2,$3,1,'APPROVED','campaign-d.test',$4,$4,now()) ON CONFLICT (id) DO NOTHING`,
      [PLAN_V1, EMP_A, CAMP_A, ADM_A],
    );
    await pool.query(
      `UPDATE public.operation_campaigns SET approved_plan_version_id=$1 WHERE id=$2`,
      [PLAN_V1, CAMP_A],
    );
    // v2: rascunho de replan (READY_FOR_REVIEW), aguardando aprovação.
    await pool.query(
      `INSERT INTO public.campaign_plan_versions
         (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by)
       VALUES ($1,$2,$3,2,'READY_FOR_REVIEW','campaign-d.test',$4) ON CONFLICT (id) DO NOTHING`,
      [PLAN_V2, EMP_A, CAMP_A, ADM_A],
    );
  }

  async function approvedCount() {
    const { rows } = await pool.query(
      `SELECT id FROM public.campaign_plan_versions WHERE campaign_id=$1 AND status='APPROVED'`,
      [CAMP_A],
    );
    return rows;
  }

  test('replan concorrência: promover v2 SEM superar v1 primeiro é rejeitado pelo índice único (nunca 2 versões APPROVED)', async () => {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await applySql(campaignChainSql);
    await seedFixtures();

    // Sequência ERRADA de propósito (o que campaignService.approvePlan NÃO
    // faz): tenta aprovar v2 sem primeiro superar v1, que ainda está
    // APPROVED. O índice único campaign_plan_versions_one_approved_key deve
    // rejeitar, não corromper silenciosamente.
    await assert.rejects(
      pool.query(`UPDATE public.campaign_plan_versions SET status='APPROVED' WHERE id=$1`, [PLAN_V2]),
      (err) => err.code === '23505',
    );
    const approved = await approvedCount();
    assert.equal(approved.length, 1);
    assert.equal(approved[0].id, PLAN_V1);
  });

  test('replan concorrência: 2 conexões concorrentes executando a sequência CORRETA (superar v1, depois aprovar v2) nunca deixam 0 nem 2 versões APPROVED', async () => {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await applySql(campaignChainSql);
    await seedFixtures();

    // Mesma sequência exata que campaignService.approvePlan usa para replan:
    // 1) superar a versão antiga (status=APPROVED -> SUPERSEDED), 2) promover
    // a nova. Duas conexões reais disparam isso ao mesmo tempo (Promise.all)
    // -- simula um duplo-clique real no botão "Aprovar".
    async function runApproveSequence() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE public.campaign_plan_versions SET status='SUPERSEDED', superseded_by=$1
             WHERE campaign_id=$2 AND status='APPROVED'`,
          [PLAN_V2, CAMP_A],
        );
        await client.query(`UPDATE public.campaign_plan_versions SET status='APPROVED', approved_at=now() WHERE id=$1`, [PLAN_V2]);
        await client.query(`UPDATE public.operation_campaigns SET approved_plan_version_id=$1 WHERE id=$2`, [PLAN_V2, CAMP_A]);
        await client.query('COMMIT');
        return { ok: true };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { ok: false, code: err.code };
      } finally {
        client.release();
      }
    }

    const [r1, r2] = await Promise.all([runApproveSequence(), runApproveSequence()]);
    // As duas tentativas fazem exatamente a mesma mutação idempotente (mesmo
    // alvo v2) -- ambas podem terminar OK (a segunda vira no-op sobre um
    // estado já correto) OU uma pode falhar por lock/conflito, mas NUNCA as
    // duas devem deixar o sistema num estado inconsistente.
    assert.ok(r1.ok || r2.ok, 'pelo menos uma das duas execuções concorrentes deve ter sucesso');

    const approved = await approvedCount();
    assert.equal(approved.length, 1, 'nunca deve haver 0 nem 2 versões APPROVED simultaneamente para a mesma campanha');
    assert.equal(approved[0].id, PLAN_V2);

    const { rows: v1rows } = await pool.query(`SELECT status, superseded_by FROM public.campaign_plan_versions WHERE id=$1`, [PLAN_V1]);
    assert.equal(v1rows[0].status, 'SUPERSEDED');
    assert.equal(v1rows[0].superseded_by, PLAN_V2);

    const { rows: campRows } = await pool.query(`SELECT approved_plan_version_id FROM public.operation_campaigns WHERE id=$1`, [CAMP_A]);
    assert.equal(campRows[0].approved_plan_version_id, PLAN_V2);
  });

  after(async () => {
    await pool.end();
  });
}

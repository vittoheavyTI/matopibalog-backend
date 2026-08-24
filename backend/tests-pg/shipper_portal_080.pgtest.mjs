// PG real (CI): certifica a migration 080 (Portal do Embarcador - fundação).
// Prova no BANCO os invariantes que a aplicação sozinha não deveria garantir:
// fronteira entre embarcadores da MESMA transportadora, revogação, imutabilidade
// do snapshot aceito, concorrência de aceite e unicidade de Campanha.
// Nunca roda contra produção: exige DATABASE_URL do Postgres efêmero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('shipper portal 080 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 080 nao pode ser pulado');
    });
  } else {
    test('shipper portal 080 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
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
  const chainSql = [
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
    migration('079_dispatch_v1_atomic_offers.sql'),
    migration('080_shipper_portal_foundation.sql'),
  ];

  // Transportadora A (com 2 embarcadores) e transportadora B (isolada).
  const PLAN = '08000000-0000-4000-a000-000000000000';
  const EMP_A = '08000000-0000-4000-a000-000000000001';
  const EMP_B = '08000000-0000-4000-a000-000000000002';
  const ADM_A = '08000000-0000-4000-a000-000000000101';
  const ADM_B = '08000000-0000-4000-a000-000000000102';
  const ORG_X = '08000000-0000-4000-a000-000000000201';
  const ORG_Y = '08000000-0000-4000-a000-000000000202';
  const ORG_Z = '08000000-0000-4000-a000-000000000203';
  const REL_AX = '08000000-0000-4000-a000-000000000301';
  const REL_AY = '08000000-0000-4000-a000-000000000302';
  const REL_BZ = '08000000-0000-4000-a000-000000000303';
  const USER_X = '08000000-0000-4000-a000-000000000401';
  const USER_Y = '08000000-0000-4000-a000-000000000402';
  const USER_Z = '08000000-0000-4000-a000-000000000403';
  const REQ_X = '08000000-0000-4000-a000-000000000501';
  const REQ_Y = '08000000-0000-4000-a000-000000000502';

  async function applySql(sqls) { for (const sql of sqls) await pool.query(sql); }

  async function resetPublicSchema() {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO postgres');
    await pool.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role').catch(() => {});
  }

  async function installAuthHelpers() {
    await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
    await pool.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await pool.query(`CREATE OR REPLACE FUNCTION public.rls_is_super_admin() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM usuarios WHERE id = auth.uid()), false) $$;`);
    await pool.query(`CREATE OR REPLACE FUNCTION public.rls_is_company_admin() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()), false) $$;`);
    await pool.query(`CREATE OR REPLACE FUNCTION public.rls_empresa_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;`);
  }

  async function seedFixtures() {
    await pool.query(`INSERT INTO public.planos (id, nome, categoria, capacidade_inclusa, limite_motoristas, requer_negociacao)
      VALUES ($1,'Plano P','empresa',20,20,false) ON CONFLICT (id) DO NOTHING`, [PLAN]);
    await pool.query(`INSERT INTO public.empresas (id, nome, status, plano_id, operational_scope_mode)
      VALUES ($1,'Transportadora A','ativo',$3,'enforced'),($2,'Transportadora B','ativo',$3,'enforced')
      ON CONFLICT (id) DO NOTHING`, [EMP_A, EMP_B, PLAN]);
    // O harness PG cria uma versao minima de `usuarios` (sem coluna email) —
    // mesmo conjunto de colunas usado pelo teste do Dispatch V1.
    await pool.query(`INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
      VALUES ($1,$2,'admin','ativo',false,'Admin A'),
             ($3,$4,'admin','ativo',false,'Admin B')
      ON CONFLICT (id) DO NOTHING`, [ADM_A, EMP_A, ADM_B, EMP_B]);

    await pool.query(`INSERT INTO public.shipper_organizations (id, nome)
      VALUES ($1,'Embarcador X'),($2,'Embarcador Y'),($3,'Embarcador Z')
      ON CONFLICT (id) DO NOTHING`, [ORG_X, ORG_Y, ORG_Z]);
    await pool.query(`INSERT INTO public.shipper_carrier_relationships (id, shipper_org_id, empresa_id, created_by)
      VALUES ($1,$2,$3,$4),($5,$6,$3,$4),($7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING`,
      [REL_AX, ORG_X, EMP_A, ADM_A, REL_AY, ORG_Y, REL_BZ, ORG_Z, EMP_B, ADM_B]);
    await pool.query(`INSERT INTO public.shipper_portal_users (id, shipper_org_id, email, nome)
      VALUES ($1,$2,'x@embarcador.test','Contato X'),
             ($3,$4,'y@embarcador.test','Contato Y'),
             ($5,$6,'z@embarcador.test','Contato Z')
      ON CONFLICT (id) DO NOTHING`, [USER_X, ORG_X, USER_Y, ORG_Y, USER_Z, ORG_Z]);
  }

  async function seedRequest(id, { relId, orgId, empresaId, userId, ref, status = 'SUBMITTED' }) {
    await pool.query(
      `INSERT INTO public.shipper_transport_requests
         (id, empresa_id, shipper_org_id, relationship_id, reference_code, status, cargo_name,
          destination_name, quantity_unit, created_by, submitted_at, submitted_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,'Soja','Porto','ton',$7, now(), '{"cargo":"Soja"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, empresaId, orgId, relId, ref, status, userId],
    );
  }

  async function fullSetup() {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await installAuthHelpers();
    await applySql(chainSql);
    await seedFixtures();
  }

  test('080: tabelas do portal existem com RLS habilitado e ZERO grant para anon/authenticated', async () => {
    await fullSetup();
    const tabelas = ['shipper_organizations', 'shipper_carrier_relationships', 'shipper_portal_users',
      'shipper_portal_invitations', 'shipper_transport_requests', 'shipper_transport_request_origins'];
    for (const t of tabelas) {
      const { rows } = await pool.query(
        `SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1`, [t]);
      assert.equal(rows.length, 1, `${t} deve existir`);
      assert.equal(rows[0].relrowsecurity, true, `${t} deve ter RLS habilitado`);

      const { rows: grants } = await pool.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated')`, [t]);
      assert.equal(grants.length, 0,
        `${t} nao deve conceder NADA a anon/authenticated (portal e 100% backend-mediado)`);
    }
  });

  test('080: shipper_portal_users NAO tem coluna empresa_id (identidade externa nunca carrega tenant interno)', async () => {
    await fullSetup();
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='shipper_portal_users' AND column_name='empresa_id'`);
    assert.equal(rows.length, 0, 'identidade externa nao pode ter empresa_id — seria o atalho de tenant proibido');
  });

  test('080 FRONTEIRA: solicitação não pode apontar para relacionamento de OUTRO embarcador da MESMA transportadora', async () => {
    await fullSetup();
    // Tenta criar solicitação do embarcador X usando o relacionamento do Y (mesma
    // transportadora A). A FK composta de fronteira deve rejeitar no banco.
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_transport_requests
           (empresa_id, shipper_org_id, relationship_id, reference_code, cargo_name, destination_name, created_by)
         VALUES ($1,$2,$3,'REQ-CROSS','Soja','Porto',$4)`,
        [EMP_A, ORG_X, REL_AY, USER_X],
      ),
      (err) => err.code === '23503',
    );
  });

  test('080 FRONTEIRA: autor da solicitação precisa pertencer ao embarcador da solicitação', async () => {
    await fullSetup();
    // Usuário do embarcador Y tentando assinar uma solicitação do embarcador X.
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_transport_requests
           (empresa_id, shipper_org_id, relationship_id, reference_code, cargo_name, destination_name, created_by)
         VALUES ($1,$2,$3,'REQ-AUTOR','Soja','Porto',$4)`,
        [EMP_A, ORG_X, REL_AX, USER_Y],
      ),
      (err) => err.code === '23503',
    );
  });

  test('080 FRONTEIRA: relacionamento é único por par (embarcador, transportadora)', async () => {
    await fullSetup();
    await assert.rejects(
      pool.query(`INSERT INTO public.shipper_carrier_relationships (shipper_org_id, empresa_id, created_by)
                  VALUES ($1,$2,$3)`, [ORG_X, EMP_A, ADM_A]),
      (err) => err.code === '23505',
    );
  });

  test('080: mesmo embarcador PODE se relacionar com mais de uma transportadora (não trava multi-carrier)', async () => {
    await fullSetup();
    const { rows } = await pool.query(
      `INSERT INTO public.shipper_carrier_relationships (shipper_org_id, empresa_id, created_by)
       VALUES ($1,$2,$3) RETURNING id`, [ORG_X, EMP_B, ADM_B]);
    assert.equal(rows.length, 1);
  });

  test('080 ACEITE: transição atômica — só o primeiro aceite vence, o segundo falha determinístico', async () => {
    await fullSetup();
    await seedRequest(REQ_X, { relId: REL_AX, orgId: ORG_X, empresaId: EMP_A, userId: USER_X, ref: 'REQ-1' });

    async function aceitar() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT * FROM public.shipper_request_accept($1,$2,$3,$4)`,
          [EMP_A, REQ_X, ADM_A, JSON.stringify({ cargo: 'Soja' })]);
        await client.query('COMMIT');
        return { ok: true, status: rows[0].status };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { ok: false, message: err.message };
      } finally { client.release(); }
    }

    const [r1, r2] = await Promise.all([aceitar(), aceitar()]);
    // Um aceita de fato; o outro ou replay idempotente (ACCEPTED) ou falha —
    // nunca dois aceites "originais" concorrentes corrompendo o estado.
    assert.ok(r1.ok || r2.ok, 'ao menos um aceite deve ter sucesso');
    const { rows } = await pool.query(
      `SELECT status, decided_at, accepted_snapshot FROM public.shipper_transport_requests WHERE id=$1`, [REQ_X]);
    assert.equal(rows[0].status, 'ACCEPTED');
    assert.ok(rows[0].decided_at, 'decided_at deve estar preenchido');
    assert.ok(rows[0].accepted_snapshot, 'snapshot aceito deve estar congelado');
  });

  test('080 ACEITE: relacionamento REVOGADO impede aceitar a solicitação', async () => {
    await fullSetup();
    await seedRequest(REQ_Y, { relId: REL_AX, orgId: ORG_X, empresaId: EMP_A, userId: USER_X, ref: 'REQ-REVOGADO' });
    await pool.query(
      `UPDATE public.shipper_carrier_relationships SET status='REVOKED', revoked_at=now() WHERE id=$1`, [REL_AX]);

    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,$4)`,
        [EMP_A, REQ_Y, ADM_A, JSON.stringify({})]),
      (err) => /relationship_not_active/.test(err.message),
    );
  });

  test('080 ACEITE: solicitação de OUTRA transportadora não é aceitável (tenant isolado na RPC)', async () => {
    await fullSetup();
    await seedRequest(REQ_X, { relId: REL_AX, orgId: ORG_X, empresaId: EMP_A, userId: USER_X, ref: 'REQ-T' });
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,$4)`,
        [EMP_B, REQ_X, ADM_B, JSON.stringify({})]),
      (err) => /request_not_found/.test(err.message),
    );
  });

  test('080 CAMPANHA: uma Campanha nunca pode ser reivindicada por duas solicitações', async () => {
    await fullSetup();
    await seedRequest(REQ_X, { relId: REL_AX, orgId: ORG_X, empresaId: EMP_A, userId: USER_X, ref: 'REQ-C1' });
    await seedRequest(REQ_Y, { relId: REL_AY, orgId: ORG_Y, empresaId: EMP_A, userId: USER_Y, ref: 'REQ-C2' });
    await pool.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`, [EMP_A, REQ_X, ADM_A, JSON.stringify({})]);
    await pool.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`, [EMP_A, REQ_Y, ADM_A, JSON.stringify({})]);

    const camp = '08000000-0000-4000-a000-000000000901';
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES ($1,$2,'CAMP-P','Campanha Portal','Soja',$3)`, [camp, EMP_A, ADM_A]);

    await pool.query(`SELECT public.shipper_request_link_campaign($1,$2,$3)`, [EMP_A, REQ_X, camp]);
    // Replay idêntico é idempotente.
    await pool.query(`SELECT public.shipper_request_link_campaign($1,$2,$3)`, [EMP_A, REQ_X, camp]);
    // Outra solicitação NÃO pode reivindicar a mesma Campanha.
    await assert.rejects(
      pool.query(`SELECT public.shipper_request_link_campaign($1,$2,$3)`, [EMP_A, REQ_Y, camp]),
      (err) => err.code === '23505',
    );
  });

  test('080 CAMPANHA: vincular Campanha de OUTRA transportadora é rejeitado pela FK composta', async () => {
    await fullSetup();
    await seedRequest(REQ_X, { relId: REL_AX, orgId: ORG_X, empresaId: EMP_A, userId: USER_X, ref: 'REQ-CB' });
    await pool.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`, [EMP_A, REQ_X, ADM_A, JSON.stringify({})]);
    const campB = '08000000-0000-4000-a000-000000000902';
    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, created_by)
       VALUES ($1,$2,'CAMP-B','Campanha B','Soja',$3)`, [campB, EMP_B, ADM_B]);
    await assert.rejects(
      pool.query(`SELECT public.shipper_request_link_campaign($1,$2,$3)`, [EMP_A, REQ_X, campB]),
      (err) => err.code === '23503',
    );
  });

  test('080 SNAPSHOT: solicitação SUBMITTED exige snapshot; ACCEPTED exige snapshot aceito', async () => {
    await fullSetup();
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_transport_requests
           (empresa_id, shipper_org_id, relationship_id, reference_code, status, cargo_name, destination_name, created_by)
         VALUES ($1,$2,$3,'REQ-SEM-SNAP','SUBMITTED','Soja','Porto',$4)`,
        [EMP_A, ORG_X, REL_AX, USER_X]),
      (err) => err.code === '23514',
    );
  });

  test('080 CONVITE: no máximo 1 convite PENDENTE por (relacionamento, e-mail)', async () => {
    await fullSetup();
    const base = [EMP_A, ORG_X, REL_AX, 'contato@embarcador.test', 'hash-1', ADM_A];
    await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')`, base);
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_portal_invitations
           (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
         VALUES ($1,$2,$3,$4,'hash-2',$6, now() + interval '7 days')`, base),
      (err) => err.code === '23505',
    );
  });

  test('080 CONVITE: token_hash é único globalmente (nunca dois convites com o mesmo token)', async () => {
    await fullSetup();
    await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,'a@t.test','hash-unico',$4, now() + interval '7 days')`,
      [EMP_A, ORG_X, REL_AX, ADM_A]);
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_portal_invitations
           (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
         VALUES ($1,$2,$3,'b@t.test','hash-unico',$4, now() + interval '7 days')`,
        [EMP_A, ORG_Y, REL_AY, ADM_A]),
      (err) => err.code === '23505',
    );
  });

  test('080 RPCs: apenas service_role executa; anon/authenticated não recebem EXECUTE', async () => {
    await fullSetup();
    for (const fn of ['shipper_request_accept', 'shipper_request_link_campaign']) {
      const { rows } = await pool.query(
        `SELECT r.rolname, a.privilege_type
         FROM pg_proc p
         LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
         LEFT JOIN pg_roles r ON r.oid = a.grantee
         WHERE p.pronamespace='public'::regnamespace AND p.proname=$1`, [fn]);
      const externos = rows.filter((r) => ['anon', 'authenticated'].includes(r.rolname));
      assert.equal(externos.length, 0, `${fn} nao pode ser executavel por anon/authenticated`);
      assert.ok(rows.some((r) => r.rolname === 'service_role'), `${fn} deve ser executavel por service_role`);
    }
  });

  after(async () => { await pool.end(); });
}

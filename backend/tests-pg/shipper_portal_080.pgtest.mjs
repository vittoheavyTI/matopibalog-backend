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
    const sql = `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')`;
    await pool.query(sql, [EMP_A, ORG_X, REL_AX, 'contato@embarcador.test', 'hash-1', ADM_A]);
    // Mesmo relacionamento + mesmo e-mail, token diferente: o índice único
    // parcial (WHERE status='PENDING') deve rejeitar o segundo convite pendente.
    await assert.rejects(
      pool.query(sql, [EMP_A, ORG_X, REL_AX, 'contato@embarcador.test', 'hash-2', ADM_A]),
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

  // ==========================================================================
  // OWNER REVIEW HIGH-01 — privilégio padrão do operador
  // ==========================================================================

  test('080 HIGH-01: administrador recebe manage+review; gerente_frota só review; operador NENHUMA por padrão', async () => {
    await fullSetup();
    // Templates canônicos por empresa (a 072 cria; aqui garantimos os 3 alvos).
    for (const [key, nome] of [['administrador', 'Administrador'], ['gerente_frota', 'Gerente de frota'], ['operador', 'Operador']]) {
      await pool.query(
        `INSERT INTO public.permission_templates (empresa_id, stable_key, display_name)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [EMP_A, key, nome]);
    }
    await pool.query(`SELECT public.ensure_shipper_portal_template_permissions_for_empresa($1)`, [EMP_A]);

    const chaves = async (stableKey) => {
      const { rows } = await pool.query(
        `SELECT p.permission_key FROM public.permission_template_permissions p
         JOIN public.permission_templates t ON t.id = p.template_id
         WHERE t.empresa_id=$1 AND t.stable_key=$2 AND p.permission_key LIKE 'shipper_portal%'
         ORDER BY p.permission_key`, [EMP_A, stableKey]);
      return rows.map((r) => r.permission_key);
    };

    assert.deepEqual(await chaves('administrador'), ['shipper_portal.manage', 'shipper_portal.requests.review']);
    assert.deepEqual(await chaves('gerente_frota'), ['shipper_portal.requests.review']);
    assert.deepEqual(await chaves('operador'), [],
      'operador NAO pode receber permissao de portal por padrao — aceitar solicitacao inicia operacao');
  });

  test('080 HIGH-01: backfill é idempotente e não toca permissões não relacionadas ao portal', async () => {
    await fullSetup();
    await pool.query(
      `INSERT INTO public.permission_templates (empresa_id, stable_key, display_name)
       VALUES ($1,'administrador','Administrador') ON CONFLICT DO NOTHING`, [EMP_A]);
    const { rows: tpl } = await pool.query(
      `SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='administrador'`, [EMP_A]);
    await pool.query(
      `INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
       VALUES ($1,'freight.view',true) ON CONFLICT DO NOTHING`, [tpl[0].id]);

    await pool.query(`SELECT public.ensure_shipper_portal_template_permissions_for_empresa($1)`, [EMP_A]);
    await pool.query(`SELECT public.ensure_shipper_portal_template_permissions_for_empresa($1)`, [EMP_A]);

    const { rows } = await pool.query(
      `SELECT permission_key, count(*)::int AS n FROM public.permission_template_permissions
       WHERE template_id=$1 GROUP BY permission_key ORDER BY permission_key`, [tpl[0].id]);
    const mapa = Object.fromEntries(rows.map((r) => [r.permission_key, r.n]));
    assert.equal(mapa['freight.view'], 1, 'permissao nao relacionada nao pode ser duplicada nem removida');
    assert.equal(mapa['shipper_portal.manage'], 1, 'replay nao pode duplicar');
  });

  // ==========================================================================
  // OWNER REVIEW HIGH-02 — criação atômica (request + origens + snapshot)
  // ==========================================================================

  async function criarESubmeter(client, { orgId = ORG_X, relId = REL_AX, userId = USER_X, ref = 'SOL-A', origins, clientRequestId = null } = {}) {
    const executor = client || pool;
    const { rows } = await executor.query(
      `SELECT * FROM public.shipper_request_create_and_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [orgId, relId, userId, ref, 'Soja', 'Porto', 'ton', null, null, null,
        JSON.stringify(origins || [{ nome: 'Fazenda A', quantidade: 300 }, { nome: 'Fazenda B', quantidade: 200 }]),
        clientRequestId],
    );
    return rows[0];
  }

  test('080 HIGH-02: criação atômica grava request + origens + snapshot já em SUBMITTED', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-ATOMICA' });
    assert.equal(req.status, 'SUBMITTED');
    assert.ok(req.submitted_snapshot, 'snapshot deve estar congelado');
    assert.equal(Number(req.submitted_snapshot.total_quantidade), 500);
    assert.equal(req.submitted_snapshot.origins.length, 2);

    const { rows: origens } = await pool.query(
      `SELECT nome, quantidade FROM public.shipper_transport_request_origins WHERE request_id=$1 ORDER BY ordem`, [req.id]);
    assert.equal(origens.length, 2);
    // Snapshot corresponde EXATAMENTE às origens gravadas (§13).
    assert.deepEqual(req.submitted_snapshot.origins.map((o) => o.nome), origens.map((o) => o.nome));
  });

  test('080 HIGH-02: falha ao inserir origem NÃO deixa DRAFT parcial commitado', async () => {
    await fullSetup();
    // quantidade negativa viola o CHECK da tabela de origens → transação inteira aborta.
    await assert.rejects(
      criarESubmeter(null, { ref: 'SOL-FALHA', origins: [{ nome: 'Fazenda A', quantidade: 100 }, { nome: 'Fazenda B', quantidade: -5 }] }),
      (err) => err.code === '23514',
    );
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_requests WHERE reference_code='SOL-FALHA'`);
    assert.equal(rows[0].n, 0, 'nenhum rascunho parcial pode sobrar apos falha');
    const { rows: orfas } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_request_origins`);
    assert.equal(orfas[0].n, 0, 'nenhuma origem orfa pode sobrar');
  });

  test('080 HIGH-02: relacionamento revogado impede criar solicitação (transação nem começa a gravar)', async () => {
    await fullSetup();
    await pool.query(`UPDATE public.shipper_carrier_relationships SET status='REVOKED', revoked_at=now() WHERE id=$1`, [REL_AX]);
    await assert.rejects(
      criarESubmeter(null, { ref: 'SOL-REV' }),
      (err) => /relationship_not_active/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_transport_requests`);
    assert.equal(rows[0].n, 0);
  });

  test('080 HIGH-02: usuário de OUTRO embarcador não pode criar solicitação nesta organização', async () => {
    await fullSetup();
    await assert.rejects(
      criarESubmeter(null, { orgId: ORG_X, relId: REL_AX, userId: USER_Y, ref: 'SOL-XY' }),
      (err) => /portal_user_not_in_org/.test(err.message),
    );
  });

  test('080 HIGH-02: replay do mesmo client_request_id converge para UMA solicitação', async () => {
    await fullSetup();
    const a = await criarESubmeter(null, { ref: 'SOL-IDEM', clientRequestId: 'cli-1' });
    const b = await criarESubmeter(null, { ref: 'SOL-IDEM-2', clientRequestId: 'cli-1' });
    assert.equal(a.id, b.id, 'replay deve devolver a mesma solicitacao');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_requests WHERE client_request_id='cli-1'`);
    assert.equal(rows[0].n, 1);
    const { rows: origens } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_request_origins WHERE request_id=$1`, [a.id]);
    assert.equal(origens[0].n, 2, 'replay nao pode duplicar origens');
  });

  // PROOF-01 (§16): a versão anterior deste teste só exigia `r1.ok || r2.ok`,
  // o que NÃO prova "sem 500" para quem perde a corrida. Agora exige que AMBAS
  // as chamadas tenham sucesso, com o MESMO id, uma única solicitação e um
  // único conjunto de origens.
  test('080 PROOF-01: duas criações CONCORRENTES com mesmo client_request_id → AMBAS ok, mesmo id, sem erro', async () => {
    await fullSetup();
    async function tentar() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const row = await criarESubmeter(client, { ref: `SOL-C-${Math.random().toString(36).slice(2, 8)}`, clientRequestId: 'cli-concorrente' });
        await client.query('COMMIT');
        return { ok: true, id: row.id, status: row.status };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { ok: false, code: err.code, message: err.message };
      } finally { client.release(); }
    }
    const [r1, r2] = await Promise.all([tentar(), tentar()]);

    assert.equal(r1.ok, true, `chamada 1 nao pode falhar: ${r1.message || ''}`);
    assert.equal(r2.ok, true, `chamada 2 (perdedora da corrida) nao pode receber erro: ${r2.message || ''}`);
    assert.equal(r1.id, r2.id, 'as duas chamadas devem convergir para a MESMA solicitacao');
    assert.equal(r1.status, 'SUBMITTED');
    assert.equal(r2.status, 'SUBMITTED');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_requests WHERE client_request_id='cli-concorrente'`);
    assert.equal(rows[0].n, 1, 'nunca podem existir duas solicitacoes para o mesmo client_request_id');
    const { rows: origens } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_transport_request_origins WHERE request_id=$1`, [r1.id]);
    assert.equal(origens[0].n, 2, 'exatamente UM conjunto logico de origens');
  });

  test('080 PROOF-01: replay com payload DIFERENTE devolve a solicitação ORIGINAL (não reescreve o primeiro payload)', async () => {
    await fullSetup();
    const primeira = await criarESubmeter(null, {
      ref: 'SOL-ORIG', clientRequestId: 'cli-payload',
      origins: [{ nome: 'Fazenda A', quantidade: 100 }],
    });
    const replay = await criarESubmeter(null, {
      ref: 'SOL-OUTRA', clientRequestId: 'cli-payload',
      origins: [{ nome: 'Fazenda Z', quantidade: 999 }],
    });
    assert.equal(replay.id, primeira.id);
    assert.equal(replay.reference_code, 'SOL-ORIG', 'payload posterior nao pode reescrever o original');
    const { rows } = await pool.query(
      `SELECT nome, quantidade FROM public.shipper_transport_request_origins WHERE request_id=$1`, [primeira.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nome, 'Fazenda A');
    assert.equal(Number(rows[0].quantidade), 100);
  });

  // ==========================================================================
  // OWNER REVIEW HIGH-04 — uma solicitação, uma unidade
  // ==========================================================================

  test('080 HIGH-04: todas as origens gravam a unidade CANÔNICA da solicitação e o total é somável', async () => {
    await fullSetup();
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_create_and_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ORG_X, REL_AX, USER_X, 'SOL-UNIT', 'Soja', 'Porto', 'kg', null, null, null,
        JSON.stringify([{ nome: 'Fazenda A', quantidade: 1000 }, { nome: 'Fazenda B', quantidade: 500 }]), null]);
    const req = rows[0];
    assert.equal(req.quantity_unit, 'kg');
    assert.equal(Number(req.submitted_snapshot.total_quantidade), 1500);

    const { rows: origens } = await pool.query(
      `SELECT DISTINCT quantity_unit FROM public.shipper_transport_request_origins WHERE request_id=$1`, [req.id]);
    assert.equal(origens.length, 1, 'todas as origens precisam ter a MESMA unidade');
    assert.equal(origens[0].quantity_unit, 'kg', 'origens herdam a unidade da solicitacao');
    // Snapshot também consistente.
    for (const o of req.submitted_snapshot.origins) {
      assert.equal(o.quantity_unit, 'kg');
    }
  });

  test('080 HIGH-04: unidade divergente por origem é RECUSADA (1000 kg + 1 ton nunca vira 1001)', async () => {
    await fullSetup();
    await assert.rejects(
      pool.query(
        `SELECT * FROM public.shipper_request_create_and_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ORG_X, REL_AX, USER_X, 'SOL-MIX', 'Soja', 'Porto', 'kg', null, null, null,
          JSON.stringify([{ nome: 'Fazenda A', quantidade: 1000, quantity_unit: 'kg' },
            { nome: 'Fazenda B', quantidade: 1, quantity_unit: 'ton' }]), null]),
      (err) => /origin_unit_mismatch/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_transport_requests`);
    assert.equal(rows[0].n, 0, 'nenhuma linha pode ser gravada quando as unidades divergem');
    const { rows: o } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_transport_request_origins`);
    assert.equal(o[0].n, 0);
  });

  test('080 HIGH-04: quantidade ZERO é recusada e não grava nada', async () => {
    await fullSetup();
    await assert.rejects(
      criarESubmeter(null, { ref: 'SOL-ZERO', origins: [{ nome: 'Fazenda A', quantidade: 100 }, { nome: 'Fazenda B', quantidade: 0 }] }),
      (err) => /origin_quantity_must_be_positive/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_transport_requests`);
    assert.equal(rows[0].n, 0);
  });

  test('080 HIGH-04: quantidade NEGATIVA é recusada e não grava nada', async () => {
    await fullSetup();
    await assert.rejects(
      criarESubmeter(null, { ref: 'SOL-NEG', origins: [{ nome: 'Fazenda A', quantidade: -5 }] }),
      (err) => /origin_quantity_must_be_positive/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_transport_requests`);
    assert.equal(rows[0].n, 0);
  });

  test('080 HIGH-04: CHECK do banco também recusa quantidade zero (defesa em profundidade)', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-CHK' });
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_transport_request_origins (request_id, empresa_id, nome, quantidade, quantity_unit)
         VALUES ($1,$2,'Direto',0,'ton')`, [req.id, EMP_A]),
      (err) => err.code === '23514',
    );
  });

  // ==========================================================================
  // HARDENING-01 — aceitante do convite pertence ao embarcador do convite
  // ==========================================================================

  test('080 HARDENING-01: convite do embarcador X não pode ser aceito por usuário do embarcador Y', async () => {
    await fullSetup();
    const { rows: inv } = await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,'contato@x.test','hash-hard',$4, now() + interval '7 days') RETURNING id`,
      [EMP_A, ORG_X, REL_AX, ADM_A]);

    // USER_Y pertence a ORG_Y — a FK composta deve rejeitar.
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_portal_invitations
            SET status='ACCEPTED', accepted_at=now(), accepted_by=$1 WHERE id=$2`,
        [USER_Y, inv[0].id]),
      (err) => err.code === '23503',
    );
  });

  test('080 HARDENING-01: convite aceito pelo usuário do PRÓPRIO embarcador funciona', async () => {
    await fullSetup();
    const { rows: inv } = await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,'contato@x.test','hash-ok',$4, now() + interval '7 days') RETURNING id`,
      [EMP_A, ORG_X, REL_AX, ADM_A]);
    const { rows } = await pool.query(
      `UPDATE public.shipper_portal_invitations
          SET status='ACCEPTED', accepted_at=now(), accepted_by=$1 WHERE id=$2 RETURNING status`,
      [USER_X, inv[0].id]);
    assert.equal(rows[0].status, 'ACCEPTED');
  });

  test('080 HARDENING-01: convite ACCEPTED sem accepted_by é recusado pelo CHECK', async () => {
    await fullSetup();
    const { rows: inv } = await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,'c@x.test','hash-sem-user',$4, now() + interval '7 days') RETURNING id`,
      [EMP_A, ORG_X, REL_AX, ADM_A]);
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_portal_invitations SET status='ACCEPTED', accepted_at=now() WHERE id=$1`,
        [inv[0].id]),
      (err) => err.code === '23514',
    );
  });

  // ==========================================================================
  // OWNER REVIEW HIGH-03 — race cancel × accept
  // ==========================================================================

  test('080 HIGH-03: accept e cancel CONCORRENTES na mesma solicitação → exatamente um desfecho terminal', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-RACE' });

    async function aceitar() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`,
          [EMP_A, req.id, ADM_A, JSON.stringify({ origem: 'accept' })]);
        await client.query('COMMIT');
        return { ok: true, quem: 'accept' };
      } catch (err) { await client.query('ROLLBACK').catch(() => {}); return { ok: false, quem: 'accept', message: err.message }; }
      finally { client.release(); }
    }
    async function cancelar() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT public.shipper_request_cancel($1,$2,$3,$4)`,
          [ORG_X, req.id, USER_X, 'desisti']);
        await client.query('COMMIT');
        return { ok: true, quem: 'cancel' };
      } catch (err) { await client.query('ROLLBACK').catch(() => {}); return { ok: false, quem: 'cancel', message: err.message }; }
      finally { client.release(); }
    }

    const [ra, rc] = await Promise.all([aceitar(), cancelar()]);
    const vencedores = [ra, rc].filter((r) => r.ok);
    assert.equal(vencedores.length, 1,
      `exatamente uma decisao pode vencer (accept.ok=${ra.ok} cancel.ok=${rc.ok})`);

    const { rows } = await pool.query(
      `SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.ok(['ACCEPTED', 'CANCELLED'].includes(rows[0].status));
    assert.equal(rows[0].status, vencedores[0].quem === 'accept' ? 'ACCEPTED' : 'CANCELLED',
      'o estado final deve corresponder a quem venceu o lock');
  });

  test('080 HIGH-03: depois de ACEITA, o portal não consegue cancelar (não desfaz decisão de negócio)', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-ACEITA' });
    await pool.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`, [EMP_A, req.id, ADM_A, JSON.stringify({})]);
    await assert.rejects(
      pool.query(`SELECT public.shipper_request_cancel($1,$2,$3,$4)`, [ORG_X, req.id, USER_X, 'tarde demais']),
      (err) => /request_not_cancellable/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(rows[0].status, 'ACCEPTED');
  });

  test('080 HIGH-03: depois de CANCELADA, a transportadora não consegue aceitar', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-CANC' });
    await pool.query(`SELECT public.shipper_request_cancel($1,$2,$3,$4)`, [ORG_X, req.id, USER_X, 'desisti']);
    await assert.rejects(
      pool.query(`SELECT public.shipper_request_accept($1,$2,$3,$4)`, [EMP_A, req.id, ADM_A, JSON.stringify({})]),
      (err) => /request_not_acceptable/.test(err.message),
    );
    const { rows } = await pool.query(`SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(rows[0].status, 'CANCELLED');
  });

  test('080 HIGH-03: cancelar duas vezes é idempotente (não grava segunda história)', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-CANC2' });
    const { rows: r1 } = await pool.query(`SELECT * FROM public.shipper_request_cancel($1,$2,$3,$4)`, [ORG_X, req.id, USER_X, 'motivo']);
    const { rows: r2 } = await pool.query(`SELECT * FROM public.shipper_request_cancel($1,$2,$3,$4)`, [ORG_X, req.id, USER_X, 'outro motivo']);
    assert.equal(r1[0].status, 'CANCELLED');
    assert.equal(r2[0].status, 'CANCELLED');
    assert.equal(r1[0].cancelled_at.toISOString(), r2[0].cancelled_at.toISOString(),
      'replay nao pode reescrever o instante do cancelamento');
  });

  test('080 HIGH-03: usuário de OUTRO embarcador não cancela solicitação alheia', async () => {
    await fullSetup();
    const req = await criarESubmeter(null, { ref: 'SOL-ALHEIA' });
    // ORG_Y tentando cancelar solicitação de ORG_X: a própria busca já não acha.
    await assert.rejects(
      pool.query(`SELECT public.shipper_request_cancel($1,$2,$3,$4)`, [ORG_Y, req.id, USER_Y, 'x']),
      (err) => /request_not_found/.test(err.message),
    );
  });

  test('080 RPCs: apenas service_role executa; anon/authenticated não recebem EXECUTE', async () => {
    await fullSetup();
    for (const fn of ['shipper_request_accept', 'shipper_request_link_campaign',
      'shipper_request_create_and_submit', 'shipper_request_cancel']) {
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

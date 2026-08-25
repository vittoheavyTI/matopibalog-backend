// PG real (CI): certifica a migration 081 (Portal do Embarcador - PORTAL-B).
// Prova no BANCO o que a aplicação sozinha não garante: histórico de submissão
// imutável, corrida de reenvio contra aceite/rejeição/cancelamento, ativação de
// convite atômica e a autoridade de visibilidade externa de documento.
// Nunca roda contra produção: exige DATABASE_URL do Postgres efêmero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('shipper portal B 081 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 081 nao pode ser pulado');
    });
  } else {
    test('shipper portal B 081 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
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
    migration('081_shipper_portal_b_revision_documents.sql'),
  ];

  const PLAN = '08100000-0000-4000-a000-000000000000';
  const EMP_A = '08100000-0000-4000-a000-000000000001';
  const EMP_B = '08100000-0000-4000-a000-000000000002';
  const ADM_A = '08100000-0000-4000-a000-000000000101';
  const ADM_B = '08100000-0000-4000-a000-000000000102';
  const ORG_X = '08100000-0000-4000-a000-000000000201';
  const ORG_Y = '08100000-0000-4000-a000-000000000202';
  const REL_AX = '08100000-0000-4000-a000-000000000301';
  const REL_AY = '08100000-0000-4000-a000-000000000302';
  const USER_X = '08100000-0000-4000-a000-000000000401';
  const USER_Y = '08100000-0000-4000-a000-000000000402';
  const AUTH_NEW = '08100000-0000-4000-a000-000000000501';
  const AUTH_NEW2 = '08100000-0000-4000-a000-000000000502';

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
    await pool.query(`INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
      VALUES ($1,$2,'admin','ativo',false,'Admin A'),
             ($3,$4,'admin','ativo',false,'Admin B')
      ON CONFLICT (id) DO NOTHING`, [ADM_A, EMP_A, ADM_B, EMP_B]);
    await pool.query(`INSERT INTO public.shipper_organizations (id, nome)
      VALUES ($1,'Embarcador X'),($2,'Embarcador Y')
      ON CONFLICT (id) DO NOTHING`, [ORG_X, ORG_Y]);
    await pool.query(`INSERT INTO public.shipper_carrier_relationships (id, shipper_org_id, empresa_id, created_by)
      VALUES ($1,$2,$3,$4),($5,$6,$3,$4)
      ON CONFLICT (id) DO NOTHING`, [REL_AX, ORG_X, EMP_A, ADM_A, REL_AY, ORG_Y]);
    await pool.query(`INSERT INTO public.shipper_portal_users (id, shipper_org_id, email, nome)
      VALUES ($1,$2,'x@embarcador.test','Contato X'),
             ($3,$4,'y@embarcador.test','Contato Y')
      ON CONFLICT (id) DO NOTHING`, [USER_X, ORG_X, USER_Y, ORG_Y]);
  }

  async function fullSetup() {
    await resetPublicSchema();
    await applySql(bootstrapSql);
    await installAuthHelpers();
    await applySql(chainSql);
    await seedFixtures();
  }

  // Cria uma solicitação REAL pela RPC (não por INSERT direto), para que o
  // histórico de submissão exista como em produção.
  async function criarSolicitacao({ ref = 'REQ-1', origins = [{ nome: 'Fazenda 1', quantidade: 100 }] } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_create_and_submit($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL,$8::jsonb,NULL)`,
      [ORG_X, REL_AX, USER_X, ref, 'Soja', 'Porto de Itaqui', 'ton', JSON.stringify(origins)],
    );
    return rows[0];
  }

  async function pedirAjustes(requestId, motivo = 'Ajuste a janela de coleta.') {
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_decide($1,$2,$3,'CHANGES_REQUESTED',$4)`,
      [EMP_A, requestId, ADM_A, motivo],
    );
    return rows[0];
  }

  async function reenviar(requestId, { origins = [{ nome: 'Fazenda 1', quantidade: 150 }], expected = null } = {}) {
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_revise_and_resubmit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7::jsonb,$8)`,
      [ORG_X, requestId, USER_X, 'Soja', 'Porto de Itaqui', 'ton', JSON.stringify(origins), expected],
    );
    return rows[0];
  }

  // ---- estrutura ----------------------------------------------------------

  test('081: novas tabelas existem com RLS e ZERO grant para anon/authenticated', async () => {
    await fullSetup();
    const tabelas = ['shipper_transport_request_submissions', 'shipper_request_documents', 'shipper_document_shares'];
    for (const t of tabelas) {
      const { rows } = await pool.query(
        `SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1`, [t]);
      assert.equal(rows.length, 1, `${t} deve existir`);
      assert.equal(rows[0].relrowsecurity, true, `${t} deve ter RLS habilitado`);
      const { rows: grants } = await pool.query(
        `SELECT grantee FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated')`, [t]);
      assert.equal(grants.length, 0, `${t} nao deve conceder nada a anon/authenticated`);
    }
  });

  test('081: RPCs novas sao SECURITY DEFINER e so service_role executa', async () => {
    await fullSetup();
    const fns = ['shipper_request_revise_and_resubmit', 'shipper_request_decide',
      'shipper_invitation_activate', 'ensure_shipper_portal_b_permissions_for_empresa'];
    for (const fn of fns) {
      const { rows } = await pool.query(
        `SELECT p.prosecdef, p.proconfig::text AS cfg FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`, [fn]);
      assert.equal(rows.length, 1, `${fn} deve existir`);
      assert.equal(rows[0].prosecdef, true, `${fn} deve ser SECURITY DEFINER`);
      assert.match(rows[0].cfg || '', /search_path=public/, `${fn} deve fixar search_path`);
      const { rows: g } = await pool.query(
        `SELECT grantee FROM information_schema.role_routine_grants
         WHERE routine_schema='public' AND routine_name=$1 AND grantee IN ('anon','authenticated','PUBLIC')`, [fn]);
      assert.equal(g.length, 0, `${fn} nao pode ser executavel por anon/authenticated/PUBLIC`);
    }
  });

  // ---- histórico de submissão --------------------------------------------

  test('081 HISTÓRICO: criar solicitação grava a versão 1 na mesma transação', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    assert.equal(req.status, 'SUBMITTED');
    assert.equal(req.current_submission_version, 1);
    const { rows } = await pool.query(
      `SELECT version, snapshot, decision FROM public.shipper_transport_request_submissions
       WHERE request_id=$1 ORDER BY version`, [req.id]);
    assert.equal(rows.length, 1, 'deve existir exatamente a v1');
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].decision, null, 'v1 ainda nao foi decidida');
    assert.equal(rows[0].snapshot.total_quantidade, 100, 'snapshot da v1 registra o que foi enviado');
  });

  test('081 HISTÓRICO: reenvio cria v2 e NÃO sobrescreve a v1 avaliada pela transportadora', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id, 'A quantidade nao confere com o combinado.');

    // A decisão foi carimbada NA v1 — é ela que a transportadora viu.
    const v1 = await pool.query(
      `SELECT * FROM public.shipper_transport_request_submissions WHERE request_id=$1 AND version=1`, [req.id]);
    assert.equal(v1.rows[0].decision, 'CHANGES_REQUESTED');
    assert.equal(v1.rows[0].decision_reason, 'A quantidade nao confere com o combinado.');
    assert.equal(Number(v1.rows[0].snapshot.total_quantidade), 100);

    const rev = await reenviar(req.id, { origins: [{ nome: 'Fazenda 1', quantidade: 150 }] });
    assert.equal(rev.status, 'SUBMITTED', 'reenvio volta para aguardando decisao');
    assert.equal(rev.current_submission_version, 2);
    assert.equal(rev.revision_count, 1);
    assert.equal(rev.decision_reason, null, 'motivo antigo nao fica pendurado na solicitacao');

    const todas = await pool.query(
      `SELECT version, decision, snapshot FROM public.shipper_transport_request_submissions
       WHERE request_id=$1 ORDER BY version`, [req.id]);
    assert.equal(todas.rows.length, 2, 'v1 e v2 coexistem');
    // O ponto central: a v1 continua íntegra, com o valor original e a decisão.
    assert.equal(Number(todas.rows[0].snapshot.total_quantidade), 100, 'v1 preservada');
    assert.equal(todas.rows[0].decision, 'CHANGES_REQUESTED');
    assert.equal(Number(todas.rows[1].snapshot.total_quantidade), 150, 'v2 traz a correcao');
    assert.equal(todas.rows[1].decision, null);
  });

  test('081 HISTÓRICO: aceite carimba a decisão na versão corrente (e não na antiga)', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);
    await reenviar(req.id);
    await pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`, [EMP_A, req.id, ADM_A]);

    const { rows } = await pool.query(
      `SELECT version, decision FROM public.shipper_transport_request_submissions
       WHERE request_id=$1 ORDER BY version`, [req.id]);
    assert.equal(rows[0].decision, 'CHANGES_REQUESTED', 'v1 mantem a decisao original');
    assert.equal(rows[1].decision, 'ACCEPTED', 'o aceite se refere a v2, que foi a versao avaliada');
  });

  test('081 REVISÃO: só é possível reenviar quando a transportadora pediu ajustes', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    // Ainda SUBMITTED: reenviar por cima seria burlar a fila de decisao.
    await assert.rejects(reenviar(req.id), (e) => /request_not_revisable/.test(e.message));

    await pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`, [EMP_A, req.id, ADM_A]);
    await assert.rejects(reenviar(req.id), (e) => /request_not_revisable/.test(e.message));
  });

  test('081 REVISÃO: relacionamento revogado impede reenvio', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);
    await pool.query(
      `UPDATE public.shipper_carrier_relationships SET status='REVOKED', revoked_at=now() WHERE id=$1`, [REL_AX]);
    await assert.rejects(reenviar(req.id), (e) => /relationship_not_active/.test(e.message));
  });

  test('081 REVISÃO: versão esperada divergente falha em vez de sobrescrever', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);
    // O portal achava que estava na v5; o banco está na v1.
    await assert.rejects(reenviar(req.id, { expected: 5 }), (e) => /request_version_conflict/.test(e.message));
    // Com a versão certa, passa.
    const ok = await reenviar(req.id, { expected: 1 });
    assert.equal(ok.current_submission_version, 2);
  });

  test('081 REVISÃO: usuário de OUTRO embarcador não reenvia solicitação alheia', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);
    // Embarcador Y (mesma transportadora A) tentando reenviar a solicitação do X.
    await assert.rejects(
      pool.query(
        `SELECT * FROM public.shipper_request_revise_and_resubmit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7::jsonb,NULL)`,
        [ORG_Y, req.id, USER_Y, 'Soja', 'Porto', 'ton', JSON.stringify([{ nome: 'F', quantidade: 1 }])],
      ),
      (e) => /request_not_found/.test(e.message),
    );
  });

  test('081 REVISÃO: unidade divergente por origem é recusada (modelo de unidade única mantido)', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);
    await assert.rejects(
      reenviar(req.id, { origins: [{ nome: 'F1', quantidade: 1000, quantity_unit: 'kg' }] }),
      (e) => /origin_unit_mismatch/.test(e.message),
    );
    await assert.rejects(
      reenviar(req.id, { origins: [{ nome: 'F1', quantidade: 0 }] }),
      (e) => /origin_quantity_must_be_positive/.test(e.message),
    );
  });

  // ---- concorrência (§103) ------------------------------------------------

  // Duas conexões reais disputando a MESMA linha. O FOR UPDATE serializa; o
  // teste prova que existe exatamente UM desfecho, não dois.
  async function corrida(sqlA, paramsA, sqlB, paramsB) {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      // A trava a linha primeiro.
      const rA = await a.query(sqlA, paramsA).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
      // B fica bloqueado até A commitar.
      const pB = b.query(sqlB, paramsB).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
      await a.query(rA.ok ? 'COMMIT' : 'ROLLBACK');
      const rB = await pB;
      await b.query(rB.ok ? 'COMMIT' : 'ROLLBACK');
      return { rA, rB };
    } finally {
      a.release(); b.release();
    }
  }

  test('081 CONCORRÊNCIA: reenvio × aceite — só um vence, sem estado híbrido', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);

    const { rA, rB } = await corrida(
      `SELECT * FROM public.shipper_request_revise_and_resubmit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7::jsonb,NULL)`,
      [ORG_X, req.id, USER_X, 'Soja', 'Porto', 'ton', JSON.stringify([{ nome: 'F1', quantidade: 150 }])],
      `SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`,
      [EMP_A, req.id, ADM_A],
    );
    // O reenvio (A) vence porque travou primeiro; o aceite (B) encontra a linha
    // já em SUBMITTED com a v2 — e aceita a v2, não a v1 corrigida.
    assert.equal(rA.ok, true, 'reenvio deve concluir');
    const final = await pool.query(`SELECT status, current_submission_version FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(final.rows[0].current_submission_version, 2);
    if (rB.ok) {
      assert.equal(final.rows[0].status, 'ACCEPTED');
      const dec = await pool.query(
        `SELECT version, decision FROM public.shipper_transport_request_submissions
         WHERE request_id=$1 AND decision='ACCEPTED'`, [req.id]);
      assert.equal(dec.rows.length, 1, 'exatamente uma versao aceita');
      assert.equal(dec.rows[0].version, 2, 'o aceite se refere a versao corrigida, nunca a antiga');
    }
  });

  test('081 CONCORRÊNCIA: reenvio × reenvio — nunca produz duas v2', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);

    const sql = `SELECT * FROM public.shipper_request_revise_and_resubmit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7::jsonb,NULL)`;
    const { rA, rB } = await corrida(
      sql, [ORG_X, req.id, USER_X, 'Soja', 'Porto', 'ton', JSON.stringify([{ nome: 'F1', quantidade: 150 }])],
      sql, [ORG_X, req.id, USER_X, 'Soja', 'Porto', 'ton', JSON.stringify([{ nome: 'F1', quantidade: 200 }])],
    );
    assert.equal(rA.ok, true);
    // B falha: quando destrava, o status já é SUBMITTED (não CHANGES_REQUESTED).
    assert.equal(rB.ok, false, 'o segundo reenvio nao pode passar');
    const { rows } = await pool.query(
      `SELECT version FROM public.shipper_transport_request_submissions WHERE request_id=$1 ORDER BY version`, [req.id]);
    assert.deepEqual(rows.map((r) => r.version), [1, 2], 'exatamente v1 e v2');
  });

  test('081 CONCORRÊNCIA: reenvio × cancelamento — um desfecho terminal só', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pedirAjustes(req.id);

    const { rA, rB } = await corrida(
      `SELECT * FROM public.shipper_request_cancel($1,$2,$3,$4)`,
      [ORG_X, req.id, USER_X, 'Desisti da carga.'],
      `SELECT * FROM public.shipper_request_revise_and_resubmit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7::jsonb,NULL)`,
      [ORG_X, req.id, USER_X, 'Soja', 'Porto', 'ton', JSON.stringify([{ nome: 'F1', quantidade: 150 }])],
    );
    assert.equal(rA.ok, true, 'cancelamento deve concluir');
    assert.equal(rB.ok, false, 'reenvio sobre solicitacao cancelada deve falhar');
    const { rows } = await pool.query(`SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(rows[0].status, 'CANCELLED');
  });

  test('081 CONCORRÊNCIA: rejeitar × aceitar — decisão única (decide agora trava a linha)', async () => {
    await fullSetup();
    const req = await criarSolicitacao();

    const { rA, rB } = await corrida(
      `SELECT * FROM public.shipper_request_decide($1,$2,$3,'REJECTED',$4)`,
      [EMP_A, req.id, ADM_A, 'Sem veiculo disponivel na janela.'],
      `SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`,
      [EMP_A, req.id, ADM_A],
    );
    assert.equal(rA.ok, true);
    assert.equal(rB.ok, false, 'aceitar depois de rejeitar deve falhar, nao sobrescrever');
    const { rows } = await pool.query(
      `SELECT decision FROM public.shipper_transport_request_submissions WHERE request_id=$1`, [req.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decision, 'REJECTED', 'a v1 registra exatamente uma decisao');
  });

  test('081 DECISÃO: motivo é obrigatório e status inválido é recusado', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_decide($1,$2,$3,'REJECTED','  ')`, [EMP_A, req.id, ADM_A]),
      (e) => /decision_reason_required/.test(e.message),
    );
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_decide($1,$2,$3,'ACCEPTED','x')`, [EMP_A, req.id, ADM_A]),
      (e) => /invalid_decision/.test(e.message),
    );
  });

  // ---- ativação de convite ------------------------------------------------

  async function criarConvite({ hash = 'hash-1', orgId = ORG_X, relId = REL_AX, empresaId = EMP_A,
    email = 'novo@embarcador.test', expiraEm = "now() + interval '7 days'", status = 'PENDING' } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO public.shipper_portal_invitations
         (empresa_id, shipper_org_id, relationship_id, email, nome_convidado, token_hash, status, expires_at, created_by)
       VALUES ($1,$2,$3,$4,'Convidado',$5,$6, ${expiraEm}, $7) RETURNING *`,
      [empresaId, orgId, relId, email, hash, status, ADM_A],
    );
    return rows[0];
  }

  test('081 CONVITE: ativação válida cria o usuário no embarcador certo e marca ACCEPTED', async () => {
    await fullSetup();
    await criarConvite({ hash: 'h-ok' });
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_invitation_activate('h-ok',$1,'novo@embarcador.test','Novo Contato')`, [AUTH_NEW]);
    assert.equal(rows[0].id, AUTH_NEW);
    assert.equal(rows[0].shipper_org_id, ORG_X, 'usuario nasce no embarcador do convite');
    assert.equal(rows[0].status, 'active');

    const inv = await pool.query(`SELECT status, accepted_by, accepted_at FROM public.shipper_portal_invitations WHERE token_hash='h-ok'`);
    assert.equal(inv.rows[0].status, 'ACCEPTED');
    assert.equal(inv.rows[0].accepted_by, AUTH_NEW);
    assert.ok(inv.rows[0].accepted_at);
  });

  test('081 CONVITE: replay da mesma ativação converge (não cria segundo usuário)', async () => {
    await fullSetup();
    await criarConvite({ hash: 'h-replay' });
    const a = await pool.query(`SELECT * FROM public.shipper_invitation_activate('h-replay',$1,'novo@embarcador.test','N')`, [AUTH_NEW]);
    const b = await pool.query(`SELECT * FROM public.shipper_invitation_activate('h-replay',$1,'novo@embarcador.test','N')`, [AUTH_NEW]);
    assert.equal(a.rows[0].id, b.rows[0].id, 'mesma identidade');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.shipper_portal_users WHERE id=$1`, [AUTH_NEW]);
    assert.equal(rows[0].n, 1, 'exatamente um usuario de portal');
  });

  test('081 CONVITE: expirado, revogado e já usado por outra pessoa são recusados', async () => {
    await fullSetup();
    await criarConvite({ hash: 'h-exp', expiraEm: "now() - interval '1 day'" });
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('h-exp',$1,'a@b.test','A')`, [AUTH_NEW]),
      (e) => /invitation_expired/.test(e.message));

    await criarConvite({ hash: 'h-rev', status: 'REVOKED', email: 'rev@embarcador.test' });
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('h-rev',$1,'a@b.test','A')`, [AUTH_NEW]),
      (e) => /invitation_not_pending/.test(e.message));

    await criarConvite({ hash: 'h-uso', email: 'uso@embarcador.test' });
    await pool.query(`SELECT * FROM public.shipper_invitation_activate('h-uso',$1,'uso@embarcador.test','U')`, [AUTH_NEW]);
    // Outra identidade tentando reaproveitar o mesmo convite.
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('h-uso',$1,'outro@embarcador.test','O')`, [AUTH_NEW2]),
      (e) => /invitation_already_used/.test(e.message));
  });

  test('081 CONVITE: identidade de OUTRO embarcador não ativa convite alheio', async () => {
    await fullSetup();
    await criarConvite({ hash: 'h-cross' });
    // USER_Y já existe e pertence ao embarcador Y; o convite é do X.
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('h-cross',$1,'y@embarcador.test','Y')`, [USER_Y]),
      (e) => /portal_user_other_org/.test(e.message));
  });

  test('081 CONVITE: token inexistente e relacionamento revogado são recusados', async () => {
    await fullSetup();
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('nao-existe',$1,'a@b.test','A')`, [AUTH_NEW]),
      (e) => /invitation_not_found/.test(e.message));

    await criarConvite({ hash: 'h-relrev' });
    await pool.query(`UPDATE public.shipper_carrier_relationships SET status='REVOKED', revoked_at=now() WHERE id=$1`, [REL_AX]);
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_invitation_activate('h-relrev',$1,'a@b.test','A')`, [AUTH_NEW]),
      (e) => /relationship_not_active/.test(e.message));
  });

  test('081 CONVITE CONCORRÊNCIA: duas ativações simultâneas do mesmo token → um único usuário', async () => {
    await fullSetup();
    await criarConvite({ hash: 'h-race' });
    const { rA, rB } = await corrida(
      `SELECT * FROM public.shipper_invitation_activate('h-race',$1,'novo@embarcador.test','A')`, [AUTH_NEW],
      `SELECT * FROM public.shipper_invitation_activate('h-race',$1,'outro@embarcador.test','B')`, [AUTH_NEW2],
    );
    assert.equal(rA.ok, true, 'a primeira ativacao conclui');
    assert.equal(rB.ok, false, 'a segunda identidade nao pode reaproveitar o convite');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_portal_users WHERE id IN ($1,$2)`, [AUTH_NEW, AUTH_NEW2]);
    assert.equal(rows[0].n, 1, 'exatamente um usuario de portal foi criado');
  });

  // ---- documentos e compartilhamento --------------------------------------

  // ---- documentos e compartilhamento --------------------------------------

  test('081 DOCUMENTO: documento da solicitação exige autor do MESMO embarcador', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    // Autor do embarcador Y num documento da solicitação do X.
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_request_documents
           (request_id, empresa_id, shipper_org_id, nome_documento, storage_path, enviado_por)
         VALUES ($1,$2,$3,'Nota','portal/x/1.pdf',$4)`,
        [req.id, EMP_A, ORG_X, USER_Y],
      ),
      (e) => e.code === '23503',
    );
    // Autor correto passa.
    await pool.query(
      `INSERT INTO public.shipper_request_documents
         (request_id, empresa_id, shipper_org_id, nome_documento, storage_path, enviado_por)
       VALUES ($1,$2,$3,'Nota','portal/x/1.pdf',$4)`,
      [req.id, EMP_A, ORG_X, USER_X],
    );
  });

  test('081 DOCUMENTO: solicitação de OUTRO embarcador não aceita documento (HIGH-02 §13)', async () => {
    await fullSetup();
    // Solicitação do embarcador Y, mas declarando shipper_org_id = X e autor X.
    const reqY = await pool.query(
      `INSERT INTO public.shipper_transport_requests
         (empresa_id, shipper_org_id, relationship_id, reference_code, status, cargo_name,
          destination_name, quantity_unit, created_by, submitted_at, submitted_snapshot)
       VALUES ($1,$2,$3,'REQ-Y','SUBMITTED','Soja','Porto','ton',$4, now(), '{"t":1}'::jsonb)
       RETURNING id`, [EMP_A, ORG_Y, REL_AY, USER_Y]);

    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_request_documents
           (request_id, empresa_id, shipper_org_id, nome_documento, storage_path, enviado_por)
         VALUES ($1,$2,$3,'Nota','portal/cross.pdf',$4)`,
        [reqY.rows[0].id, EMP_A, ORG_X, USER_X],
      ),
      (e) => e.code === '23503',
    );
  });

  // ---- HIGH-02: proveniência COMPLETA do compartilhamento -----------------
  //
  // Estes testes montam duas operações REAIS e completas dentro da MESMA
  // transportadora (embarcador X e embarcador Y), cada uma com campanha, plano,
  // viagem, frete, documento e evidência próprios. Sem fixture real não há como
  // provar que o banco recusa a combinação errada — por isso nada aqui é
  // pulado condicionalmente (§66): se a fixture falhar, o teste falha.

  const UNIT_A = '08100000-0000-4000-a000-000000000601';
  const DRIVER_A = '08100000-0000-4000-a000-000000000602';

  // Cria uma operação inteira ligada a uma solicitação já aceita.
  async function montarOperacao({ sufixo, orgId, relId, portalUserId, empresaId = EMP_A, unitId = UNIT_A }) {
    const id = (n) => `08100000-0000-4000-a${sufixo}-0000000009${n}`;
    const CAMP = id('01'); const PLAN = id('02'); const SCEN = id('03');
    const ORIGIN = id('04'); const DEST = id('05'); const DEMAND = id('06');
    const TRIP = id('07'); const FRETE = id('08'); const DOC = id('09'); const EPOD = id('10');
    const EVID = id('11');

    await pool.query(
      `INSERT INTO public.operation_campaigns (id, empresa_id, reference_code, name, cargo_name, status, planning_status, created_by, approved_plan_version_id)
       VALUES ($1,$2,$3,'Campanha','Soja','APPROVED','APPROVED',$4,NULL)`,
      [CAMP, empresaId, `CAMP-${sufixo}`, ADM_A]);
    await pool.query(
      `INSERT INTO public.campaign_operational_units (empresa_id, campaign_id, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [empresaId, CAMP, unitId, ADM_A]);
    await pool.query(
      `INSERT INTO public.campaign_locations (id, empresa_id, campaign_id, kind, name, unidade_operacional_id, created_by)
       VALUES ($1,$2,$3,'origin','Origem',$5,$4),($6,$2,$3,'destination','Destino',$5,$4)`,
      [ORIGIN, empresaId, CAMP, ADM_A, unitId, DEST]);
    await pool.query(
      `INSERT INTO public.campaign_demands (id, empresa_id, campaign_id, origin_location_id, destination_location_id, cargo_name, target_quantity, quantity_unit, created_by)
       VALUES ($1,$2,$3,$4,$5,'Soja',100,'ton',$6)`,
      [DEMAND, empresaId, CAMP, ORIGIN, DEST, ADM_A]);
    await pool.query(
      `INSERT INTO public.campaign_plan_versions (id, empresa_id, campaign_id, version_number, status, rules_version, generated_by, approved_by, approved_at)
       VALUES ($1,$2,$3,1,'APPROVED','081.test',$4,$4,now())`,
      [PLAN, empresaId, CAMP, ADM_A]);
    await pool.query(
      `UPDATE public.operation_campaigns SET approved_plan_version_id=$1 WHERE id=$2`, [PLAN, CAMP]);
    // Sem `.catch` silencioso (§66): se a fixture não puder ser montada, o
    // teste tem que falhar — não passar sem provar nada.
    await pool.query(
      `INSERT INTO public.campaign_plan_scenarios
         (id, empresa_id, campaign_id, plan_version_id, scenario_key, label)
       VALUES ($1,$2,$3,$4,'base','Cenário base')`, [SCEN, empresaId, CAMP, PLAN]);
    await pool.query(
      `INSERT INTO public.campaign_planned_trips
         (id, empresa_id, campaign_id, plan_version_id, scenario_id, origin_location_id, destination_location_id,
          demand_id, planned_quantity, quantity_unit, required_capacity_kg, candidate_driver_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100,'ton',10000,$9)`,
      [TRIP, empresaId, CAMP, PLAN, SCEN, ORIGIN, DEST, DEMAND, DRIVER_A]);
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data)
       VALUES ($1,$2,$3,'finalizado',now())`, [FRETE, empresaId, DRIVER_A]);
    await pool.query(
      `INSERT INTO public.campaign_trip_freights
         (empresa_id, campaign_id, plan_version_id, planned_trip_id, frete_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`, [empresaId, CAMP, PLAN, TRIP, FRETE, ADM_A]);
    await pool.query(
      `INSERT INTO public.frete_documentos (id, frete_id, empresa_id, tipo, storage_path, criado_por)
       VALUES ($1,$2,$3,'cte',$4,$5)`, [DOC, FRETE, empresaId, `f/${sufixo}/doc.pdf`, ADM_A]);
    await pool.query(
      `INSERT INTO public.frete_epod (id, frete_id, empresa_id, status, criado_por)
       VALUES ($1,$2,$3,'validado',$4)`, [EPOD, FRETE, empresaId, ADM_A]);
    await pool.query(
      `INSERT INTO public.frete_epod_evidencias (id, epod_id, frete_id, empresa_id, storage_path, status, criado_por)
       VALUES ($1,$2,$3,$4,$5,'aprovada',$6)`,
      [EVID, EPOD, FRETE, empresaId, `e/${sufixo}/1.jpg`, ADM_A]);

    // Solicitação aceita e vinculada a esta campanha.
    const reqRes = await pool.query(
      `INSERT INTO public.shipper_transport_requests
         (empresa_id, shipper_org_id, relationship_id, reference_code, status, cargo_name,
          destination_name, quantity_unit, created_by, submitted_at, submitted_snapshot,
          accepted_snapshot, campaign_id, current_submission_version)
       VALUES ($1,$2,$3,$4,'ACCEPTED','Soja','Porto','ton',$5, now(), '{"t":1}'::jsonb,
               '{"t":1}'::jsonb, $6, 1) RETURNING id`,
      [empresaId, orgId, relId, `SOL-${sufixo}`, portalUserId, CAMP]);

    return { CAMP, PLAN, TRIP, FRETE, DOC, EVID, requestId: reqRes.rows[0].id, relId, orgId, empresaId };
  }

  async function setupDuasOperacoes() {
    await fullSetup();
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade A','ativo',true) ON CONFLICT (id) DO NOTHING`, [UNIT_A, EMP_A]);
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'motorista','ativo',false,'Driver A') ON CONFLICT (id) DO NOTHING`, [DRIVER_A, EMP_A]);
    const x = await montarOperacao({ sufixo: '001', orgId: ORG_X, relId: REL_AX, portalUserId: USER_X });
    const y = await montarOperacao({ sufixo: '002', orgId: ORG_Y, relId: REL_AY, portalUserId: USER_Y });
    return { x, y };
  }

  function inserirShare(o, over = {}) {
    const v = {
      empresa_id: o.empresaId, shipper_org_id: o.orgId, relationship_id: o.relId,
      request_id: o.requestId, campaign_id: o.CAMP, frete_id: o.FRETE,
      source_kind: 'FRETE_DOCUMENTO', frete_documento_id: o.DOC, epod_evidencia_id: null,
      titulo: 'CT-e', ...over,
    };
    return pool.query(
      `INSERT INTO public.shipper_document_shares
         (empresa_id, shipper_org_id, relationship_id, request_id, campaign_id, frete_id,
          source_kind, frete_documento_id, epod_evidencia_id, titulo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.empresa_id, v.shipper_org_id, v.relationship_id, v.request_id, v.campaign_id, v.frete_id,
        v.source_kind, v.frete_documento_id, v.epod_evidencia_id, v.titulo],
    );
  }

  test('081 PROVENIÊNCIA: compartilhamento coerente é aceito', async () => {
    const { x } = await setupDuasOperacoes();
    const r = await inserirShare(x);
    assert.ok(r.rows[0].id);
  });

  test('081 PROVENIÊNCIA: documento do embarcador Y na solicitação do X é REJEITADO pelo banco', async () => {
    // O caso central do HIGH-02: mesma transportadora, dois embarcadores.
    // A aplicação já recusa; aqui provamos que o BANCO recusa sozinho.
    const { x, y } = await setupDuasOperacoes();
    await assert.rejects(
      inserirShare(x, { frete_documento_id: y.DOC }),
      (e) => e.code === '23503',
    );
    // Nem trocando o frete junto, porque o frete de Y não pertence à campanha de X.
    await assert.rejects(
      inserirShare(x, { frete_documento_id: y.DOC, frete_id: y.FRETE }),
      (e) => e.code === '23503',
    );
  });

  test('081 PROVENIÊNCIA: frete de OUTRA campanha é REJEITADO', async () => {
    const { x, y } = await setupDuasOperacoes();
    // Campanha de X com frete da campanha de Y.
    await assert.rejects(
      inserirShare(x, { frete_id: y.FRETE, frete_documento_id: y.DOC }),
      (e) => e.code === '23503',
    );
    // E campanha de Y declarada numa solicitação de X.
    await assert.rejects(
      inserirShare(x, { campaign_id: y.CAMP }),
      (e) => e.code === '23503',
    );
  });

  test('081 PROVENIÊNCIA: documento de OUTRA transportadora é REJEITADO', async () => {
    const { x } = await setupDuasOperacoes();
    await pool.query(
      `INSERT INTO public.unidades_operacionais (id, empresa_id, nome, status, is_default)
       VALUES ($1,$2,'Unidade B','ativo',true) ON CONFLICT (id) DO NOTHING`,
      ['08100000-0000-4000-a000-000000000701', EMP_B]);
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin, nome)
       VALUES ($1,$2,'motorista','ativo',false,'Driver B') ON CONFLICT (id) DO NOTHING`,
      ['08100000-0000-4000-a000-000000000702', EMP_B]);
    const freteB = '08100000-0000-4000-a000-000000000703';
    const docB = '08100000-0000-4000-a000-000000000704';
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status, data)
       VALUES ($1,$2,$3,'finalizado',now())`, [freteB, EMP_B, '08100000-0000-4000-a000-000000000702']);
    await pool.query(
      `INSERT INTO public.frete_documentos (id, frete_id, empresa_id, tipo, storage_path, criado_por)
       VALUES ($1,$2,$3,'cte','b/doc.pdf',$4)`, [docB, freteB, EMP_B, ADM_B]);

    await assert.rejects(
      inserirShare(x, { frete_documento_id: docB, frete_id: freteB }),
      (e) => e.code === '23503',
    );
  });

  test('081 PROVENIÊNCIA: evidência de ePOD segue a mesma cadeia', async () => {
    const { x, y } = await setupDuasOperacoes();
    // Coerente passa.
    const ok = await inserirShare(x, {
      source_kind: 'EPOD_EVIDENCIA', frete_documento_id: null, epod_evidencia_id: x.EVID, titulo: 'Comprovante',
    });
    assert.ok(ok.rows[0].id);
    // Evidência do outro embarcador não.
    await assert.rejects(
      inserirShare(x, {
        source_kind: 'EPOD_EVIDENCIA', frete_documento_id: null, epod_evidencia_id: y.EVID, titulo: 'Comprovante',
      }),
      (e) => e.code === '23503',
    );
  });

  test('081 PROVENIÊNCIA: compartilhamento sem solicitação é impossível', async () => {
    const { x } = await setupDuasOperacoes();
    await assert.rejects(
      pool.query(
        `INSERT INTO public.shipper_document_shares
           (empresa_id, shipper_org_id, relationship_id, campaign_id, frete_id, source_kind, frete_documento_id, titulo)
         VALUES ($1,$2,$3,$4,$5,'FRETE_DOCUMENTO',$6,'CT-e')`,
        [x.empresaId, x.orgId, x.relId, x.CAMP, x.FRETE, x.DOC]),
      (e) => e.code === '23502', // NOT NULL de request_id
    );
  });

  test('081 COMPARTILHAMENTO: exige exatamente uma origem coerente com source_kind', async () => {
    const { x } = await setupDuasOperacoes();
    // Nenhuma origem preenchida.
    await assert.rejects(
      inserirShare(x, { frete_documento_id: null, epod_evidencia_id: null }),
      (e) => e.code === '23514');
    // Duas origens ao mesmo tempo.
    await assert.rejects(
      inserirShare(x, { epod_evidencia_id: x.EVID }),
      (e) => e.code === '23514');
  });

  test('081 COMPARTILHAMENTO: revogar libera novo compartilhamento do mesmo objeto', async () => {
    const { x } = await setupDuasOperacoes();
    const primeiro = await inserirShare(x);
    // Segundo compartilhamento ATIVO do mesmo objeto: barrado.
    await assert.rejects(inserirShare(x), (e) => e.code === '23505');

    await pool.query(
      `UPDATE public.shipper_document_shares SET status='REVOKED', revoked_at=now() WHERE id=$1`,
      [primeiro.rows[0].id]);
    // Depois de revogar, recompartilhar é possível — e o histórico fica.
    await inserirShare(x);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.shipper_document_shares WHERE frete_documento_id=$1`, [x.DOC]);
    assert.equal(rows[0].n, 2, 'compartilhamento revogado permanece como historico');
  });

  // ---- HIGH-03: imutabilidade do histórico e autoridade do snapshot -------

  test('081 IMUTABILIDADE: snapshot de uma submissão não pode ser alterado', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET snapshot = '{"total_quantidade": 999}'::jsonb WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_history_immutable/.test(e.message),
    );
  });

  test('081 IMUTABILIDADE: versão, autoria e instante de envio são congelados', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    for (const sql of [
      `UPDATE public.shipper_transport_request_submissions SET version = 9 WHERE request_id=$1`,
      `UPDATE public.shipper_transport_request_submissions SET submitted_by = NULL WHERE request_id=$1`,
      `UPDATE public.shipper_transport_request_submissions SET submitted_at = now() - interval '5 days' WHERE request_id=$1`,
      `UPDATE public.shipper_transport_request_submissions SET request_id = gen_random_uuid() WHERE request_id=$1`,
    ]) {
      await assert.rejects(pool.query(sql, [req.id]), (e) => /submission_history_immutable/.test(e.message));
    }
  });

  test('081 IMUTABILIDADE: DELETE de submissão é proibido', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(`DELETE FROM public.shipper_transport_request_submissions WHERE request_id=$1`, [req.id]),
      (e) => /submission_history_delete_forbidden/.test(e.message),
    );
  });

  test('081 IMUTABILIDADE: a decisão é de mão única — não se troca ACCEPTED por REJECTED', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`, [EMP_A, req.id, ADM_A]);

    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision='REJECTED' WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_already_final/.test(e.message),
    );
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision_reason='outro motivo' WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_already_final/.test(e.message),
    );
  });

  test('081 IMUTABILIDADE: a PRIMEIRA decisão é permitida e precisa ser datada', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    // NULL -> CHANGES_REQUESTED com instante: permitido.
    await pool.query(
      `UPDATE public.shipper_transport_request_submissions
       SET decision='CHANGES_REQUESTED', decided_at=now() WHERE request_id=$1 AND version=1`, [req.id]);
    const { rows } = await pool.query(
      `SELECT decision FROM public.shipper_transport_request_submissions WHERE request_id=$1`, [req.id]);
    assert.equal(rows[0].decision, 'CHANGES_REQUESTED');
  });

  test('081 IMUTABILIDADE: decisão sem instante é recusada', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision='ACCEPTED' WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_requires_timestamp|shipper_transport_request_submissions_check/.test(e.message),
    );
  });

  // ---- RESIDUAL-02: metadados de decisão não existem sem decisão ----------
  //
  // O gatilho protegia a decisão já finalizada, mas deixava uma janela: com
  // `decision IS NULL`, os campos de metadado podiam ser escritos e reescritos
  // livremente. Daria para gravar "decidido por Fulano em tal data" numa
  // submissão que ninguém decidiu.

  test('081 METADADO: decision_reason sem decisão é REJEITADO', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision_reason='motivo fantasma' WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_metadata_without_decision/.test(e.message),
    );
  });

  test('081 METADADO: decided_at sem decisão é REJEITADO', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decided_at=now() WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_metadata_without_decision|shipper_transport_request_submissions_check/.test(e.message),
    );
  });

  test('081 METADADO: decided_by sem decisão é REJEITADO', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decided_by=$2 WHERE request_id=$1 AND version=1`, [req.id, ADM_A]),
      (e) => /submission_decision_metadata_without_decision/.test(e.message),
    );
  });

  test('081 METADADO: REJECTED sem motivo é REJEITADO', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision='REJECTED', decided_at=now(), decided_by=$2
         WHERE request_id=$1 AND version=1`, [req.id, ADM_A]),
      (e) => /submission_decision_requires_reason/.test(e.message),
    );
  });

  test('081 METADADO: CHANGES_REQUESTED com motivo em branco é REJEITADO', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision='CHANGES_REQUESTED', decision_reason='   ', decided_at=now(), decided_by=$2
         WHERE request_id=$1 AND version=1`, [req.id, ADM_A]),
      (e) => /submission_decision_requires_reason/.test(e.message),
    );
  });

  test('081 METADADO: decisão sem AUTOR é REJEITADA', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(
        `UPDATE public.shipper_transport_request_submissions
         SET decision='ACCEPTED', decided_at=now() WHERE request_id=$1 AND version=1`, [req.id]),
      (e) => /submission_decision_requires_actor/.test(e.message),
    );
  });

  test('081 METADADO: ACCEPTED com instante e autor passa — e motivo continua opcional', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pool.query(
      `UPDATE public.shipper_transport_request_submissions
       SET decision='ACCEPTED', decided_at=now(), decided_by=$2
       WHERE request_id=$1 AND version=1`, [req.id, ADM_A]);
    const { rows } = await pool.query(
      `SELECT decision, decision_reason FROM public.shipper_transport_request_submissions
       WHERE request_id=$1 AND version=1`, [req.id]);
    assert.equal(rows[0].decision, 'ACCEPTED');
    assert.equal(rows[0].decision_reason, null, 'aceite não inventa motivo');
  });

  test('081 METADADO: REJECTED completo passa, e depois fica congelado', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pool.query(
      `UPDATE public.shipper_transport_request_submissions
       SET decision='REJECTED', decision_reason='Sem veículo', decided_at=now(), decided_by=$2
       WHERE request_id=$1 AND version=1`, [req.id, ADM_A]);

    // Congelado depois: nem autor, nem motivo, nem instante.
    for (const sql of [
      `UPDATE public.shipper_transport_request_submissions SET decided_by=NULL WHERE request_id=$1`,
      `UPDATE public.shipper_transport_request_submissions SET decision_reason='outro' WHERE request_id=$1`,
      `UPDATE public.shipper_transport_request_submissions SET decided_at=now() + interval '1 day' WHERE request_id=$1`,
    ]) {
      await assert.rejects(pool.query(sql, [req.id]), (e) => /submission_decision_already_final/.test(e.message));
    }
  });

  test('081 METADADO: RPC de decisão sem autor falha com erro próprio', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_decide($1,$2,NULL,'REJECTED','motivo')`, [EMP_A, req.id]),
      (e) => /decision_actor_required/.test(e.message),
    );
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,NULL,NULL)`, [EMP_A, req.id]),
      (e) => /decision_actor_required/.test(e.message),
    );
  });

  test('081 SNAPSHOT: aceite IGNORA o snapshot fornecido e usa o que está gravado', async () => {
    // O teste do §34: o envio real foi 100; a chamada tenta declarar 999.
    await fullSetup();
    const req = await criarSolicitacao({ origins: [{ nome: 'Fazenda 1', quantidade: 100 }] });
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_accept($1,$2,$3,'{"total_quantidade": 999}'::jsonb)`,
      [EMP_A, req.id, ADM_A]);

    assert.equal(Number(rows[0].accepted_snapshot.total_quantidade), 100,
      'o snapshot aceito precisa ser o que o embarcador enviou, nunca o que a chamada declarou');
    assert.notEqual(Number(rows[0].accepted_snapshot.total_quantidade), 999);
  });

  test('081 SNAPSHOT: aceite usa a versão CORRENTE após reenvio', async () => {
    await fullSetup();
    const req = await criarSolicitacao({ origins: [{ nome: 'Fazenda 1', quantidade: 100 }] });
    await pedirAjustes(req.id);
    await reenviar(req.id, { origins: [{ nome: 'Fazenda 1', quantidade: 150 }] });
    const { rows } = await pool.query(
      `SELECT * FROM public.shipper_request_accept($1,$2,$3,'{"total_quantidade": 1}'::jsonb)`,
      [EMP_A, req.id, ADM_A]);
    assert.equal(Number(rows[0].accepted_snapshot.total_quantidade), 150, 'usa a v2, não a v1 nem o valor fornecido');
  });

  test('081 CARIMBO: decisão sem versão corrente correspondente falha fechada', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    // Aponta a solicitação para uma versão que não existe no histórico.
    await pool.query(
      `UPDATE public.shipper_transport_requests SET current_submission_version = 7 WHERE id=$1`, [req.id]);
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_accept($1,$2,$3,NULL)`, [EMP_A, req.id, ADM_A]),
      (e) => /current_submission_missing/.test(e.message),
    );
    // A solicitação NÃO pode ter ficado aceita.
    const { rows } = await pool.query(`SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(rows[0].status, 'SUBMITTED');
  });

  test('081 CARIMBO: rejeitar também exige carimbar exatamente uma versão', async () => {
    await fullSetup();
    const req = await criarSolicitacao();
    await pool.query(
      `UPDATE public.shipper_transport_requests SET current_submission_version = 7 WHERE id=$1`, [req.id]);
    await assert.rejects(
      pool.query(`SELECT * FROM public.shipper_request_decide($1,$2,$3,'REJECTED','motivo')`, [EMP_A, req.id, ADM_A]),
      (e) => /submission_decision_stamp_failed/.test(e.message),
    );
    const { rows } = await pool.query(`SELECT status FROM public.shipper_transport_requests WHERE id=$1`, [req.id]);
    assert.equal(rows[0].status, 'SUBMITTED', 'sem evidência carimbada, o estado não muda');
  });

  // ---- permissões ---------------------------------------------------------

  test('081 PERMISSÃO: operador NÃO recebe compartilhamento de documento por padrão', async () => {
    await fullSetup();
    const { rows: tpls } = await pool.query(
      `SELECT stable_key, count(*)::int AS n
       FROM public.permission_templates t
       JOIN public.permission_template_permissions p ON p.template_id = t.id
       WHERE t.empresa_id=$1 AND p.permission_key = 'shipper_portal.documents.share'
       GROUP BY stable_key`, [EMP_A]);
    const mapa = Object.fromEntries(tpls.map((r) => [r.stable_key, r.n]));
    assert.equal(mapa.operador || 0, 0, 'operador nao pode compartilhar documento por padrao');
    // administrador/gerente recebem se os templates existirem nesta base de teste.
    for (const k of Object.keys(mapa)) {
      assert.ok(['administrador', 'gerente_frota'].includes(k), `template inesperado com a permissao: ${k}`);
    }
  });

  test('081 BACKFILL: solicitação pré-existente ganha versão 1 e ponteiro coerente', async () => {
    await fullSetup();
    // Simula uma solicitação criada ANTES da 081 (sem histórico), aplicando o
    // trecho de backfill de novo — ele é idempotente por construção.
    await pool.query(
      `INSERT INTO public.shipper_transport_requests
         (id, empresa_id, shipper_org_id, relationship_id, reference_code, status, cargo_name,
          destination_name, quantity_unit, created_by, submitted_at, submitted_snapshot, current_submission_version)
       VALUES (gen_random_uuid(),$1,$2,$3,'LEGADO','SUBMITTED','Milho','Porto','ton',$4, now(),
               '{"total_quantidade": 42}'::jsonb, 0)`,
      [EMP_A, ORG_X, REL_AX, USER_X]);

    await pool.query(`
      INSERT INTO public.shipper_transport_request_submissions
        (request_id, empresa_id, shipper_org_id, version, snapshot, submitted_at, submitted_by)
      SELECT r.id, r.empresa_id, r.shipper_org_id, 1, r.submitted_snapshot,
             COALESCE(r.submitted_at, r.created_at), r.created_by
      FROM public.shipper_transport_requests r
      WHERE r.submitted_snapshot IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.shipper_transport_request_submissions s WHERE s.request_id = r.id)`);
    await pool.query(`UPDATE public.shipper_transport_requests SET current_submission_version = 1
      WHERE submitted_snapshot IS NOT NULL AND current_submission_version = 0`);

    const { rows } = await pool.query(
      `SELECT r.current_submission_version, count(s.id)::int AS versoes
       FROM public.shipper_transport_requests r
       LEFT JOIN public.shipper_transport_request_submissions s ON s.request_id = r.id
       WHERE r.reference_code='LEGADO' GROUP BY r.current_submission_version`);
    assert.equal(rows[0].current_submission_version, 1);
    assert.equal(rows[0].versoes, 1);
  });

  after(async () => { await pool.end(); });
}

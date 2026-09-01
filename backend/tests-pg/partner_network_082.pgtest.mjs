// Partner Network V1 (E3.6A) — invariantes REAIS no Postgres.
//
// O que estes testes protegem não é o schema, é a fronteira: que um parceiro
// nunca entre no tenant de quem o convidou, que ninguém enumere a rede alheia, e
// que um snapshot compartilhado não possa ser reescrito depois de enviado.
//
// Vários destes invariantes são de BANCO de propósito (FK composta, trigger).
// Checagem de aplicação sozinha não segura invariante cross-tenant: basta um id
// trocado no corpo da requisição.
//
// Nunca roda contra produção: exige DATABASE_URL do Postgres efêmero da CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('partner network 082 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 082 nao pode ser pulado');
    });
  } else {
    test('partner network 082 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
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

  // Fase 1: o bootstrap cria as tabelas base, incluindo `usuarios`.
  const bootstrap = [
    pgHarness('00_bootstrap_pre.sql'),
  ];

  // Fase 2 (depois dos helpers): o resto da cadeia, cujas policies chamam
  // `rls_is_super_admin()` no momento em que a POLICY é criada.
  const cadeia = [
    migration('060_catalogo_funcionalidades.sql'),
    migration('061_matriz_publicacao_transacional.sql'),
    pgHarness('99_grants_service_role_test.sql'),
    migration('058_fluxo_comercial_v2.sql'),
    migration('062_auth_sessions_revogaveis.sql'),
    migration('064_frete_tracking_credenciais.sql'),
    migration('065_fretes_financeiro_auditoria.sql'),
    migration('066_billing_outbox.sql'),
    migration('067_grupos_filiais_escopos_operacionais.sql'),
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
  ];

  // A migration sob teste, aplicada por último — depois de existirem os
  // templates que o DML dela precisa encontrar.
  const migrationAlvo = [
    migration('082_partner_network_foundation.sql'),
  ];

  // As migrations da cadeia (073/074/076/078/079) criam policies que chamam os
  // helpers de RLS definidos na migration 015, que não faz parte desta cadeia.
  // Mesmo padrão do teste do Dispatch 079: instalar os stubs antes de aplicar.
  async function instalarHelpersDeAuth() {
    await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
    await pool.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT COALESCE((SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_empresa_id()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;
    `);
  }

  // Empresa e templates que já existiam antes da 082 — é o estado real que a
  // migration encontra em produção, e sem ele o DML de permissões não teria o
  // que popular.
  const EMPRESA_PRE = '11111111-1111-4111-8111-111111111111';

  async function semearTemplatesBaseline() {
    await pool.query(
      `INSERT INTO empresas (id, nome, status) VALUES ($1, 'Empresa Pré-082', 'ativo')
       ON CONFLICT (id) DO NOTHING`, [EMPRESA_PRE]);
    for (const chave of ['administrador', 'gerente_frota', 'operador']) {
      await pool.query(
        `INSERT INTO permission_templates (empresa_id, stable_key, display_name, is_system_baseline, editable)
         VALUES ($1, $2, $2, true, true)
         ON CONFLICT DO NOTHING`, [EMPRESA_PRE, chave]);
    }
  }

  let preparado = false;
  async function preparar() {
    if (preparado) return;
    for (const sql of bootstrap) await pool.query(sql);
    await instalarHelpersDeAuth();
    for (const sql of cadeia) await pool.query(sql);
    await semearTemplatesBaseline();
    for (const sql of migrationAlvo) await pool.query(sql);
    preparado = true;
  }

  // Cenário determinístico: duas transportadoras (A e B) e um parceiro de cada.
  async function cenario() {
    await preparar();
    const id = () => pool.query('SELECT gen_random_uuid() AS id').then((r) => r.rows[0].id);

    const empresaA = await id();
    const empresaB = await id();
    for (const [eid, nome] of [[empresaA, 'Transportadora A'], [empresaB, 'Transportadora B']]) {
      await pool.query(
        `INSERT INTO empresas (id, nome, status) VALUES ($1,$2,'ativo')
         ON CONFLICT (id) DO NOTHING`, [eid, nome],
      );
    }

    const orgA = (await pool.query(
      `INSERT INTO partner_organizations (nome, criado_por_empresa_id) VALUES ('Parceiro da A', $1) RETURNING id`,
      [empresaA])).rows[0].id;
    const orgB = (await pool.query(
      `INSERT INTO partner_organizations (nome, criado_por_empresa_id) VALUES ('Parceiro da B', $1) RETURNING id`,
      [empresaB])).rows[0].id;

    const relA = (await pool.query(
      `INSERT INTO partner_relationships (empresa_id, partner_organization_id, status)
       VALUES ($1,$2,'ACTIVE') RETURNING id`, [empresaA, orgA])).rows[0].id;
    const relB = (await pool.query(
      `INSERT INTO partner_relationships (empresa_id, partner_organization_id, status)
       VALUES ($1,$2,'ACTIVE') RETURNING id`, [empresaB, orgB])).rows[0].id;

    const campanhaA = (await pool.query(
      `INSERT INTO operation_campaigns (empresa_id, reference_code, name, cargo_name, status)
       VALUES ($1, 'CAMP-A-' || substr(md5(random()::text),1,8), 'Safra A', 'Soja', 'APPROVED')
       RETURNING id`, [empresaA])).rows[0].id;

    // `plan_version_id` é NOT NULL: sem plano aprovado não existe residual
    // canônico nem como provar depois qual fonte gerou o número.
    const planoA = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,1,'APPROVED','v1') RETURNING id`, [empresaA, campanhaA])).rows[0].id;
    await pool.query(
      'UPDATE operation_campaigns SET approved_plan_version_id = $2 WHERE id = $1', [campanhaA, planoA]);

    const campanhaB = (await pool.query(
      `INSERT INTO operation_campaigns (empresa_id, reference_code, name, cargo_name, status)
       VALUES ($1, 'CAMP-B-' || substr(md5(random()::text),1,8), 'Safra B', 'Milho', 'APPROVED')
       RETURNING id`, [empresaB])).rows[0].id;
    const planoB = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,1,'APPROVED','v1') RETURNING id`, [empresaB, campanhaB])).rows[0].id;

    const oportA = (await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
       VALUES ($1,$2,$3,'Soja a granel', 500, 'ton') RETURNING id`,
      [empresaA, campanhaA, planoA])).rows[0].id;

    // §9 — ATORES REAIS. `p_partner_user_id` deixou de ser um rótulo livre de
    // auditoria: a RPC exige um usuário existente, ATIVO e da MESMA organização.
    // Passar `null` (como os testes faziam) agora é recusado, e é esse o ponto:
    // um autor forjável tornaria a auditoria decorativa.
    const userA = (await pool.query(
      `INSERT INTO partner_portal_users (partner_organization_id, email, status)
       VALUES ($1, 'user-a@exemplo.invalid', 'ATIVO') RETURNING id`, [orgA])).rows[0].id;
    const userB = (await pool.query(
      `INSERT INTO partner_portal_users (partner_organization_id, email, status)
       VALUES ($1, 'user-b@exemplo.invalid', 'ATIVO') RETURNING id`, [orgB])).rows[0].id;

    return {
      empresaA, empresaB, orgA, orgB, relA, relB,
      campanhaA, planoA, campanhaB, planoB, oportA, userA, userB,
    };
  }

  // ── Tenant / IDOR ────────────────────────────────────────────────────────────

  test('082: destinatário não pode ligar oportunidade de A a relacionamento de B', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_recipients
           (opportunity_id, empresa_id, relationship_id, partner_organization_id)
         VALUES ($1,$2,$3,$4)`,
        [c.oportA, c.empresaA, c.relB, c.orgB],
      ),
      /partner_recipients_relationship_boundary_fk|violates foreign key/i,
      'FK composta precisa barrar relacionamento de outro tenant',
    );
  });

  test('082: destinatário não pode declarar empresa diferente da oportunidade', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_recipients
           (opportunity_id, empresa_id, relationship_id, partner_organization_id)
         VALUES ($1,$2,$3,$4)`,
        [c.oportA, c.empresaB, c.relB, c.orgB],
      ),
      /boundary_fk|violates foreign key/i,
    );
  });

  test('082: resposta não pode apontar para destinatário de outra empresa', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_responses
           (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
         VALUES ($1,$2,$3,1,'AVAILABLE',100,'ton')`,
        [rec, c.empresaB, c.oportA],
      ),
      /boundary_fk|violates foreign key/i,
    );
  });

  test('082: convite não pode pertencer a relacionamento de outro tenant', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
         VALUES ($1,$2,'x@exemplo.invalid','hash-x', now() + interval '7 days')`,
        [c.relB, c.empresaA],
      ),
      /boundary_fk|violates foreign key/i,
    );
  });

  // ── Identidade externa nunca é do tenant ─────────────────────────────────────

  test('082: identidade de parceiro NÃO tem coluna empresa_id', async () => {
    await preparar();
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='partner_portal_users'`,
    );
    const colunas = rows.map((r) => r.column_name);
    assert.ok(!colunas.includes('empresa_id'),
      'identidade externa com empresa_id herdaria o tenant inteiro via middlewares/tenant.js');
    assert.ok(colunas.includes('partner_organization_id'));
  });

  test('082: organização parceira não pode se vincular à empresa que a cadastrou', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_organizations (nome, criado_por_empresa_id, linked_empresa_id)
         VALUES ('Auto-parceiro', $1, $1)`, [c.empresaA],
      ),
      /partner_org_nao_e_o_proprio_criador/i,
      'auto-vínculo é sintoma de auto-link, que o §14 proíbe',
    );
  });

  test('082: Lite vira Client sem reescrever histórico', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;

    // Conversão: a organização ganha tenant próprio.
    await pool.query('UPDATE partner_organizations SET linked_empresa_id = $2 WHERE id = $1',
      [c.orgA, c.empresaB]);

    const { rows } = await pool.query(
      'SELECT partner_organization_id FROM partner_opportunity_recipients WHERE id = $1', [rec]);
    assert.equal(rows[0].partner_organization_id, c.orgA,
      'histórico aponta para a ORGANIZAÇÃO, então a forma dela pode mudar');
  });

  // ── Snapshot imutável ────────────────────────────────────────────────────────

  test('082: snapshot não pode ser reescrito', async () => {
    const c = await cenario();
    for (const [campo, valor] of [
      ['quantidade', 999],
      ['quantidade_unidade', "'kg'"],
      ['cargo_descricao', "'Outra carga'"],
      // Precisa ser um valor DIFERENTE: o trigger não rejeita (nem deve) um
      // update que não altera nada.
      ['campaign_id', `'00000000-0000-4000-8000-000000000000'::uuid`],
    ]) {
      await assert.rejects(
        pool.query(`UPDATE partner_opportunities SET ${campo} = ${typeof valor === 'number' ? valor : valor} WHERE id = $1`, [c.oportA]),
        /partner_opportunity_snapshot_imutavel/i,
        `campo ${campo} precisa ser congelado`,
      );
    }
  });

  test('082: o ESTADO do share muda, o conteúdo não', async () => {
    const c = await cenario();
    await pool.query(
      `UPDATE partner_opportunities SET estado='STALE_SOURCE', estado_motivo='replan', estado_em=now() WHERE id=$1`,
      [c.oportA]);
    const { rows } = await pool.query('SELECT estado, quantidade FROM partner_opportunities WHERE id=$1', [c.oportA]);
    assert.equal(rows[0].estado, 'STALE_SOURCE');
    assert.equal(Number(rows[0].quantidade), 500, 'quantidade compartilhada permanece a que foi enviada');
  });

  // ── Respostas append-only ────────────────────────────────────────────────────

  test('082: revisão de resposta é append-only — não sobrescreve nem apaga', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;

    const r1 = (await pool.query(
      `INSERT INTO partner_opportunity_responses
         (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
       VALUES ($1,$2,$3,1,'PARTIALLY_AVAILABLE',200,'ton') RETURNING id`,
      [rec, c.empresaA, c.oportA])).rows[0].id;

    await pool.query(
      `INSERT INTO partner_opportunity_responses
         (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
       VALUES ($1,$2,$3,2,'AVAILABLE',500,'ton')`,
      [rec, c.empresaA, c.oportA]);

    await assert.rejects(
      pool.query('UPDATE partner_opportunity_responses SET capacidade_quantidade = 1 WHERE id = $1', [r1]),
      /partner_response_append_only/i);
    await assert.rejects(
      pool.query('DELETE FROM partner_opportunity_responses WHERE id = $1', [r1]),
      /partner_response_append_only/i);

    const { rows } = await pool.query(
      'SELECT revisao, capacidade_quantidade FROM partner_opportunity_responses WHERE recipient_id=$1 ORDER BY revisao',
      [rec]);
    assert.equal(rows.length, 2, 'as duas revisões continuam visíveis para auditoria');
    assert.equal(Number(rows[0].capacidade_quantidade), 200);
  });

  test('082: mesma revisão duas vezes é recusada', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;
    await pool.query(
      `INSERT INTO partner_opportunity_responses
         (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
       VALUES ($1,$2,$3,1,'AVAILABLE',100,'ton')`, [rec, c.empresaA, c.oportA]);
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_responses
           (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
         VALUES ($1,$2,$3,1,'AVAILABLE',100,'ton')`, [rec, c.empresaA, c.oportA]),
      /partner_responses_revisao_unica|duplicate key/i);
  });

  test('082: recusa não declara capacidade; disponibilidade obriga a declarar', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_responses
           (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
         VALUES ($1,$2,$3,1,'DECLINED',500,'ton')`, [rec, c.empresaA, c.oportA]),
      /partner_responses_capacidade_coerente/i,
      '"recusado com 500 ton" não quer dizer nada');

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_responses
           (recipient_id, empresa_id, opportunity_id, revisao, situacao)
         VALUES ($1,$2,$3,2,'AVAILABLE')`, [rec, c.empresaA, c.oportA]),
      /partner_responses_capacidade_coerente/i,
      'disponível sem quantidade não é resposta operacional');
  });

  test('082: quantidade zero ou negativa é recusada', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,$3,'Nada',0,'ton')`, [c.empresaA, c.campanhaA, c.planoA]),
      /quantidade/i);
  });

  // ── Idempotência / concorrência ──────────────────────────────────────────────

  test('082: mesmo client_request_id não cria duas oportunidades', async () => {
    const c = await cenario();
    const rid = 'share-' + Math.random().toString(36).slice(2);
    await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade, client_request_id)
       VALUES ($1,$2,$3,'Soja',100,'ton',$4)`, [c.empresaA, c.campanhaA, c.planoA, rid]);
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade, client_request_id)
         VALUES ($1,$2,$3,'Soja',100,'ton',$4)`, [c.empresaA, c.campanhaA, c.planoA, rid]),
      /partner_opportunities_client_request_key|duplicate key/i);
  });

  test('082: dois convites pendentes para o mesmo e-mail não coexistem', async () => {
    const c = await cenario();
    const email = 'parceiro@exemplo.invalid';
    await pool.query(
      `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
      [c.relA, c.empresaA, email, 'hash-' + Math.random()]);
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
         VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
        [c.relA, c.empresaA, email.toUpperCase(), 'hash-' + Math.random()]),
      /partner_invitations_pendente_key|duplicate key/i,
      'o índice parcial normaliza o e-mail — maiúscula não abre uma segunda porta');
  });

  test('082: convite já usado não impede reconvite legítimo', async () => {
    const c = await cenario();
    const email = 'volta@exemplo.invalid';
    const inv = (await pool.query(
      `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '7 days') RETURNING id`,
      [c.relA, c.empresaA, email, 'hash-' + Math.random()])).rows[0].id;
    await pool.query(`UPDATE partner_invitations SET status='ACEITO', aceito_em=now() WHERE id=$1`, [inv]);

    await pool.query(
      `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
      [c.relA, c.empresaA, email, 'hash-' + Math.random()]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_invitations WHERE relationship_id=$1 AND lower(email)=lower($2)`,
      [c.relA, email]);
    assert.equal(rows[0].n, 2, 'índice PARCIAL: só o pendente é único');
  });

  test('082: ativação concorrente do mesmo convite — só uma vence', async () => {
    const c = await cenario();
    const hash = 'hash-corrida-' + Math.random();
    await pool.query(
      `INSERT INTO partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at)
       VALUES ($1,$2,'corrida@exemplo.invalid',$3, now() + interval '7 days')`,
      [c.relA, c.empresaA, hash]);

    // Duas conexões tentam consumir o convite. A cláusula que decide é a
    // transição condicional de status — não um SELECT seguido de UPDATE.
    const consumir = async () => {
      const cli = await pool.connect();
      try {
        const r = await cli.query(
          `UPDATE partner_invitations SET status='ACEITO', aceito_em=now()
           WHERE token_hash=$1 AND status='PENDENTE' AND expires_at > now()
           RETURNING id`, [hash]);
        return r.rowCount;
      } finally { cli.release(); }
    };
    const [a, b] = await Promise.all([consumir(), consumir()]);
    assert.equal(a + b, 1, 'ativação é de uso único mesmo sob corrida');
  });

  test('082: relacionamento é único por par — reconvidar não duplica o parceiro', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_relationships (empresa_id, partner_organization_id) VALUES ($1,$2)`,
        [c.empresaA, c.orgA]),
      /partner_relationships_par_unico|duplicate key/i);
  });

  test('082: mesmo parceiro só recebe uma vez a mesma oportunidade', async () => {
    const c = await cenario();
    await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4)`, [c.oportA, c.empresaA, c.relA, c.orgA]);
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_recipients
           (opportunity_id, empresa_id, relationship_id, partner_organization_id)
         VALUES ($1,$2,$3,$4)`, [c.oportA, c.empresaA, c.relA, c.orgA]),
      /partner_recipients_unico|duplicate key/i);
  });

  // ── Superfície de dados ──────────────────────────────────────────────────────

  test('082: nenhuma tabela de rede tem coluna de preço', async () => {
    await preparar();
    const { rows } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name LIKE 'partner_%'
         AND (column_name ~* '(preco|price|valor|tarifa|rate|comiss|fee|frete_valor)')`,
    );
    assert.deepEqual(rows, [],
      'E3.6A não tem autoridade de preço; uma coluna aqui viraria número sem dono');
  });

  test('082: RLS ligado e sem grant para anon/authenticated', async () => {
    await preparar();
    const { rows: semRls } = await pool.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname='public' AND tablename LIKE 'partner_%' AND rowsecurity = false`);
    assert.deepEqual(semRls, [], 'toda tabela de parceiro precisa de RLS ligado');

    const { rows: grants } = await pool.query(
      `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name LIKE 'partner_%'
         AND grantee IN ('anon','authenticated')`);
    assert.deepEqual(grants, [], 'Partner Lite nunca consulta tabela direto — o acesso é pela API');
  });

  test('082: a funcionalidade nasce sem mapeamento comercial e sem override de empresa', async () => {
    await preparar();
    const { rows: func } = await pool.query(
      `SELECT ativo, status_ciclo_vida FROM funcionalidades WHERE codigo='partner_network'`);
    assert.equal(func.length, 1);

    const { rows: planos } = await pool.query(
      `SELECT count(*)::int AS n FROM plano_funcionalidades pf
       JOIN funcionalidades f ON f.id = pf.funcionalidade_id WHERE f.codigo='partner_network'`);
    assert.equal(planos[0].n, 0, 'DEFERRED_DEFAULT_DENY: nenhum plano inclui a rede ainda');

    const { rows: overrides } = await pool.query(
      `SELECT count(*)::int AS n FROM empresa_funcionalidades ef
       JOIN funcionalidades f ON f.id = ef.funcionalidade_id WHERE f.codigo='partner_network'`);
    assert.equal(overrides[0].n, 0, 'nenhuma empresa recebe override');
  });

  test('082: permissões vão para administrador e gerente_frota, nunca para operador', async () => {
    await preparar();
    const { rows } = await pool.query(
      `SELECT t.stable_key, count(*)::int AS n
       FROM permission_template_permissions p
       JOIN permission_templates t ON t.id = p.template_id
       WHERE p.permission_key LIKE 'partner_network.%' AND p.allowed
         AND t.empresa_id = $1
       GROUP BY t.stable_key ORDER BY t.stable_key`, [EMPRESA_PRE]);
    const porChave = Object.fromEntries(rows.map((r) => [r.stable_key, r.n]));
    assert.equal(porChave.operador ?? 0, 0, 'Operador é DEFAULT_DENY; a empresa delega depois se quiser');
    for (const chave of ['administrador', 'gerente_frota']) {
      assert.equal(porChave[chave] ?? 0, 4, `${chave} recebe as 4 capacidades de rede`);
    }
  });

  test('082: oportunidade não pode referenciar campanha inexistente', async () => {
    const c = await cenario();
    const fantasma = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,$3,'Soja',10,'ton')`, [c.empresaA, fantasma, c.planoA]),
      /violates foreign key/i);
  });

  test('082: janela incoerente é recusada', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade, janela_inicio, janela_fim)
         VALUES ($1,$2,$3,'Soja',10,'ton', now(), now() - interval '1 day')`,
        [c.empresaA, c.campanhaA, c.planoA]),
      /partner_opportunities_janela_coerente/i);
  });


  // ── HIGH-05: cadeia de proveniência fechada no banco ─────────────────────────

  test('082: destinatário NÃO pode misturar relacionamento de X com organização de Y', async () => {
    const c = await cenario();
    // O caso malicioso que importa: mesma transportadora, dois parceiros dela.
    // A autorização EXTERNA resolve o destinatário por `partner_organization_id`,
    // então essa combinação deixaria o parceiro Y ler e responder um pedido
    // endereçado ao X.
    const orgOutra = (await pool.query(
      `INSERT INTO partner_organizations (nome, criado_por_empresa_id) VALUES ('Outro parceiro da A', $1) RETURNING id`,
      [c.empresaA])).rows[0].id;
    await pool.query(
      `INSERT INTO partner_relationships (empresa_id, partner_organization_id, status)
       VALUES ($1,$2,'ACTIVE')`, [c.empresaA, orgOutra]);

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_recipients
           (opportunity_id, empresa_id, relationship_id, partner_organization_id)
         VALUES ($1,$2,$3,$4)`,
        [c.oportA, c.empresaA, c.relA, orgOutra],
      ),
      /partner_recipients_relationship_boundary_fk|violates foreign key/i,
      'o banco precisa exigir que relacionamento e organização sejam da MESMA relação',
    );
  });

  test('082: resposta NÃO pode citar destinatário de um pedido e id de outro', async () => {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;

    // Segunda oportunidade da MESMA empresa — o caso que as FKs separadas
    // deixavam passar.
    const oportOutra = (await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
       VALUES ($1,$2,$3,'Outra carga',100,'ton') RETURNING id`,
      [c.empresaA, c.campanhaA, c.planoA])).rows[0].id;

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunity_responses
           (recipient_id, empresa_id, opportunity_id, revisao, situacao, capacidade_quantidade, capacidade_unidade)
         VALUES ($1,$2,$3,1,'AVAILABLE',10,'ton')`,
        [rec, c.empresaA, oportOutra],
      ),
      /partner_responses_recipient_boundary_fk|violates foreign key/i,
    );
  });

  test('082: oportunidade da empresa A NÃO pode citar campanha da empresa B', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,$3,'Soja',10,'ton')`,
        [c.empresaA, c.campanhaB, c.planoB],
      ),
      /partner_opportunities_campanha_boundary_fk|violates foreign key/i,
    );
  });

  test('082: versão de plano de OUTRA campanha é recusada', async () => {
    const c = await cenario();
    // Mesma empresa, mas o plano é de outra campanha: a procedência apontaria
    // para o lugar errado, e a prova de obsolescência iria junto.
    const outraCampanha = (await pool.query(
      `INSERT INTO operation_campaigns (empresa_id, reference_code, name, cargo_name, status)
       VALUES ($1, 'CAMP-X-' || substr(md5(random()::text),1,8), 'Outra', 'Milho', 'APPROVED')
       RETURNING id`, [c.empresaA])).rows[0].id;
    const outroPlano = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,1,'APPROVED','v1') RETURNING id`, [c.empresaA, outraCampanha])).rows[0].id;

    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,$3,'Soja',10,'ton')`,
        [c.empresaA, c.campanhaA, outroPlano],
      ),
      /partner_opportunities_plano_boundary_fk|violates foreign key/i,
    );
  });

  test('082: oportunidade sem versão de plano é impossível', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,'Soja',10,'ton')`,
        [c.empresaA, c.campanhaA],
      ),
      /null value in column "plan_version_id"|not-null/i,
      'SHARE_REQUIRES_APPROVED_PLAN_VERSION: sem fonte não há como provar staleness',
    );
  });

  // ── HIGH-07: auditoria append-only ───────────────────────────────────────────

  test('082: evento de rede não pode ser alterado nem apagado', async () => {
    const c = await cenario();
    const ev = (await pool.query(
      `INSERT INTO partner_network_events (empresa_id, entity_type, entity_id, action, source)
       VALUES ($1,'relationship',$2,'relationship_invited','web') RETURNING id`,
      [c.empresaA, c.relA])).rows[0].id;

    await assert.rejects(
      pool.query(`UPDATE partner_network_events SET reason='outro' WHERE id=$1`, [ev]),
      /partner_network_event_append_only/i,
      'um log que o processo auditado pode reescrever não é auditoria');
    await assert.rejects(
      pool.query('DELETE FROM partner_network_events WHERE id=$1', [ev]),
      /partner_network_event_append_only/i);
  });

  // ── HIGH-06: convite e ativação atômicos ─────────────────────────────────────

  test('082: criar convite é atômico — organização, relação, convite e evento juntos', async () => {
    const c = await cenario();
    const hash = 'hash-rpc-' + Math.random();
    const { rows } = await pool.query(
      `SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Parceiro RPC', 'rpc@exemplo.invalid', hash,
        new Date(Date.now() + 7 * 864e5).toISOString()]);

    const r = rows[0];
    assert.ok(r.out_relationship_id && r.out_partner_organization_id && r.out_invitation_id);

    const { rows: ev } = await pool.query(
      `SELECT action FROM partner_network_events WHERE entity_id=$1`, [r.out_relationship_id]);
    assert.equal(ev.length, 1, 'o evento faz parte da mesma decisão');
    assert.equal(ev[0].action, 'relationship_invited');
  });

  test('082: convite inválido não deixa resíduo — a transação inteira volta atrás', async () => {
    const c = await cenario();
    const antes = await pool.query('SELECT count(*)::int AS n FROM partner_organizations');
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
        [c.empresaA, null, 'Sem token', 'x@exemplo.invalid', '', null]),
      /partner_invite_token_invalido/i);
    const depois = await pool.query('SELECT count(*)::int AS n FROM partner_organizations');
    assert.equal(depois.rows[0].n, antes.rows[0].n,
      'organização criada e depois abandonada seria resíduo de uma operação que falhou');
  });

  test('082: ativação concorrente do mesmo convite — exatamente uma vence', async () => {
    const c = await cenario();
    const hash = 'hash-corrida-rpc-' + Math.random();
    await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Corrida', 'corrida-rpc@exemplo.invalid', hash,
        new Date(Date.now() + 7 * 864e5).toISOString()]);

    const ativar = async (authId) => {
      const cli = await pool.connect();
      try {
        await cli.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hash, authId, null]);
        return 1;
      } catch { return 0; } finally { cli.release(); }
    };
    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const [a, b] = await Promise.all([ativar(auth), ativar(auth)]);
    assert.equal(a + b, 1, 'convite é de uso único mesmo sob corrida');
  });

  test('082: convite de relacionamento REVOGADO não ativa', async () => {
    const c = await cenario();
    const hash = 'hash-revogado-' + Math.random();
    const { rows } = await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Revogado', 'rev@exemplo.invalid', hash,
        new Date(Date.now() + 7 * 864e5).toISOString()]);
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [rows[0].out_relationship_id]);

    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hash, auth, null]),
      /partner_relationship_revogado/i);
  });

  test('082: convite de relacionamento SUSPENSO não vira ativo em silêncio', async () => {
    const c = await cenario();
    const hash = 'hash-suspenso-' + Math.random();
    const { rows } = await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Suspenso', 'sus@exemplo.invalid', hash,
        new Date(Date.now() + 7 * 864e5).toISOString()]);
    await pool.query(`UPDATE partner_relationships SET status='SUSPENDED' WHERE id=$1`, [rows[0].out_relationship_id]);

    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hash, auth, null]),
      /partner_relationship_suspenso/i,
      'quem suspendeu precisa reativar deliberadamente');
  });

  test('082: convite expirado não ativa e fica marcado', async () => {
    const c = await cenario();
    const hash = 'hash-expirado-' + Math.random();
    const { rows } = await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Expirado', 'exp@exemplo.invalid', hash,
        new Date(Date.now() + 60000).toISOString()]);
    await pool.query(`UPDATE partner_invitations SET expires_at = now() - interval '1 hour' WHERE relationship_id=$1`,
      [rows[0].out_relationship_id]);

    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hash, auth, null]),
      /partner_invite_indisponivel/i);
  });

  // ── HIGH-04: resposta atômica e corridas ─────────────────────────────────────

  async function cenarioComDestinatario() {
    const c = await cenario();
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [c.oportA, c.empresaA, c.relA, c.orgA])).rows[0].id;
    return { ...c, rec };
  }

  test('082: resposta válida cria revisão e evento na mesma transação', async () => {
    const c = await cenarioComDestinatario();
    const { rows } = await pool.query(
      `SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, c.userA, 'PARTIALLY_AVAILABLE', 200, 'ton']);
    assert.equal(rows[0].out_revisao, 1);

    const { rows: ev } = await pool.query(
      `SELECT action FROM partner_network_events WHERE entity_id=$1`, [rows[0].out_response_id]);
    assert.equal(ev[0].action, 'response_submitted');
  });

  test('082: revogação ANTES da resposta — resposta negada', async () => {
    const c = await cenarioComDestinatario();
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']),
      /partner_response_relacionamento_inativo/i,
      'nunca pode existir resposta criada DEPOIS de a revogação já valer');
  });

  test('082: resposta ANTES da revogação — vira fato histórico', async () => {
    const c = await cenarioComDestinatario();
    const { rows } = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']);
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);

    const { rows: ainda } = await pool.query(
      'SELECT id FROM partner_opportunity_responses WHERE id=$1', [rows[0].out_response_id]);
    assert.equal(ainda.length, 1, 'revogar não apaga o que já aconteceu');
  });

  // ── HIGH-13: a auto-correção da fonte obsoleta precisa PERSISTIR ────────────

  test('082 HIGH-13: fonte superada → ZERO resposta, e o estado + evento SOBREVIVEM ao retorno', async () => {
    const c = await cenarioComDestinatario();
    const respostasAntes = (await pool.query(
      'SELECT count(*)::int AS n FROM partner_opportunity_responses WHERE recipient_id=$1', [c.rec])).rows[0].n;

    // O caminho real: aprovar outro plano supera o anterior.
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);

    // A versão anterior fazia UPDATE + INSERT do evento e então `RAISE
    // EXCEPTION`. O RAISE aborta a transação e desfaz as duas escritas: o
    // comentário prometia "marca o estado para a próxima leitura chegar honesta"
    // e o banco não guardava nada. A oportunidade seguia CURRENT para sempre,
    // recusando cada resposta com o mesmo erro e sem nunca contar por quê.
    const { rows } = await pool.query(
      `SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']);

    assert.equal(rows[0].out_result, 'SOURCE_STALE', 'resultado estruturado, não exceção');
    assert.equal(rows[0].out_response_id, null);
    assert.equal(rows[0].out_revisao, null);

    // As três provas que só valem DEPOIS do retorno — é aí que o rollback
    // apagaria tudo.
    const respostasDepois = (await pool.query(
      'SELECT count(*)::int AS n FROM partner_opportunity_responses WHERE recipient_id=$1', [c.rec])).rows[0].n;
    assert.equal(respostasDepois, respostasAntes, 'ZERO resposta inserida');

    const { rows: op } = await pool.query(
      'SELECT estado, estado_motivo FROM partner_opportunities WHERE id=$1', [c.oportA]);
    assert.equal(op[0].estado, 'STALE_SOURCE', 'o estado precisa PERSISTIR após o retorno');
    assert.equal(op[0].estado_motivo, 'source_plan_superseded');

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [c.oportA]);
    assert.equal(ev[0].n, 1, 'exatamente um evento de obsolescência, persistido');
  });

  test('082 HIGH-13: a segunda tentativa não duplica o evento — a oportunidade já não é CURRENT', async () => {
    const c = await cenarioComDestinatario();
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);
    await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']);

    // Agora a auto-correção já valeu: a checagem de estado barra antes.
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']),
      /partner_response_oportunidade_nao_current/i);

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [c.oportA]);
    assert.equal(ev[0].n, 1, 'a marcação é idempotente: um fato, um evento');
  });

  test('082: prazo vencido barra a resposta', async () => {
    const c = await cenario();
    // O prazo é parte do snapshot congelado: quem o viu foi o parceiro. Por isso
    // a oportunidade nasce com ele vencido, em vez de ser alterada depois.
    const oportVencida = (await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade, prazo_resposta)
       VALUES ($1,$2,$3,'Soja',500,'ton', now() - interval '1 hour') RETURNING id`,
      [c.empresaA, c.campanhaA, c.planoA])).rows[0].id;
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [oportVencida, c.empresaA, c.relA, c.orgA])).rows[0].id;
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']),
      /partner_response_prazo_encerrado/i);
  });

  test('082: duas revisões simultâneas serializam — sem erro aleatório', async () => {
    const c = await cenarioComDestinatario();
    const enviar = async (q) => {
      const cli = await pool.connect();
      try {
        const r = await cli.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
          [c.rec, c.orgA, c.userA, 'PARTIALLY_AVAILABLE', q, 'ton']);
        return r.rows[0].out_revisao;
      } finally { cli.release(); }
    };
    const revisoes = await Promise.all([enviar(100), enviar(200)]);
    assert.deepEqual(revisoes.slice().sort(), [1, 2],
      'o lock do destinatário faz duas revisões concorrentes virarem 1 e 2, não uma colisão');
  });

  test('082: mesmo client_request_id converge para a revisão existente', async () => {
    const c = await cenarioComDestinatario();
    const rid = 'resp-' + Math.random().toString(36).slice(2);
    const a = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    const b = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    assert.equal(a.rows[0].out_response_id, b.rows[0].out_response_id);
    assert.equal(b.rows[0].out_idempotent, true);
  });

  test('082: parceiro NÃO responde por destinatário de outro parceiro', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgB, c.userB, 'AVAILABLE', 10, 'ton']),
      /partner_response_destinatario_invalido/i);
  });

  test('082: unidade divergente e capacidade acima da lacuna são recusadas', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'kg']),
      /partner_response_unidade_divergente/i);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 99999, 'ton']),
      /partner_response_capacidade_acima_da_lacuna/i);
  });

  // ── §10: share atômico ───────────────────────────────────────────────────────

  test('082: share sem parceiro ativo não deixa oportunidade órfã', async () => {
    const c = await cenario();
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);
    const antes = await pool.query('SELECT count(*)::int AS n FROM partner_opportunities');

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA]]),
      /partner_share_destinatario_indisponivel/i);

    const depois = await pool.query('SELECT count(*)::int AS n FROM partner_opportunities');
    assert.equal(depois.rows[0].n, antes.rows[0].n,
      'um pedido que não chegou a ninguém não pode ficar no banco');
  });

  test('082: share com plano não aprovado é recusado', async () => {
    const c = await cenario();
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA]]),
      /partner_share_plano_nao_aprovado/i);
  });

  // ── HIGH-14: SHARE_RECIPIENT_POLICY_V1 = ALL_REQUESTED_OR_FAIL ──────────────
  //
  // O teste que existia aqui — "share ignora parceiro revogado e mantém o ativo"
  // — CONSAGRAVA o defeito. Ele afirmava que pedir [A, revogado] devia
  // compartilhar com A e devolver sucesso. Isso é compartilhamento silenciosamente
  // parcial: o operador acredita ter pedido capacidade a dois parceiros, pediu a
  // um, recebe 201 e um número que ninguém lê como "faltou alguém". A lacuna que
  // ele dá por coberta continua aberta, e a descoberta vem tarde.
  //
  // A expectativa correta é a oposta: destinatário inválido reprova a operação
  // INTEIRA.

  async function relacionamentoExtra(empresaId, status, nome) {
    const org = (await pool.query(
      `INSERT INTO partner_organizations (nome, criado_por_empresa_id) VALUES ($2, $1) RETURNING id`,
      [empresaId, nome])).rows[0].id;
    const rel = (await pool.query(
      `INSERT INTO partner_relationships (empresa_id, partner_organization_id, status)
       VALUES ($1,$2,$3) RETURNING id`, [empresaId, org, status])).rows[0].id;
    return { org, rel };
  }

  async function contagens() {
    const q = async (sql) => Number((await pool.query(sql)).rows[0].n);
    return {
      oportunidades: await q('SELECT count(*)::int AS n FROM partner_opportunities'),
      destinatarios: await q('SELECT count(*)::int AS n FROM partner_opportunity_recipients'),
      eventos: await q(`SELECT count(*)::int AS n FROM partner_network_events WHERE action='opportunity_shared'`),
    };
  }

  test('082 HIGH-14: share [ativo, revogado] falha INTEIRO e não deixa resíduo', async () => {
    const c = await cenario();
    const { rel: relRevogado } = await relacionamentoExtra(c.empresaA, 'REVOKED', 'Revogado');
    const antes = await contagens();

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, relRevogado]]),
      /partner_share_destinatario_indisponivel/i,
      'compartilhar com parte da lista pedida é ambíguo: ou é o que foi pedido, ou não é nada');

    assert.deepEqual(await contagens(), antes,
      'ZERO oportunidade, ZERO destinatário, ZERO evento');
  });

  test('082 HIGH-14: share [ativo, SUSPENSO] também falha inteiro', async () => {
    const c = await cenario();
    const { rel: relSuspenso } = await relacionamentoExtra(c.empresaA, 'SUSPENDED', 'Suspenso');
    const antes = await contagens();

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, relSuspenso]]),
      /partner_share_destinatario_indisponivel/i);
    assert.deepEqual(await contagens(), antes);
  });

  test('082 HIGH-14: share [ativo, relacionamento de OUTRO tenant] falha inteiro', async () => {
    const c = await cenario();
    const antes = await contagens();

    // `relB` existe e está ACTIVE — mas é da empresa B. Sem a exigência de
    // titularidade, o count de "ativos" bateria e a empresa A compartilharia
    // carga com um parceiro que não é dela.
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, c.relB]]),
      /partner_share_destinatario_indisponivel/i);
    assert.deepEqual(await contagens(), antes);
  });

  test('082 HIGH-14: share [ativo, id inexistente] falha inteiro', async () => {
    const c = await cenario();
    const fantasma = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const antes = await contagens();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, fantasma]]),
      /partner_share_destinatario_indisponivel/i);
    assert.deepEqual(await contagens(), antes);
  });

  test('082 HIGH-14: lista pedida INTEIRA válida compartilha com todos, sem sobra nem falta', async () => {
    const c = await cenario();
    const { rel: rel2 } = await relacionamentoExtra(c.empresaA, 'ACTIVE', 'Segundo ativo');
    const { rel: rel3 } = await relacionamentoExtra(c.empresaA, 'ACTIVE', 'Terceiro ativo');

    const { rows } = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, rel2, rel3]]);
    assert.equal(rows[0].out_destinatarios, 3);

    const { rows: recs } = await pool.query(
      'SELECT relationship_id FROM partner_opportunity_recipients WHERE opportunity_id=$1', [rows[0].out_opportunity_id]);
    assert.deepEqual(recs.map((r) => r.relationship_id).sort(), [c.relA, rel2, rel3].sort());
  });

  test('082 HIGH-14: duplicatas na lista colapsam — pedir o mesmo parceiro duas vezes não é erro nem dobra', async () => {
    const c = await cenario();
    const { rows } = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, c.relA]]);
    assert.equal(rows[0].out_destinatarios, 1,
      'sem normalização, a duplicata bateria no índice único e derrubaria um pedido legítimo');
  });

  test('082: share idempotente por client_request_id', async () => {
    const c = await cenario();
    const rid = 'share-' + Math.random().toString(36).slice(2);
    const a = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);
    const b = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);
    assert.equal(a.rows[0].out_opportunity_id, b.rows[0].out_opportunity_id);
    assert.equal(b.rows[0].out_idempotent, true);
  });

  // Promove uma v2 pelo caminho real do replan: supera a v1, cria a v2 APPROVED
  // (o schema só admite UMA aprovada por campanha) e aponta a autoridade
  // canônica da campanha para ela.
  async function promoverNovoPlano(c) {
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);
    const plano2 = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,2,'APPROVED','v1') RETURNING id`, [c.empresaA, c.campanhaA])).rows[0].id;
    await pool.query('UPDATE operation_campaigns SET approved_plan_version_id=$2 WHERE id=$1',
      [c.campanhaA, plano2]);
    return plano2;
  }

  test('082: marcar fonte obsoleta muda o estado e registra evento', async () => {
    const c = await cenario();
    // `oportA` nasceu de `planoA`; o replan promove a v2, então a fonte dela
    // deixou de ser a atual.
    await promoverNovoPlano(c);

    const n = await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);
    assert.ok(Number(n.rows[0].n) >= 1);

    const { rows } = await pool.query('SELECT estado, estado_motivo FROM partner_opportunities WHERE id=$1', [c.oportA]);
    assert.equal(rows[0].estado, 'STALE_SOURCE');
    assert.equal(rows[0].estado_motivo, 'replan_aprovado');

    const { rows: ev } = await pool.query(
      `SELECT action FROM partner_network_events WHERE entity_id=$1 AND action='opportunity_stale_source'`, [c.oportA]);
    assert.equal(ev.length, 1);
  });

  test('082: as RPCs de negócio não são executáveis por anon nem authenticated', async () => {
    await preparar();
    // Escopado às funções CHAMÁVEIS. As duas funções de trigger
    // (`*_append_only`, `*_congelar_snapshot`) retornam `trigger` e por isso não
    // são invocáveis como RPC — nem pelo PostgREST, nem por SELECT direto. O
    // `PUBLIC` que o Postgres dá a elas por padrão não é superfície de ataque, e
    // revogá-lo arriscaria o próprio append-only, que é o invariante que elas
    // guardam.
    const { rows } = await pool.query(
      `SELECT p.proname, r.grantee
       FROM information_schema.role_routine_grants r
       JOIN pg_proc p ON p.proname = r.routine_name
       JOIN pg_type tp ON tp.oid = p.prorettype
       WHERE r.routine_schema='public'
         AND r.routine_name LIKE 'partner_network_%'
         AND tp.typname <> 'trigger'
         AND r.grantee IN ('anon','authenticated','PUBLIC')`);
    assert.deepEqual(rows, [], 'o Partner Lite nunca fala com o banco direto');
  });

  test('082: as funções de trigger não são chamáveis como RPC', async () => {
    await preparar();
    // A prova de que o `PUBLIC` acima é inofensivo: o Postgres recusa invocar
    // uma função de trigger diretamente.
    await assert.rejects(
      pool.query('SELECT public.partner_network_event_append_only()'),
      /trigger functions can only be called as triggers|cannot be called directly/i);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-11 — ESTADO E EVENTO SÃO A MESMA DECISÃO
  //
  // O que estes testes provam não é que o evento é gravado: é que ele não pode
  // FALTAR. Se a auditoria falhar, a mudança de estado não aconteceu.
  // ══════════════════════════════════════════════════════════════════════════

  // Falha TARDIA e realista: o INSERT do evento é recusado no meio da transação,
  // depois de o UPDATE já ter sido feito. É exatamente a janela em que a versão
  // anterior perdia o registro — porque o UPDATE tinha commitado sozinho.
  const MOTIVO_QUE_FALHA = 'FORCAR_FALHA_AUDIT';

  async function comAuditoriaQuebrada(fn) {
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.__teste_falhar_evento()
      RETURNS trigger LANGUAGE plpgsql AS $tst$
      BEGIN
        IF NEW.reason = '${MOTIVO_QUE_FALHA}' THEN
          RAISE EXCEPTION 'falha_simulada_no_evento_de_auditoria';
        END IF;
        RETURN NEW;
      END;
      $tst$;`);
    await pool.query('DROP TRIGGER IF EXISTS __teste_falha_evento ON public.partner_network_events');
    await pool.query(`CREATE TRIGGER __teste_falha_evento
      BEFORE INSERT ON public.partner_network_events
      FOR EACH ROW EXECUTE FUNCTION public.__teste_falhar_evento()`);
    try {
      await fn();
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS __teste_falha_evento ON public.partner_network_events');
    }
  }

  test('082 HIGH-11: ACTIVE → REVOKED com auditoria falhando — o parceiro CONTINUA ativo', async () => {
    const c = await cenario();
    await comAuditoriaQuebrada(async () => {
      await assert.rejects(
        pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
          [c.empresaA, null, c.relA, 'REVOKED', MOTIVO_QUE_FALHA]),
        /falha_simulada_no_evento_de_auditoria/i);
    });

    const { rows } = await pool.query('SELECT status, revogado_em FROM partner_relationships WHERE id=$1', [c.relA]);
    assert.equal(rows[0].status, 'ACTIVE',
      'uma revogação sem registro é uma decisão de segurança que a empresa não consegue provar depois');
    assert.equal(rows[0].revogado_em, null);
  });

  test('082 HIGH-11: transição bem-sucedida grava estado E evento juntos', async () => {
    const c = await cenario();
    const { rows } = await pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
      [c.empresaA, null, c.relA, 'SUSPENDED', 'ficou sem frota']);
    assert.equal(rows[0].out_status, 'SUSPENDED');
    assert.equal(rows[0].out_inalterado, false);

    const { rows: ev } = await pool.query(
      `SELECT action, reason, metadata FROM partner_network_events
       WHERE entity_id=$1 AND action='relationship_suspended'`, [c.relA]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].reason, 'ficou sem frota');
    assert.equal(ev[0].metadata.de, 'ACTIVE');
    assert.equal(ev[0].metadata.para, 'SUSPENDED');
  });

  test('082 HIGH-11: a máquina de estados vive no BANCO, não só no JavaScript', async () => {
    const c = await cenario();
    // REVOKED é terminal: reativar por UPDATE desfaria uma revogação sem passar
    // por convite nem por prova de que o outro lado ainda controla a conta.
    await pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
      [c.empresaA, null, c.relA, 'REVOKED', null]);
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
        [c.empresaA, null, c.relA, 'ACTIVE', null]),
      /partner_relacionamento_revogado_terminal/i);

    // INVITED → ACTIVE só pela ativação do convite, nunca por transição direta:
    // conceder acesso por PATCH pularia a prova de posse da conta.
    const { rel: relConvidado } = await relacionamentoExtra(c.empresaA, 'INVITED', 'Ainda convidado');
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
        [c.empresaA, null, relConvidado, 'ACTIVE', null]),
      /partner_transicao_invalida/i);

    // SUSPENDED → ACTIVE é ato interno deliberado, e esse é permitido.
    const { rel: relSuspenso } = await relacionamentoExtra(c.empresaA, 'SUSPENDED', 'Suspenso reativável');
    const r = await pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
      [c.empresaA, null, relSuspenso, 'ACTIVE', null]);
    assert.equal(r.rows[0].out_status, 'ACTIVE');
  });

  test('082 HIGH-11: transição para o MESMO estado não inventa evento', async () => {
    const c = await cenario();
    const { rows } = await pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
      [c.empresaA, null, c.relA, 'ACTIVE', null]);
    assert.equal(rows[0].out_inalterado, true);
    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='relationship_activated'`, [c.relA]);
    assert.equal(ev[0].n, 0, 'registrar aqui inventaria uma decisão que ninguém tomou');
  });

  test('082 HIGH-11: relacionamento de OUTRA empresa não existe para a transição', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
        [c.empresaA, null, c.relB, 'REVOKED', null]),
      /partner_nao_encontrado/i);
    const { rows } = await pool.query('SELECT status FROM partner_relationships WHERE id=$1', [c.relB]);
    assert.equal(rows[0].status, 'ACTIVE');
  });

  // ── Retirada de oportunidade, mesma exigência ───────────────────────────────

  test('082 HIGH-11: CURRENT → WITHDRAWN com auditoria falhando — a oportunidade CONTINUA current', async () => {
    const c = await cenario();
    await comAuditoriaQuebrada(async () => {
      await assert.rejects(
        pool.query('SELECT * FROM partner_network_withdraw_opportunity($1,$2,$3,$4)',
          [c.empresaA, null, c.oportA, MOTIVO_QUE_FALHA]),
        /falha_simulada_no_evento_de_auditoria/i);
    });

    const { rows } = await pool.query('SELECT estado, estado_em FROM partner_opportunities WHERE id=$1', [c.oportA]);
    assert.equal(rows[0].estado, 'CURRENT',
      'retirar é o ato que encerra um compromisso já comunicado: precisa de prova tanto quanto revogar');
    assert.equal(rows[0].estado_em, null);
  });

  test('082 HIGH-11: retirada bem-sucedida muda estado e registra evento juntos', async () => {
    const c = await cenario();
    const { rows } = await pool.query('SELECT * FROM partner_network_withdraw_opportunity($1,$2,$3,$4)',
      [c.empresaA, null, c.oportA, 'carga já coberta internamente']);
    assert.equal(rows[0].out_estado, 'WITHDRAWN');

    const { rows: ev } = await pool.query(
      `SELECT reason, metadata FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_withdrawn'`, [c.oportA]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].metadata.de, 'CURRENT');
  });

  test('082 HIGH-11: retirar o que já foi retirado é recusado — um fato, um evento', async () => {
    const c = await cenario();
    await pool.query('SELECT * FROM partner_network_withdraw_opportunity($1,$2,$3,$4)',
      [c.empresaA, null, c.oportA, null]);
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_withdraw_opportunity($1,$2,$3,$4)',
        [c.empresaA, null, c.oportA, null]),
      /partner_oportunidade_indisponivel/i);
  });

  test('082 HIGH-11: oportunidade de OUTRA empresa não pode ser retirada', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_withdraw_opportunity($1,$2,$3,$4)',
        [c.empresaB, null, c.oportA, null]),
      /partner_oportunidade_indisponivel/i);
    const { rows } = await pool.query('SELECT estado FROM partner_opportunities WHERE id=$1', [c.oportA]);
    assert.equal(rows[0].estado, 'CURRENT');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-12 — AUTORIZAÇÃO ANTES DE IDEMPOTÊNCIA
  //
  // A versão anterior resolvia `client_request_id` PRIMEIRO e retornava. Isso
  // transformava um id de requisição conhecido numa chave-mestra de leitura:
  // devolvia 200 com id e revisão depois da revogação, com a organização errada,
  // com a fonte obsoleta ou com o prazo vencido. Um replay não pode ser mais
  // poderoso que a chamada original.
  // ══════════════════════════════════════════════════════════════════════════

  async function respostaComChave(c, rid) {
    const r = await pool.query(
      `SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    assert.equal(r.rows[0].out_result, 'OK');
    return r.rows[0];
  }

  test('082 HIGH-12: replay DEPOIS da revogação é negado, mesmo com a chave conhecida', async () => {
    const c = await cenarioComDestinatario();
    const rid = 'replay-revoke-' + Math.random().toString(36).slice(2);
    await respostaComChave(c, rid);

    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]),
      /partner_response_relacionamento_inativo/i,
      'a chave de idempotência não pode sobreviver ao corte de acesso');
  });

  test('082 HIGH-12: replay com a ORGANIZAÇÃO errada é negado, mesmo com a chave conhecida', async () => {
    const c = await cenarioComDestinatario();
    const rid = 'replay-org-' + Math.random().toString(36).slice(2);
    await respostaComChave(c, rid);

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [c.rec, c.orgB, c.userB, 'AVAILABLE', 10, 'ton', null, null, null, rid]),
      /partner_response_destinatario_invalido/i,
      'um client_request_id conhecido não pode virar leitura da resposta alheia');
  });

  test('082 HIGH-12: replay com a fonte OBSOLETA não devolve a resposta anterior', async () => {
    const c = await cenarioComDestinatario();
    const rid = 'replay-stale-' + Math.random().toString(36).slice(2);
    const original = await respostaComChave(c, rid);

    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);

    const { rows } = await pool.query(
      `SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    assert.equal(rows[0].out_result, 'SOURCE_STALE');
    assert.notEqual(rows[0].out_response_id, original.out_response_id,
      'devolver a resposta antiga aqui diria ao parceiro que o compromisso vale — e não vale mais');
    assert.equal(rows[0].out_response_id, null);
  });

  test('082 HIGH-12: replay com o PRAZO vencido é negado, mesmo com a chave já gravada', async () => {
    const c = await cenario();
    // O prazo é parte do snapshot CONGELADO — é o que o parceiro viu —, então a
    // oportunidade nasce já vencida em vez de ser alterada depois. O estado sob
    // teste é: existe resposta com esta chave E o prazo passou.
    const oportVencida = (await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, plan_version_id, cargo_descricao, quantidade, quantidade_unidade, prazo_resposta)
       VALUES ($1,$2,$3,'Soja',500,'ton', now() - interval '1 hour') RETURNING id`,
      [c.empresaA, c.campanhaA, c.planoA])).rows[0].id;
    const rec = (await pool.query(
      `INSERT INTO partner_opportunity_recipients
         (opportunity_id, empresa_id, relationship_id, partner_organization_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [oportVencida, c.empresaA, c.relA, c.orgA])).rows[0].id;

    // Resposta gravada DENTRO do prazo (inserida direto, porque a RPC — com
    // razão — já não aceitaria o pedido agora).
    const rid = 'replay-prazo-' + Math.random().toString(36).slice(2);
    await pool.query(
      `INSERT INTO partner_opportunity_responses
         (recipient_id, empresa_id, opportunity_id, revisao, situacao,
          capacidade_quantidade, capacidade_unidade, respondido_por_partner_user_id, client_request_id)
       VALUES ($1,$2,$3,1,'AVAILABLE',10,'ton',$4,$5)`,
      [rec, c.empresaA, oportVencida, c.userA, rid]);

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, rid]),
      /partner_response_prazo_encerrado/i,
      'o prazo é conferido antes da idempotência, então a chave conhecida não fura o vencimento');
  });

  test('082 HIGH-12: replay legítimo — tudo válido — continua convergindo para a mesma revisão', async () => {
    const c = await cenarioComDestinatario();
    const rid = 'replay-ok-' + Math.random().toString(36).slice(2);
    const a = await respostaComChave(c, rid);
    const b = await respostaComChave(c, rid);
    assert.equal(b.out_response_id, a.out_response_id);
    assert.equal(b.out_idempotent, true);
    // A autorização vir antes não pode ter quebrado a idempotência de verdade.
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM partner_opportunity_responses WHERE recipient_id=$1', [c.rec]);
    assert.equal(rows[0].n, 1);
  });

  // ── §9: ator vinculado, não rótulo livre ────────────────────────────────────

  test('082 §9: partner_user de OUTRA organização não pode assinar a resposta', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userB, 'AVAILABLE', 10, 'ton']),
      /partner_response_ator_invalido/i,
      'auditoria com autor forjável não é auditoria');
  });

  test('082 §9: uuid arbitrário como ator é recusado', async () => {
    const c = await cenarioComDestinatario();
    const fantasma = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, fantasma, 'AVAILABLE', 10, 'ton']),
      /partner_response_ator_invalido/i);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton']),
      /partner_response_ator_invalido/i);
  });

  test('082 §9: partner_user BLOQUEADO não responde', async () => {
    const c = await cenarioComDestinatario();
    await pool.query(`UPDATE partner_portal_users SET status='BLOQUEADO' WHERE id=$1`, [c.userA]);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']),
      /partner_response_ator_invalido/i);
  });

  test('082 §9: origem partner_client continua FORA da E3.6A', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton', null, null, null, null, 'partner_client']),
      /partner_response_origem_nao_suportada/i,
      'a coluna existe para não reescrever a tabela depois; a porta continua fechada');
  });

  test('082: o evento da resposta aponta para o ator REAL', async () => {
    const c = await cenarioComDestinatario();
    const { rows } = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, c.userA, 'AVAILABLE', 10, 'ton']);
    const { rows: ev } = await pool.query(
      'SELECT actor_partner_user_id FROM partner_network_events WHERE entity_id=$1', [rows[0].out_response_id]);
    assert.equal(ev[0].actor_partner_user_id, c.userA);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §15 — IDEMPOTÊNCIA DE SHARE: MESMA CHAVE, INTENÇÃO DIFERENTE → CONFLITO
  // ══════════════════════════════════════════════════════════════════════════

  test('082 §15: mesma chave + OUTRA campanha → conflito, nunca o share anterior', async () => {
    const c = await cenario();
    const rid = 'share-intent-' + Math.random().toString(36).slice(2);
    await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);

    const outraCampanha = (await pool.query(
      `INSERT INTO operation_campaigns (empresa_id, reference_code, name, cargo_name, status)
       VALUES ($1, 'CAMP-I-' || substr(md5(random()::text),1,8), 'Outra safra', 'Milho', 'APPROVED')
       RETURNING id`, [c.empresaA])).rows[0].id;
    const outroPlano = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,1,'APPROVED','v1') RETURNING id`, [c.empresaA, outraCampanha])).rows[0].id;

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [c.empresaA, null, outraCampanha, outroPlano, 'Milho', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]),
      /partner_share_idempotency_conflict/i,
      'devolver o share antigo faria o operador crer que pediu capacidade para a campanha nova');
  });

  test('082 §15: mesma chave + OUTRO plano da MESMA campanha → conflito', async () => {
    const c = await cenario();
    const rid = 'share-plano-' + Math.random().toString(36).slice(2);
    await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);

    // O caminho REAL do replan: a v1 é superada e a v2 é promovida. O schema
    // impõe `campaign_plan_versions_one_approved_key` — nunca duas APPROVED na
    // mesma campanha —, então este é o único jeito honesto de ter um segundo
    // plano aprovado aqui.
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);
    const plano2 = (await pool.query(
      `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
       VALUES ($1,$2,2,'APPROVED','v1') RETURNING id`, [c.empresaA, c.campanhaA])).rows[0].id;

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [c.empresaA, null, c.campanhaA, plano2, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]),
      /partner_share_idempotency_conflict/i);
  });

  test('082 §15: autoridade da campanha é conferida ANTES de devolver o share idempotente', async () => {
    const c = await cenario();
    const rid = 'share-tenant-' + Math.random().toString(36).slice(2);
    // Campanha de OUTRA empresa: a checagem de titularidade acontece antes da
    // resolução da chave, então nem chega a olhar a idempotência.
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [c.empresaA, null, c.campanhaB, c.planoB, 'Milho', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]),
      /partner_share_campanha_invalida/i);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §13 — SHARE × REVOKE: CORRIDA REAL, DUAS CONEXÕES
  //
  // Não é "chamar um depois do outro e dar o nome de corrida". As duas
  // transações ficam ABERTAS ao mesmo tempo, e a segunda é observada BLOQUEADA
  // no lock antes de a primeira commitar — é a contenção que está sob teste.
  // ══════════════════════════════════════════════════════════════════════════

  // Espera até o backend `pid` aparecer efetivamente esperando por um Lock.
  // Sem esta prova, o teste seria um `setTimeout` torcendo para dar certo.
  async function aguardarBloqueioDeLock(pid, timeoutMs = 10000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const { rows } = await pool.query(
        'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]);
      if (rows[0]?.wait_event_type === 'Lock') return true;
      await new Promise((r) => { setTimeout(r, 25); });
    }
    return false;
  }

  test('082 §13 CASO A: share trava primeiro e COMMITA — a revogação vem depois e o pedido vira histórico', async () => {
    const c = await cenario();
    const cliShare = await pool.connect();
    const cliRevoke = await pool.connect();
    try {
      await cliShare.query('BEGIN');
      const share = await cliShare.query(
        `SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA]]);
      const oportunidadeId = share.rows[0].out_opportunity_id;

      const pidRevoke = (await cliRevoke.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await cliRevoke.query('BEGIN');
      const revogando = cliRevoke.query(
        'SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
        [c.empresaA, null, c.relA, 'REVOKED', null]);

      assert.equal(await aguardarBloqueioDeLock(pidRevoke), true,
        'a revogação precisa ESPERAR o share travado, não passar por cima dele');

      await cliShare.query('COMMIT');
      await revogando;
      await cliRevoke.query('COMMIT');

      // O share aconteceu antes: é fato histórico e não é apagado.
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM partner_opportunity_recipients WHERE opportunity_id=$1', [oportunidadeId]);
      assert.equal(rows[0].n, 1, 'revogar não desfaz o que já tinha sido pedido');
      const { rows: rel } = await pool.query('SELECT status FROM partner_relationships WHERE id=$1', [c.relA]);
      assert.equal(rel[0].status, 'REVOKED');
    } finally {
      cliShare.release();
      cliRevoke.release();
    }
  });

  test('082 §13 CASO B: revogação COMMITA primeiro — o share que já estava em voo é NEGADO por inteiro', async () => {
    const c = await cenario();
    const cliRevoke = await pool.connect();
    const cliShare = await pool.connect();
    const antes = await contagens();
    try {
      await cliRevoke.query('BEGIN');
      await cliRevoke.query('SELECT * FROM partner_network_set_relationship_status($1,$2,$3,$4,$5)',
        [c.empresaA, null, c.relA, 'REVOKED', null]);

      const pidShare = (await cliShare.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await cliShare.query('BEGIN');
      // Dispara SEM aguardar: esta transação vai bater no lock que a revogação
      // ainda segura. É a janela em que a versão anterior lia o estado antigo.
      const compartilhando = cliShare.query(
        `SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA]],
      ).then(() => null, (e) => e);

      assert.equal(await aguardarBloqueioDeLock(pidShare), true,
        'o share precisa BLOQUEAR no lock do relacionamento, não decidir com estado velho');

      await cliRevoke.query('COMMIT');

      const erro = await compartilhando;
      assert.ok(erro instanceof Error, 'compartilhar com quem acabou de ser revogado tem que falhar');
      assert.match(erro.message, /partner_share_destinatario_indisponivel/i);
      await cliShare.query('ROLLBACK');
    } finally {
      cliRevoke.release();
      cliShare.release();
    }

    assert.deepEqual(await contagens(), antes, 'ZERO share, ZERO destinatário, ZERO evento');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-09 — PREFLIGHT: resolve sem consumir, com a MESMA matriz da ativação
  // ══════════════════════════════════════════════════════════════════════════

  async function conviteDeTeste(c, { status = null } = {}) {
    const hash = 'hash-preflight-' + Math.random();
    const { rows } = await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Preflight', 'preflight@exemplo.invalid', hash,
        new Date(Date.now() + 7 * 864e5).toISOString()]);
    if (status) {
      await pool.query('UPDATE partner_relationships SET status=$2 WHERE id=$1',
        [rows[0].out_relationship_id, status]);
    }
    return { hash, ...rows[0] };
  }

  test('082 HIGH-09: preflight devolve o e-mail do convite e NÃO o consome', async () => {
    const c = await cenario();
    const inv = await conviteDeTeste(c);

    const { rows } = await pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [inv.hash]);
    assert.equal(rows[0].out_email, 'preflight@exemplo.invalid');
    assert.equal(rows[0].out_relationship_id, inv.out_relationship_id);
    assert.equal(rows[0].out_partner_organization_id, inv.out_partner_organization_id);
    assert.equal(rows[0].out_empresa_id, c.empresaA);

    // O ponto todo: chamar o preflight não pode queimar o convite.
    const { rows: est } = await pool.query(
      'SELECT status FROM partner_invitations WHERE token_hash=$1', [inv.hash]);
    assert.equal(est[0].status, 'PENDENTE');

    // E a ativação real ainda funciona depois dele.
    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const ativou = await pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)',
      [inv.hash, auth, 'Nome']);
    assert.ok(ativou.rows[0].out_partner_user_id);
  });

  test('082 HIGH-09: preflight recusa convite EXPIRADO — antes de qualquer identidade nascer', async () => {
    const c = await cenario();
    const inv = await conviteDeTeste(c);
    await pool.query(`UPDATE partner_invitations SET expires_at = now() - interval '1 hour' WHERE token_hash=$1`,
      [inv.hash]);
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [inv.hash]),
      /partner_invite_indisponivel/i);
  });

  test('082 HIGH-09: preflight recusa convite já ACEITO', async () => {
    const c = await cenario();
    const inv = await conviteDeTeste(c);
    await pool.query(`UPDATE partner_invitations SET status='ACEITO' WHERE token_hash=$1`, [inv.hash]);
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [inv.hash]),
      /partner_invite_indisponivel/i);
  });

  test('082 HIGH-09: preflight recusa relacionamento REVOGADO e SUSPENSO', async () => {
    const c = await cenario();
    const revogado = await conviteDeTeste(c, { status: 'REVOKED' });
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [revogado.hash]),
      /partner_relationship_revogado/i);

    const suspenso = await conviteDeTeste(c, { status: 'SUSPENDED' });
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [suspenso.hash]),
      /partner_relationship_suspenso/i);
  });

  test('082 HIGH-09: preflight e ativação concordam — nenhum aceita o que o outro nega', async () => {
    const c = await cenario();
    // A divergência entre duas autoridades é a classe de erro do HIGH-09. Um
    // relacionamento já ACTIVE (reconvite de uma segunda pessoa da mesma
    // organização) precisa passar nos DOIS, ou o segundo acesso seria
    // impossível de conceder.
    const inv = await conviteDeTeste(c, { status: 'ACTIVE' });
    const { rows } = await pool.query('SELECT * FROM partner_network_preflight_invitation($1)', [inv.hash]);
    assert.equal(rows[0].out_relationship_status, 'ACTIVE');

    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const ativou = await pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)',
      [inv.hash, auth, null]);
    assert.ok(ativou.rows[0].out_partner_user_id, 'o que o preflight aceita, a ativação também aceita');
  });

  test('082 HIGH-09: token desconhecido é indistinguível de convite morto', async () => {
    await preparar();
    await assert.rejects(
      pool.query('SELECT * FROM partner_network_preflight_invitation($1)', ['hash-que-nunca-existiu']),
      /partner_invite_indisponivel/i,
      'distinguir "não existe" de "expirado" só interessa a quem sonda tokens');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-15 — MULTI-NETWORK: o vínculo duplo é LEGÍTIMO
  // ══════════════════════════════════════════════════════════════════════════

  test('082 HIGH-15: a MESMA identidade Auth pode ser parceira de duas transportadoras', async () => {
    const c = await cenario();
    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const email = 'multi@exemplo.invalid';

    // Convite da empresa A.
    const hashA = 'hash-multi-a-' + Math.random();
    await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Multi A', email, hashA, new Date(Date.now() + 7 * 864e5).toISOString()]);
    const a = await pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hashA, auth, 'Multi']);

    // Convite da empresa B — mesma pessoa, mesmo e-mail, outra rede.
    const hashB = 'hash-multi-b-' + Math.random();
    await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaB, null, 'Multi B', email, hashB, new Date(Date.now() + 7 * 864e5).toISOString()]);
    const b = await pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hashB, auth, 'Multi']);

    assert.notEqual(a.rows[0].out_partner_user_id, b.rows[0].out_partner_user_id);
    assert.notEqual(a.rows[0].out_partner_organization_id, b.rows[0].out_partner_organization_id);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_portal_users WHERE auth_user_id=$1 AND status='ATIVO'`, [auth]);
    assert.equal(rows[0].n, 2,
      'duas linhas para a mesma identidade não são corrupção: são o caso normal de quem é parceiro de duas redes');
  });

  test('082 HIGH-15: auth_user_id NÃO é único globalmente — e não pode ser', async () => {
    await preparar();
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='partner_portal_users' AND indexdef ILIKE '%auth_user_id%'`);
    assert.ok(rows.length >= 1, 'precisa existir índice de busca por identidade');
    for (const r of rows) {
      assert.ok(!/UNIQUE/i.test(r.indexdef),
        'unicidade global proibiria o segundo convite legítimo — a rede da empresa B negaria acesso porque a A convidou antes');
    }
  });

  test('082 HIGH-15: nada liga duas organizações automaticamente', async () => {
    const c = await cenario();
    const auth = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const email = 'sem-autolink@exemplo.invalid';
    const hash = 'hash-autolink-' + Math.random();
    await pool.query(`SELECT * FROM partner_network_create_invitation($1,$2,$3,$4,$5,$6)`,
      [c.empresaA, null, 'Parceiro da A', email, hash, new Date(Date.now() + 7 * 864e5).toISOString()]);
    const r = await pool.query('SELECT * FROM partner_network_activate_invitation($1,$2,$3)', [hash, auth, null]);

    // A organização criada pelo convite de A não pode ter sido ligada a nenhuma
    // empresa Matopiba por inferência de e-mail, CNPJ, nome ou domínio.
    const { rows } = await pool.query(
      'SELECT linked_empresa_id FROM partner_organizations WHERE id=$1', [r.rows[0].out_partner_organization_id]);
    assert.equal(rows[0].linked_empresa_id, null, 'virar Cliente é ato explícito, fora desta fatia');
  });


  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-16 — A CHAVE DE IDEMPOTÊNCIA REPRESENTA A INTENÇÃO INTEIRA
  //
  // A comparação anterior olhava só `campaign_id` e `plan_version_id`. Todo o
  // resto do pedido — quantidade, prazo, mensagem e, sobretudo, PARA QUEM ia —
  // passava sem ser conferido. Repetir a chave com outra lista de parceiros
  // devolvia o share antigo com `out_idempotent=true`: o operador pedia
  // capacidade a C, recebia confirmação, e C nunca tinha sido convidado.
  // ══════════════════════════════════════════════════════════════════════════

  // Assinatura completa do share, para variar UM campo por vez sem repetir 15
  // posicionais em cada teste.
  function argsDeShare(c, over = {}) {
    const a = {
      empresa: c.empresaA, ator: null, campanha: c.campanhaA, plano: c.planoA,
      cargo: 'Soja', quantidade: 100, unidade: 'ton', recipients: [c.relA],
      origem: null, destino: null, janelaInicio: null, janelaFim: null,
      mensagem: null, prazo: null, key: null, ...over,
    };
    return [a.empresa, a.ator, a.campanha, a.plano, a.cargo, a.quantidade, a.unidade,
      a.recipients, a.origem, a.destino, a.janelaInicio, a.janelaFim, a.mensagem, a.prazo, a.key];
  }

  const SQL_SHARE = `SELECT * FROM partner_network_share_gap(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`;

  const compartilhar = (c, over) => pool.query(SQL_SHARE, argsDeShare(c, over));

  async function cenarioComTresParceiros() {
    const c = await cenario();
    const b = await relacionamentoExtra(c.empresaA, 'ACTIVE', 'Parceiro B');
    const d = await relacionamentoExtra(c.empresaA, 'ACTIVE', 'Parceiro C');
    return { ...c, relB2: b.rel, relC2: d.rel };
  }

  test('082 HIGH-16: mesma intenção com destinatários em ORDEM diferente continua idempotente', async () => {
    const c = await cenarioComTresParceiros();
    const key = 'i16-ordem-' + Math.random().toString(36).slice(2);

    const a = await compartilhar(c, { recipients: [c.relA, c.relB2], key });
    const b = await compartilhar(c, { recipients: [c.relB2, c.relA], key });

    assert.equal(b.rows[0].out_idempotent, true, '[A,B] e [B,A] são o MESMO pedido');
    assert.equal(b.rows[0].out_opportunity_id, a.rows[0].out_opportunity_id);
    assert.equal(b.rows[0].out_destinatarios, 2);
  });

  test('082 HIGH-16: duplicatas na lista não mudam a intenção', async () => {
    const c = await cenarioComTresParceiros();
    const key = 'i16-dup-' + Math.random().toString(36).slice(2);

    const a = await compartilhar(c, { recipients: [c.relA, c.relB2], key });
    const b = await compartilhar(c, { recipients: [c.relA, c.relA, c.relB2], key });

    assert.equal(b.rows[0].out_idempotent, true);
    assert.equal(b.rows[0].out_opportunity_id, a.rows[0].out_opportunity_id);
  });

  test('082 HIGH-16: mesma chave com DESTINATÁRIOS diferentes é conflito, não o share antigo', async () => {
    const c = await cenarioComTresParceiros();
    const key = 'i16-dest-' + Math.random().toString(36).slice(2);

    // req 1 → [A, B]
    const primeiro = await compartilhar(c, { recipients: [c.relA, c.relB2], key });

    // req 2 → [A, C]. O caso exato do achado: antes devolvia o share de [A, B]
    // como idempotente, e o operador acreditava ter convidado C.
    await assert.rejects(
      compartilhar(c, { recipients: [c.relA, c.relC2], key }),
      /partner_share_idempotency_conflict/i);

    // O share original permanece intacto, e C continua sem ter sido convidado.
    const { rows } = await pool.query(
      'SELECT relationship_id FROM partner_opportunity_recipients WHERE opportunity_id=$1 ORDER BY relationship_id',
      [primeiro.rows[0].out_opportunity_id]);
    assert.deepEqual(rows.map((r) => r.relationship_id).sort(), [c.relA, c.relB2].sort());
  });

  test('082 HIGH-16: destinatário A MAIS na segunda chamada é conflito', async () => {
    const c = await cenarioComTresParceiros();
    const key = 'i16-mais-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { recipients: [c.relA], key });
    await assert.rejects(
      compartilhar(c, { recipients: [c.relA, c.relB2], key }),
      /partner_share_idempotency_conflict/i,
      'ampliar a rede sob a mesma chave é uma intenção nova');
  });

  test('082 HIGH-16: QUANTIDADE diferente sob a mesma chave é conflito', async () => {
    const c = await cenario();
    const key = 'i16-qtd-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { quantidade: 100, key });
    await assert.rejects(
      compartilhar(c, { quantidade: 250, key }),
      /partner_share_idempotency_conflict/i);
  });

  test('082 HIGH-16: MENSAGEM diferente sob a mesma chave é conflito', async () => {
    const c = await cenario();
    const key = 'i16-msg-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { mensagem: 'Precisamos carregar na segunda', key });
    await assert.rejects(
      compartilhar(c, { mensagem: 'Mudou: carregar na quarta', key }),
      /partner_share_idempotency_conflict/i,
      'a mensagem é o que o parceiro lê — trocá-la em silêncio seria mostrar o texto errado');
  });

  test('082 HIGH-16: PRAZO diferente sob a mesma chave é conflito', async () => {
    const c = await cenario();
    const key = 'i16-prazo-' + Math.random().toString(36).slice(2);
    const t1 = new Date(Date.now() + 2 * 864e5).toISOString();
    const t2 = new Date(Date.now() + 5 * 864e5).toISOString();
    await compartilhar(c, { prazo: t1, key });
    await assert.rejects(
      compartilhar(c, { prazo: t2, key }),
      /partner_share_idempotency_conflict/i);
  });

  test('082 HIGH-16: cargo, unidade, rota e janela também compõem a intenção', async () => {
    const c = await cenario();
    const janela = new Date(Date.now() + 864e5).toISOString();

    for (const [rotulo, variacao] of [
      ['cargo', { cargo: 'Milho' }],
      ['origem', { origem: 'Balsas/MA' }],
      ['destino', { destino: 'Itaqui/MA' }],
      ['janela_inicio', { janelaInicio: janela }],
      ['janela_fim', { janelaFim: janela }],
    ]) {
      const key = 'i16-campo-' + Math.random().toString(36).slice(2);
      await compartilhar(c, { key });
      await assert.rejects(
        compartilhar(c, { ...variacao, key }),
        /partner_share_idempotency_conflict/i, `${rotulo} precisa entrar na comparação`);
    }
  });

  test('082 HIGH-16: espaço em volta NÃO cria conflito falso — a normalização é a mesma dos dois lados', async () => {
    const c = await cenario();
    const key = 'i16-trim-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { cargo: 'Soja', mensagem: 'carregar cedo', key });
    // Comparar o cru contra o normalizado faria a repetição idêntica virar
    // conflito — o defeito se disfarçaria de correção.
    const r = await compartilhar(c, { cargo: '  Soja  ', mensagem: ' carregar cedo ', key });
    assert.equal(r.rows[0].out_idempotent, true);
  });

  test('082 HIGH-16: conflito de intenção NÃO deixa resíduo', async () => {
    const c = await cenarioComTresParceiros();
    const key = 'i16-residuo-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { recipients: [c.relA], key });

    const antes = await contagens();
    await assert.rejects(
      compartilhar(c, { recipients: [c.relB2], quantidade: 999, key }),
      /partner_share_idempotency_conflict/i);
    assert.deepEqual(await contagens(), antes,
      'ZERO nova oportunidade, ZERO destinatário, ZERO evento');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-17 — A AUTORIDADE DA FONTE VEM ANTES DA IDEMPOTÊNCIA
  //
  // A ordem anterior era campanha → idempotência → plano aprovado, então um
  // `client_request_id` antigo ressuscitava um plano já superado: repetir a
  // requisição depois do replan devolvia 200 com `out_idempotent=true`, como se
  // o pedido continuasse valendo.
  // ══════════════════════════════════════════════════════════════════════════

  test('082 HIGH-17: replay de chave válida com plano SUPERADO é NEGADO, não idempotente', async () => {
    const c = await cenario();
    const key = 'i17-superado-' + Math.random().toString(36).slice(2);
    await compartilhar(c, { key });

    // O replan supera a fonte.
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);

    const antes = await contagens();
    await assert.rejects(
      compartilhar(c, { key }),
      /partner_share_plano_nao_aprovado/i,
      'idempotência responde "já foi feita?", nunca antes de "ainda é válida?"');
    assert.deepEqual(await contagens(), antes, 'zero escrita nova');
  });

  test('082 HIGH-17: com o plano ainda APROVADO e a intenção idêntica, segue idempotente', async () => {
    const c = await cenario();
    const key = 'i17-ok-' + Math.random().toString(36).slice(2);
    const a = await compartilhar(c, { key });
    const b = await compartilhar(c, { key });
    assert.equal(b.rows[0].out_idempotent, true);
    assert.equal(b.rows[0].out_opportunity_id, a.rows[0].out_opportunity_id);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HIGH-18 — O MARCADOR É ESCOPADO À FONTE, NÃO À CAMPANHA
  //
  // `approvePlan` chama o marcador DEPOIS de promover o plano novo. Marcando
  // toda oportunidade CURRENT da campanha, o replan marcava como obsoleto um
  // share recém-criado a partir do plano que ele mesmo acabou de aprovar.
  // ══════════════════════════════════════════════════════════════════════════

  test('082 HIGH-18 CASO A: share do plano NOVO sobrevive ao marcador', async () => {
    const c = await cenario();
    const plano2 = await promoverNovoPlano(c);

    // Share legítimo da fonte ATUAL — o caso que o marcador destruía.
    const novo = (await compartilhar(c, { plano: plano2 })).rows[0].out_opportunity_id;

    await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);

    const { rows } = await pool.query('SELECT estado FROM partner_opportunities WHERE id=$1', [novo]);
    assert.equal(rows[0].estado, 'CURRENT',
      'o replan não pode invalidar o pedido que a própria aprovação dele tornou válido');

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [novo]);
    assert.equal(ev[0].n, 0, 'ZERO evento de obsolescência para a fonte atual');
  });

  test('082 HIGH-18 CASO B: share da fonte ANTIGA vira stale, com exatamente um evento', async () => {
    const c = await cenario();
    const antigo = (await compartilhar(c, {})).rows[0].out_opportunity_id;
    await promoverNovoPlano(c);

    const n = await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);
    assert.ok(Number(n.rows[0].n) >= 1);

    const { rows } = await pool.query(
      'SELECT estado, estado_motivo FROM partner_opportunities WHERE id=$1', [antigo]);
    assert.equal(rows[0].estado, 'STALE_SOURCE');
    assert.equal(rows[0].estado_motivo, 'replan_aprovado');

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [antigo]);
    assert.equal(ev[0].n, 1);
  });

  test('082 HIGH-18: antigo e novo convivendo — o marcador separa os dois corretamente', async () => {
    const c = await cenario();
    const antigo = (await compartilhar(c, {})).rows[0].out_opportunity_id;
    const plano2 = await promoverNovoPlano(c);
    const novo = (await compartilhar(c, { plano: plano2, quantidade: 77 })).rows[0].out_opportunity_id;

    const n = await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);

    const { rows } = await pool.query(
      'SELECT id, estado FROM partner_opportunities WHERE id = ANY($1) ORDER BY id', [[antigo, novo]]);
    const porId = Object.fromEntries(rows.map((r) => [r.id, r.estado]));
    assert.equal(porId[antigo], 'STALE_SOURCE');
    assert.equal(porId[novo], 'CURRENT');
    assert.equal(Number(n.rows[0].n), 2,
      'a oportunidade do cenário base também é da fonte antiga — antigo + oportA');
  });

  test('082 HIGH-18: campanha sem plano aprovado deixa TODO share vivo órfão', async () => {
    const c = await cenario();
    const share = (await compartilhar(c, {})).rows[0].out_opportunity_id;
    // `IS DISTINCT FROM` e não `<>`: com a autoridade em NULL, nenhuma fonte é a
    // atual, e `plan_version_id <> NULL` não marcaria nada.
    await pool.query('UPDATE operation_campaigns SET approved_plan_version_id=NULL WHERE id=$1', [c.campanhaA]);

    await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'plano_removido', null]);

    const { rows } = await pool.query('SELECT estado FROM partner_opportunities WHERE id=$1', [share]);
    assert.equal(rows[0].estado, 'STALE_SOURCE');
  });

  test('082 HIGH-18: o marcador é idempotente — um fato, um evento', async () => {
    const c = await cenario();
    const antigo = (await compartilhar(c, {})).rows[0].out_opportunity_id;
    await promoverNovoPlano(c);

    const primeira = await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);
    assert.ok(Number(primeira.rows[0].n) >= 1);

    const segunda = await pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
      [c.empresaA, c.campanhaA, 'replan_aprovado', null]);
    assert.equal(Number(segunda.rows[0].n), 0, 'nada mais está CURRENT com fonte antiga');

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [antigo]);
    assert.equal(ev[0].n, 1, 'a segunda passagem não pode duplicar o registro do mesmo fato');
  });

  test('082 HIGH-18: campanha de OUTRA empresa não é marcável', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4) AS n',
        [c.empresaB, c.campanhaA, 'replan', null]),
      /partner_stale_campanha_invalida/i,
      'silenciar aqui esconderia uma marcação que nunca aconteceu');
  });

  test('082 HIGH-18 CASO C: share da fonte antiga EM VOO × replan — corrida real', async () => {
    const c = await cenario();
    const cliShare = await pool.connect();
    const cliReplan = await pool.connect();
    let shareAntigo;
    let shareNovo;
    try {
      // O share da fonte antiga abre e segura `FOR SHARE` sobre a v1.
      await cliShare.query('BEGIN');
      shareAntigo = (await cliShare.query(SQL_SHARE, argsDeShare(c, { quantidade: 40 })))
        .rows[0].out_opportunity_id;

      // O replan tenta superar a v1 — e precisa do lock exclusivo que o share
      // está segurando. É aqui que as duas operações se encontram de verdade.
      const pidReplan = (await cliReplan.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await cliReplan.query('BEGIN');
      const superando = cliReplan.query(
        `UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);

      assert.equal(await aguardarBloqueioDeLock(pidReplan), true,
        'o replan precisa ESPERAR o share em voo, não passar por cima dele');

      await cliShare.query('COMMIT');
      await superando;

      // Replan segue: promove a v2, aponta a campanha para ela, compartilha a
      // lacuna nova e só então marca as fontes obsoletas — a ordem real do
      // `approvePlan`.
      const plano2 = (await cliReplan.query(
        `INSERT INTO campaign_plan_versions (empresa_id, campaign_id, version_number, status, rules_version)
         VALUES ($1,$2,2,'APPROVED','v1') RETURNING id`, [c.empresaA, c.campanhaA])).rows[0].id;
      await cliReplan.query('UPDATE operation_campaigns SET approved_plan_version_id=$2 WHERE id=$1',
        [c.campanhaA, plano2]);
      shareNovo = (await cliReplan.query(SQL_SHARE, argsDeShare(c, { plano: plano2, quantidade: 60 })))
        .rows[0].out_opportunity_id;
      await cliReplan.query('SELECT partner_network_mark_source_stale($1,$2,$3,$4)',
        [c.empresaA, c.campanhaA, 'replan_aprovado', null]);
      await cliReplan.query('COMMIT');
    } finally {
      cliShare.release();
      cliReplan.release();
    }

    const { rows } = await pool.query(
      'SELECT id, estado FROM partner_opportunities WHERE id = ANY($1)', [[shareAntigo, shareNovo]]);
    const porId = Object.fromEntries(rows.map((r) => [r.id, r.estado]));
    assert.equal(porId[shareAntigo], 'STALE_SOURCE',
      'nenhum share da fonte antiga pode continuar CURRENT depois do replan');
    assert.equal(porId[shareNovo], 'CURRENT',
      'e nenhum share da fonte nova pode ser marcado stale pelo replan que a promoveu');

    const { rows: ev } = await pool.query(
      `SELECT count(*)::int AS n FROM partner_network_events
       WHERE entity_id=$1 AND action='opportunity_stale_source'`, [shareNovo]);
    assert.equal(ev[0].n, 0);
  });
  after(async () => { await pool.end(); });
}

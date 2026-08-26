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

    return { empresaA, empresaB, orgA, orgB, relA, relB, campanhaA, planoA, campanhaB, planoB, oportA };
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
    assert.ok(r.relationship_id && r.partner_organization_id && r.invitation_id);

    const { rows: ev } = await pool.query(
      `SELECT action FROM partner_network_events WHERE entity_id=$1`, [r.relationship_id]);
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
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [rows[0].relationship_id]);

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
    await pool.query(`UPDATE partner_relationships SET status='SUSPENDED' WHERE id=$1`, [rows[0].relationship_id]);

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
      [rows[0].relationship_id]);

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
      [c.rec, c.orgA, null, 'PARTIALLY_AVAILABLE', 200, 'ton']);
    assert.equal(rows[0].revisao, 1);

    const { rows: ev } = await pool.query(
      `SELECT action FROM partner_network_events WHERE entity_id=$1`, [rows[0].response_id]);
    assert.equal(ev[0].action, 'response_submitted');
  });

  test('082: revogação ANTES da resposta — resposta negada', async () => {
    const c = await cenarioComDestinatario();
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton']),
      /partner_response_relacionamento_inativo/i,
      'nunca pode existir resposta criada DEPOIS de a revogação já valer');
  });

  test('082: resposta ANTES da revogação — vira fato histórico', async () => {
    const c = await cenarioComDestinatario();
    const { rows } = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
      [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton']);
    await pool.query(`UPDATE partner_relationships SET status='REVOKED' WHERE id=$1`, [c.relA]);

    const { rows: ainda } = await pool.query(
      'SELECT id FROM partner_opportunity_responses WHERE id=$1', [rows[0].response_id]);
    assert.equal(ainda.length, 1, 'revogar não apaga o que já aconteceu');
  });

  test('082: fonte superada ANTES da resposta — resposta negada e share marcado', async () => {
    const c = await cenarioComDestinatario();
    // O caminho real: aprovar outro plano supera o anterior.
    await pool.query(`UPDATE campaign_plan_versions SET status='SUPERSEDED' WHERE id=$1`, [c.planoA]);

    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton']),
      /partner_response_fonte_obsoleta/i,
      'segunda camada: mesmo sem a marcação assíncrona, a fonte é conferida na transação');
  });

  test('082: prazo vencido barra a resposta', async () => {
    const c = await cenarioComDestinatario();
    await pool.query(
      `UPDATE partner_opportunities SET prazo_resposta = now() - interval '1 hour' WHERE id=$1`, [c.oportA]);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton']),
      /partner_response_prazo_encerrado/i);
  });

  test('082: duas revisões simultâneas serializam — sem erro aleatório', async () => {
    const c = await cenarioComDestinatario();
    const enviar = async (q) => {
      const cli = await pool.connect();
      try {
        const r = await cli.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
          [c.rec, c.orgA, null, 'PARTIALLY_AVAILABLE', q, 'ton']);
        return r.rows[0].revisao;
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
      [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    const b = await pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.rec, c.orgA, null, 'AVAILABLE', 10, 'ton', null, null, null, rid]);
    assert.equal(a.rows[0].response_id, b.rows[0].response_id);
    assert.equal(b.rows[0].idempotent, true);
  });

  test('082: parceiro NÃO responde por destinatário de outro parceiro', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgB, null, 'AVAILABLE', 10, 'ton']),
      /partner_response_destinatario_invalido/i);
  });

  test('082: unidade divergente e capacidade acima da lacuna são recusadas', async () => {
    const c = await cenarioComDestinatario();
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 10, 'kg']),
      /partner_response_unidade_divergente/i);
    await assert.rejects(
      pool.query(`SELECT * FROM partner_network_submit_response($1,$2,$3,$4,$5,$6)`,
        [c.rec, c.orgA, null, 'AVAILABLE', 99999, 'ton']),
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
      /partner_share_sem_parceiro_ativo/i);

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

  test('082: share ignora parceiro revogado e mantém o ativo', async () => {
    const c = await cenario();
    const orgOutra = (await pool.query(
      `INSERT INTO partner_organizations (nome, criado_por_empresa_id) VALUES ('Revogado', $1) RETURNING id`,
      [c.empresaA])).rows[0].id;
    const relRevogado = (await pool.query(
      `INSERT INTO partner_relationships (empresa_id, partner_organization_id, status)
       VALUES ($1,$2,'REVOKED') RETURNING id`, [c.empresaA, orgOutra])).rows[0].id;

    const { rows } = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA, relRevogado]]);
    assert.equal(rows[0].destinatarios, 1, 'só o parceiro ativo recebe');
  });

  test('082: share idempotente por client_request_id', async () => {
    const c = await cenario();
    const rid = 'share-' + Math.random().toString(36).slice(2);
    const a = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);
    const b = await pool.query(`SELECT * FROM partner_network_share_gap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.empresaA, null, c.campanhaA, c.planoA, 'Soja', 100, 'ton', [c.relA], null, null, null, null, null, null, rid]);
    assert.equal(a.rows[0].opportunity_id, b.rows[0].opportunity_id);
    assert.equal(b.rows[0].idempotent, true);
  });

  test('082: marcar fonte obsoleta muda o estado e registra evento', async () => {
    const c = await cenario();
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

  test('082: as RPCs não são executáveis por anon nem authenticated', async () => {
    await preparar();
    const { rows } = await pool.query(
      `SELECT p.proname, r.grantee
       FROM information_schema.role_routine_grants r
       JOIN pg_proc p ON p.proname = r.routine_name
       WHERE r.routine_schema='public' AND r.routine_name LIKE 'partner_network_%'
         AND r.grantee IN ('anon','authenticated','PUBLIC')`);
    assert.deepEqual(rows, [], 'o Partner Lite nunca fala com o banco direto');
  });

  after(async () => { await pool.end(); });
}

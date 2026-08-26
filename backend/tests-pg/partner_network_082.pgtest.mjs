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

  const cadeia = [
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

  let preparado = false;
  async function preparar() {
    if (preparado) return;
    await instalarHelpersDeAuth();
    for (const sql of cadeia) await pool.query(sql);
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
       VALUES ($1, 'CAMP-A-' || substr(md5(random()::text),1,8), 'Safra A', 'Soja', 'PLANNING')
       RETURNING id`, [empresaA])).rows[0].id;

    const oportA = (await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade)
       VALUES ($1,$2,'Soja a granel', 500, 'ton') RETURNING id`, [empresaA, campanhaA])).rows[0].id;

    return { empresaA, empresaB, orgA, orgB, relA, relB, campanhaA, oportA };
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
      ['campaign_id', `'${c.campanhaA}'::uuid`],
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
        `INSERT INTO partner_opportunities (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,'Nada',0,'ton')`, [c.empresaA, c.campanhaA]),
      /quantidade/i);
  });

  // ── Idempotência / concorrência ──────────────────────────────────────────────

  test('082: mesmo client_request_id não cria duas oportunidades', async () => {
    const c = await cenario();
    const rid = 'share-' + Math.random().toString(36).slice(2);
    await pool.query(
      `INSERT INTO partner_opportunities
         (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade, client_request_id)
       VALUES ($1,$2,'Soja',100,'ton',$3)`, [c.empresaA, c.campanhaA, rid]);
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade, client_request_id)
         VALUES ($1,$2,'Soja',100,'ton',$3)`, [c.empresaA, c.campanhaA, rid]),
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
       GROUP BY t.stable_key ORDER BY t.stable_key`);
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
        `INSERT INTO partner_opportunities (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade)
         VALUES ($1,$2,'Soja',10,'ton')`, [c.empresaA, fantasma]),
      /violates foreign key/i);
  });

  test('082: janela incoerente é recusada', async () => {
    const c = await cenario();
    await assert.rejects(
      pool.query(
        `INSERT INTO partner_opportunities
           (empresa_id, campaign_id, cargo_descricao, quantidade, quantidade_unidade, janela_inicio, janela_fim)
         VALUES ($1,$2,'Soja',10,'ton', now(), now() - interval '1 day')`,
        [c.empresaA, c.campanhaA]),
      /partner_opportunities_janela_coerente/i);
  });

  after(async () => { await pool.end(); });
}

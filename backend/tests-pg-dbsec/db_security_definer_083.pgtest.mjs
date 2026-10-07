// DB-SEC-1 — migration 083 em Postgres real.
//
// Nunca roda contra produção: exige DATABASE_URL de banco efêmero. O teste cria
// fixtures sintéticas suficientes para aplicar a migration e validar grants,
// search_path, preservação de helpers RLS/triggers e o guard pós-migration.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONN = process.env.DATABASE_URL;

if (!CONN) {
  if (process.env.CI) {
    test('DB security 083 PG exige DATABASE_URL na CI', () => {
      assert.fail('DATABASE_URL ausente em CI; teste 083 nao pode ser pulado');
    });
  } else {
    test('DB security 083 PG (pulado: sem DATABASE_URL local)', { skip: true }, () => {});
  }
} else {
  const pg = await import('pg');
  registrar(pg.default ?? pg);
}

function registrar(pg) {
  const { Pool } = pg;
  const here = dirname(fileURLToPath(import.meta.url));
  const migration083 = readFileSync(join(here, '..', 'migrations', '083_security_definer_hardening.sql'), 'utf8');
  const pool = new Pool({ connectionString: CONN, max: 1 });

  after(async () => { await pool.end(); });

  async function setupRoles() {
    await pool.query(`DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await pool.query(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await pool.query(`DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await pool.query(`DO $$ BEGIN CREATE ROLE supabase_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }

  async function setupSchemas() {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS graphql;
      CREATE SCHEMA IF NOT EXISTS graphql_public;
      CREATE SCHEMA IF NOT EXISTS realtime;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE SCHEMA IF NOT EXISTS vault;
    `);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await pool.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
  }

  async function setupProductionLikeDefaultAcls() {
    for (const owner of ['postgres', 'supabase_admin']) {
      for (const schema of ['public', 'extensions', 'graphql', 'graphql_public', 'realtime', 'storage']) {
        await pool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
      }
    }
  }

  async function setupTargetFunctions() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.usuarios (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid,
        tipo text,
        is_super_admin boolean not null default false
      );
      CREATE TABLE IF NOT EXISTS public.empresas (
        id uuid primary key default gen_random_uuid(),
        status text,
        trial_ends_at timestamptz,
        updated_at timestamptz,
        operational_scope_mode text default 'legacy'
      );
      CREATE TABLE IF NOT EXISTS public.planos (
        id uuid primary key default gen_random_uuid(),
        limite_motoristas integer
      );
      CREATE TABLE IF NOT EXISTS public.motoristas (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid,
        status_cadastro text
      );
      CREATE TABLE IF NOT EXISTS public.frete_localizacoes (
        id uuid primary key default gen_random_uuid(),
        frete_id uuid
      );
      CREATE TABLE IF NOT EXISTS public.fretes (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid,
        status text
      );
      CREATE TABLE IF NOT EXISTS public.frete_localizacao_retencao (
        frete_id uuid primary key,
        empresa_id uuid,
        encerrado_em timestamptz
      );
      CREATE TABLE IF NOT EXISTS public.partner_opportunities (
        id uuid primary key default gen_random_uuid(),
        campaign_id uuid,
        plan_version_id uuid,
        snapshot_version integer,
        empresa_id uuid,
        cargo_descricao text,
        origem_resumo text,
        destino_resumo text,
        quantidade numeric,
        quantidade_unidade text,
        janela_inicio timestamptz,
        janela_fim timestamptz,
        restricoes jsonb,
        mensagem text,
        prazo_resposta timestamptz,
        criado_em timestamptz default now()
      );
      CREATE TABLE IF NOT EXISTS public.partner_opportunity_responses (id uuid primary key default gen_random_uuid());
      CREATE TABLE IF NOT EXISTS public.partner_network_events (id uuid primary key default gen_random_uuid());
      CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (id uuid primary key default gen_random_uuid(), updated_at timestamptz);
      CREATE TABLE IF NOT EXISTS public.contrato_modelos (id uuid primary key default gen_random_uuid(), status text, conteudo text, titulo text, conteudo_hash text);
      CREATE TABLE IF NOT EXISTS public.grupos_empresariais (id uuid primary key default gen_random_uuid(), nome text, status text, created_by uuid, updated_by uuid, updated_at timestamptz default now());
      CREATE TABLE IF NOT EXISTS public.operational_scope_auditoria (
        id uuid primary key default gen_random_uuid(),
        action text, empresa_id uuid, grupo_id uuid, unidade_operacional_id uuid,
        membership_id uuid, actor_user_id uuid, before_snapshot jsonb,
        after_snapshot jsonb, reason text
      );
      CREATE TABLE IF NOT EXISTS public.grupo_empresarial_empresas (
        grupo_id uuid, empresa_id uuid, status text, created_by uuid, updated_by uuid, updated_at timestamptz default now(),
        primary key (grupo_id, empresa_id)
      );
      CREATE TABLE IF NOT EXISTS public.unidades_operacionais (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid, grupo_id uuid, nome text, codigo text, tipo text,
        documento text, cidade text, uf text, timezone text, is_default boolean default false,
        status text default 'ativo', created_by uuid, updated_by uuid, updated_at timestamptz default now()
      );
      CREATE TABLE IF NOT EXISTS public.regioes_operacionais (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid, grupo_id uuid, nome text, codigo text, status text default 'ativo',
        created_by uuid, updated_by uuid, updated_at timestamptz default now()
      );
      CREATE TABLE IF NOT EXISTS public.regiao_operacional_unidades (
        regiao_id uuid, empresa_id uuid, unidade_operacional_id uuid, status text default 'ativo',
        created_by uuid, updated_by uuid, updated_at timestamptz default now(),
        primary key (regiao_id, unidade_operacional_id)
      );
      CREATE TABLE IF NOT EXISTS public.usuario_operacional_memberships (
        id uuid primary key default gen_random_uuid(),
        usuario_id uuid, empresa_id uuid, grupo_id uuid, scope_level text,
        unidade_operacional_id uuid, regiao_operacional_id uuid, papel text,
        status text, is_primary boolean, motivo text, created_by uuid, updated_by uuid,
        updated_at timestamptz default now()
      );

      ALTER TABLE public.empresas
        ADD COLUMN IF NOT EXISTS updated_at timestamptz;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION public.empresa_ativa(empresa_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN true; END $$;
      CREATE OR REPLACE FUNCTION public.empresa_id()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT empresa_id FROM public.usuarios WHERE id = auth.uid() $$;
      CREATE OR REPLACE FUNCTION public.expirar_trials()
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN 0; END $$;
      CREATE OR REPLACE FUNCTION public.is_admin()
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN false; END $$;
      CREATE OR REPLACE FUNCTION public.is_super_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
      CREATE OR REPLACE FUNCTION public.purge_frete_localizacoes_vencidas()
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN 0; END $$;
      CREATE OR REPLACE FUNCTION public.verificar_limite_motoristas()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.rls_empresa_id()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;
      CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
      CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
      CREATE OR REPLACE FUNCTION public.update_empresa_timestamp()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.check_motorista_limit()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.contrato_modelos_protege_publicado()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.set_asaas_webhook_events_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.partner_opportunity_congelar_snapshot()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE FUNCTION public.partner_response_append_only()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'partner_response_append_only'; END $$;
      CREATE OR REPLACE FUNCTION public.partner_network_event_append_only()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'partner_network_event_append_only'; END $$;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION public.p1_audit(text,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      CREATE OR REPLACE FUNCTION public.p1_criar_grupo(text,uuid,text) RETURNS public.grupos_empresariais LANGUAGE plpgsql AS $$ DECLARE r public.grupos_empresariais; BEGIN INSERT INTO public.grupos_empresariais(nome) VALUES ($1) RETURNING * INTO r; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_atualizar_grupo(uuid,text,text,uuid,text) RETURNS public.grupos_empresariais LANGUAGE plpgsql AS $$ DECLARE r public.grupos_empresariais; BEGIN SELECT * INTO r FROM public.grupos_empresariais LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_vincular_empresa_grupo(uuid,uuid,text,uuid,text) RETURNS public.grupo_empresarial_empresas LANGUAGE plpgsql AS $$ DECLARE r public.grupo_empresarial_empresas; BEGIN SELECT * INTO r FROM public.grupo_empresarial_empresas LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_criar_unidade(uuid,uuid,text,text,text,text,text,text,text,boolean,uuid,text) RETURNS public.unidades_operacionais LANGUAGE plpgsql AS $$ DECLARE r public.unidades_operacionais; BEGIN SELECT * INTO r FROM public.unidades_operacionais LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_atualizar_unidade(uuid,text,text,text,text,boolean,uuid,text) RETURNS public.unidades_operacionais LANGUAGE plpgsql AS $$ DECLARE r public.unidades_operacionais; BEGIN SELECT * INTO r FROM public.unidades_operacionais LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_criar_regiao(uuid,uuid,text,text,uuid,text) RETURNS public.regioes_operacionais LANGUAGE plpgsql AS $$ DECLARE r public.regioes_operacionais; BEGIN SELECT * INTO r FROM public.regioes_operacionais LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_atualizar_regiao(uuid,text,text,text,uuid,text) RETURNS public.regioes_operacionais LANGUAGE plpgsql AS $$ DECLARE r public.regioes_operacionais; BEGIN SELECT * INTO r FROM public.regioes_operacionais LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_definir_unidades_regiao(uuid,uuid[],uuid,text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END $$;
      CREATE OR REPLACE FUNCTION public.p1_criar_membership(uuid,uuid,uuid,text,uuid,uuid,text,boolean,uuid,text) RETURNS public.usuario_operacional_memberships LANGUAGE plpgsql AS $$ DECLARE r public.usuario_operacional_memberships; BEGIN SELECT * INTO r FROM public.usuario_operacional_memberships LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_atualizar_membership(uuid,text,uuid,uuid,text,text,uuid,text) RETURNS public.usuario_operacional_memberships LANGUAGE plpgsql AS $$ DECLARE r public.usuario_operacional_memberships; BEGIN SELECT * INTO r FROM public.usuario_operacional_memberships LIMIT 1; RETURN r; END $$;
      CREATE OR REPLACE FUNCTION public.p1_ativar_enforcement(uuid,uuid,text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{"ok":true}'::jsonb; END $$;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS dbsec083_empresas_touch ON public.empresas;
      CREATE TRIGGER dbsec083_empresas_touch BEFORE UPDATE ON public.empresas
      FOR EACH ROW EXECUTE FUNCTION public.update_empresa_timestamp();
    `);
  }

  async function grants(fn) {
    const { rows } = await pool.query(`
      select
        exists (
          select 1
          from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where p.oid = $1::regprocedure
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
        ) as public_execute,
        has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as authenticated_execute,
        has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service_role_execute
    `, [fn]);
    return rows[0];
  }

  async function searchPath(fn) {
    const { rows } = await pool.query(`
      select p.proconfig
      from pg_proc p
      where p.oid = $1::regprocedure
    `, [fn]);
    return rows[0].proconfig || [];
  }

  async function defaultAclSnapshot() {
    const { rows } = await pool.query(`
      select
        r.rolname as owner,
        coalesce(n.nspname, '') as schema_name,
        d.defaclobjtype as object_type,
        coalesce(
          array_agg(
            format('%s=%s', coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type)
            order by coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type
          ),
          array[]::text[]
        ) as grants
      from pg_default_acl d
      join pg_roles r on r.oid = d.defaclrole
      left join pg_namespace n on n.oid = d.defaclnamespace
      left join lateral aclexplode(d.defaclacl) acl on true
      left join pg_roles grantee on grantee.oid = acl.grantee
      where r.rolname in ('postgres', 'supabase_admin')
        and d.defaclobjtype = 'f'
      group by r.rolname, n.nspname, d.defaclobjtype
      order by r.rolname, coalesce(n.nspname, ''), d.defaclobjtype
    `);
    return JSON.stringify(rows);
  }

  async function publicFunctionExposureViolations() {
    const allowedAuthenticated = [
      'public.empresa_id()',
      'public.is_super_admin()',
      'public.rls_empresa_id()',
      'public.rls_is_company_admin()',
      'public.rls_is_super_admin()',
    ];
    const { rows } = await pool.query(`
      with public_functions as (
        select p.oid, p.oid::regprocedure::text as fn
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (
            select 1
            from pg_depend dep
            where dep.classid = 'pg_proc'::regclass
              and dep.objid = p.oid
              and dep.deptype = 'e'
          )
      ),
      exposure as (
        select
          fn,
          exists (
            select 1
            from pg_proc p
            cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where p.oid = public_functions.oid
              and acl.grantee = 0
              and acl.privilege_type = 'EXECUTE'
          ) as public_execute,
          has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute
        from public_functions
      )
      select *
      from exposure
      where public_execute
         or anon_execute
         or (authenticated_execute and not (fn = any($1::text[])))
      order by fn
    `, [allowedAuthenticated]);
    return rows;
  }

  let prepared = false;
  async function prepare() {
    if (prepared) return;
    await setupRoles();
    await setupSchemas();
    await setupProductionLikeDefaultAcls();
    await setupTargetFunctions();
    const beforeDefaultAcls = await defaultAclSnapshot();
    await pool.query(migration083);
    const afterDefaultAcls = await defaultAclSnapshot();
    assert.equal(afterDefaultAcls, beforeDefaultAcls, '083 nao altera pg_default_acl');
    prepared = true;
  }

  test('083: backend-only SECURITY DEFINER nao executa por PUBLIC/anon/authenticated', async () => {
    await prepare();
    for (const fn of [
      'public.empresa_ativa(uuid)',
      'public.expirar_trials()',
      'public.is_admin()',
      'public.purge_frete_localizacoes_vencidas()',
      'public.verificar_limite_motoristas()',
    ]) {
      const g = await grants(fn);
      assert.equal(g.public_execute, false, `${fn} sem PUBLIC`);
      assert.equal(g.anon_execute, false, `${fn} sem anon`);
      assert.equal(g.authenticated_execute, false, `${fn} sem authenticated`);
      assert.equal(g.service_role_execute, true, `${fn} preserva service_role`);
      assert.ok((await searchPath(fn)).some((v) => /search_path=public, pg_catalog/.test(v)), `${fn} com search_path fixo`);
    }
  });

  test('083: helpers usados por RLS preservam authenticated e removem anon/PUBLIC', async () => {
    await prepare();
    for (const fn of [
      'public.empresa_id()',
      'public.is_super_admin()',
      'public.rls_empresa_id()',
      'public.rls_is_company_admin()',
      'public.rls_is_super_admin()',
    ]) {
      const g = await grants(fn);
      assert.equal(g.public_execute, false, `${fn} sem PUBLIC`);
      assert.equal(g.anon_execute, false, `${fn} sem anon`);
      assert.equal(g.authenticated_execute, true, `${fn} preserva authenticated`);
      assert.equal(g.service_role_execute, true, `${fn} preserva service_role`);
      assert.ok((await searchPath(fn)).some((v) => /search_path=public, pg_catalog/.test(v)), `${fn} com search_path fixo`);
    }
  });

  test('083: trigger functions deixam de ser RPC publica e trigger segue disparando', async () => {
    await prepare();
    for (const fn of [
      'public.update_empresa_timestamp()',
      'public.check_motorista_limit()',
      'public.contrato_modelos_protege_publicado()',
      'public.set_asaas_webhook_events_updated_at()',
      'public.partner_opportunity_congelar_snapshot()',
      'public.partner_response_append_only()',
      'public.partner_network_event_append_only()',
    ]) {
      const g = await grants(fn);
      assert.equal(g.public_execute, false, `${fn} sem PUBLIC`);
      assert.equal(g.anon_execute, false, `${fn} sem anon`);
      assert.equal(g.authenticated_execute, false, `${fn} sem authenticated`);
      assert.equal(g.service_role_execute, true, `${fn} preserva service_role`);
      assert.ok((await searchPath(fn)).some((v) => /search_path=public, pg_catalog/.test(v)), `${fn} com search_path fixo`);
    }

    const id = (await pool.query(`INSERT INTO public.empresas(status) VALUES ('ativo') RETURNING id`)).rows[0].id;
    await pool.query(`UPDATE public.empresas SET status = 'ativo' WHERE id = $1`, [id]);
    const touched = await pool.query(`SELECT updated_at IS NOT NULL AS ok FROM public.empresas WHERE id = $1`, [id]);
    assert.equal(touched.rows[0].ok, true, 'trigger update_empresa_timestamp continua funcional');
  });

  test('083: RPCs P1 continuam service_role-only e search_path fixo', async () => {
    await prepare();
    for (const fn of [
      'public.p1_audit(text,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text)',
      'public.p1_criar_grupo(text,uuid,text)',
      'public.p1_atualizar_grupo(uuid,text,text,uuid,text)',
      'public.p1_vincular_empresa_grupo(uuid,uuid,text,uuid,text)',
      'public.p1_criar_unidade(uuid,uuid,text,text,text,text,text,text,text,boolean,uuid,text)',
      'public.p1_atualizar_unidade(uuid,text,text,text,text,boolean,uuid,text)',
      'public.p1_criar_regiao(uuid,uuid,text,text,uuid,text)',
      'public.p1_atualizar_regiao(uuid,text,text,text,uuid,text)',
      'public.p1_definir_unidades_regiao(uuid,uuid[],uuid,text)',
      'public.p1_criar_membership(uuid,uuid,uuid,text,uuid,uuid,text,boolean,uuid,text)',
      'public.p1_atualizar_membership(uuid,text,uuid,uuid,text,text,uuid,text)',
      'public.p1_ativar_enforcement(uuid,uuid,text)',
    ]) {
      const g = await grants(fn);
      assert.equal(g.public_execute, false, `${fn} sem PUBLIC`);
      assert.equal(g.anon_execute, false, `${fn} sem anon`);
      assert.equal(g.authenticated_execute, false, `${fn} sem authenticated`);
      assert.equal(g.service_role_execute, true, `${fn} preserva service_role`);
      assert.ok((await searchPath(fn)).some((v) => /search_path=public, pg_catalog/.test(v)), `${fn} com search_path fixo`);
    }
  });

  test('083: security guard detecta e aceita exposicao public explicitamente corrigida', async () => {
    await prepare();
    await pool.query(`DROP FUNCTION IF EXISTS public.dbsec083_guard_open()`);
    await pool.query(`CREATE FUNCTION public.dbsec083_guard_open() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.dbsec083_guard_open() TO PUBLIC, anon, authenticated`);

    const negative = await publicFunctionExposureViolations();
    assert.ok(
      negative.some((row) => row.fn === 'public.dbsec083_guard_open()'),
      'guard deve falhar para funcao public aberta indevidamente',
    );

    await pool.query(`REVOKE EXECUTE ON FUNCTION public.dbsec083_guard_open() FROM PUBLIC, anon, authenticated`);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.dbsec083_guard_open() TO service_role`);

    const positive = await publicFunctionExposureViolations();
    assert.deepEqual(positive, [], `guard deve passar apos hardening explicito: ${JSON.stringify(positive)}`);
  });
}

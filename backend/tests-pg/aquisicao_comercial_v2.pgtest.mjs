// Testes REAIS (PostgreSQL isolado) da aquisicao comercial v2.
//
// Prova a garantia persistente de concorrencia/atomicidade da migration 068:
// - duas chamadas simultaneas equivalentes retornam uma aquisicao canonica;
// - duas chamadas simultaneas divergentes deixam apenas uma ativa e a outra em conflito;
// - falha apos superseder contrato antigo faz rollback integral.
//
// Fixtures 100% sinteticas. Pula sem DATABASE_URL.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('aquisicao comercial v2 PG tests (pulados: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 8 });
  const here = dirname(fileURLToPath(import.meta.url));
  const migration068 = readFileSync(join(here, '..', 'migrations', '068_aquisicao_comercial_v2_rpc.sql'), 'utf8');
  const ids = [];

  before(async () => {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS public.usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NULL,
        tipo text NULL,
        status text NULL,
        is_super_admin boolean NOT NULL DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS public.empresas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome text NULL,
        status text NULL,
        plano_id uuid NULL,
        trial_started_at timestamptz NULL,
        trial_ends_at timestamptz NULL,
        decisao_pos_trial text NULL,
        commercial_flow_version text NULL,
        converted_at timestamptz NULL
      );

      CREATE TABLE IF NOT EXISTS public.planos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public.propostas_comerciais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
        plano_id uuid NULL REFERENCES public.planos(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'rascunho',
        origem text NOT NULL DEFAULT 'cadastro_publico',
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        valor_mensal numeric(10,2) NOT NULL DEFAULT 0,
        valor_implantacao numeric(10,2) NOT NULL DEFAULT 0,
        total_inicial numeric(10,2) NOT NULL DEFAULT 0,
        trial_dias integer NOT NULL DEFAULT 0,
        implantacao_override_motivo text NULL,
        criado_por uuid NULL,
        aceito_por uuid NULL,
        aceito_em timestamptz NULL,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NULL
      );

      CREATE TABLE IF NOT EXISTS public.contratos_comerciais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        proposta_id uuid NULL REFERENCES public.propostas_comerciais(id) ON DELETE CASCADE,
        empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'rascunho',
        obrigatorio boolean NOT NULL DEFAULT false,
        template_version text NULL,
        provider text NULL,
        content_hash text NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        aceito_por uuid NULL,
        aceito_em timestamptz NULL,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NULL
      );

      CREATE TABLE IF NOT EXISTS public.contrato_signatarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
        empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
        nome text NOT NULL,
        papel text NOT NULL,
        email_hash text NULL,
        status text NOT NULL DEFAULT 'pendente',
        assinado_em timestamptz NULL,
        metodo_assinatura text NULL,
        assinatura_hash text NULL,
        document_hash_assinado text NULL,
        consent_text_version text NULL,
        consent_text text NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.contrato_eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
        empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
        tipo text NOT NULL,
        detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
        criado_por uuid NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.billing_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        dedupe_key text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_outbox_dedupe ON public.billing_outbox (dedupe_key);

      ALTER TABLE public.empresas
        ADD COLUMN IF NOT EXISTS trial_started_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS decisao_pos_trial text NULL,
        ADD COLUMN IF NOT EXISTS commercial_flow_version text NULL,
        ADD COLUMN IF NOT EXISTS converted_at timestamptz NULL;

      ALTER TABLE public.propostas_comerciais
        ADD COLUMN IF NOT EXISTS plano_id uuid NULL,
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'rascunho',
        ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'cadastro_publico',
        ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS valor_mensal numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS valor_implantacao numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_inicial numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS trial_dias integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS implantacao_override_motivo text NULL,
        ADD COLUMN IF NOT EXISTS criado_por uuid NULL,
        ADD COLUMN IF NOT EXISTS aceito_por uuid NULL,
        ADD COLUMN IF NOT EXISTS aceito_em timestamptz NULL,
        ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NULL;

      ALTER TABLE public.contratos_comerciais
        ADD COLUMN IF NOT EXISTS proposta_id uuid NULL,
        ADD COLUMN IF NOT EXISTS obrigatorio boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS template_version text NULL,
        ADD COLUMN IF NOT EXISTS provider text NULL,
        ADD COLUMN IF NOT EXISTS content_hash text NULL,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS aceito_por uuid NULL,
        ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NULL;

      ALTER TABLE public.contrato_signatarios
        ADD COLUMN IF NOT EXISTS metodo_assinatura text NULL,
        ADD COLUMN IF NOT EXISTS assinatura_hash text NULL,
        ADD COLUMN IF NOT EXISTS document_hash_assinado text NULL,
        ADD COLUMN IF NOT EXISTS consent_text_version text NULL,
        ADD COLUMN IF NOT EXISTS consent_text text NULL;

      ALTER TABLE public.billing_outbox
        ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
    `);
    await pool.query(migration068);
  });

  after(async () => {
    for (const id of ids) {
      await pool.query('DELETE FROM public.billing_outbox WHERE empresa_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM public.empresas WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
  });

  async function fixtureEmpresa() {
    const empresa = randomUUID();
    const plano = randomUUID();
    const usuario = randomUUID();
    ids.push(empresa);
    await pool.query('INSERT INTO public.planos (id, nome) VALUES ($1, $2) ON CONFLICT DO NOTHING', [plano, 'Start PG']);
    await pool.query(
      `INSERT INTO public.empresas (id, nome, status, plano_id, trial_started_at, trial_ends_at, commercial_flow_version)
       VALUES ($1, 'Empresa PG', 'trial', $2, now() - interval '15 days', now() - interval '1 day', 'v2')`,
      [empresa, plano],
    );
    await pool.query('INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1, $2, $3, $4)', [usuario, empresa, 'admin', 'ativo']);
    return { empresa, plano, usuario };
  }

  function snapshot(plano, overrides = {}) {
    return {
      template_version: 'comercial-v1-tecnico',
      origem: 'pos_trial_continuar',
      plano_id: plano,
      plano_nome: 'Start PG',
      quantidade_contratada: 7,
      valor_mensal: 499.9,
      valor_implantacao: 0,
      implantacao_gratis: true,
      total_inicial: 0,
      trial_dias: 0,
      trial_started_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
      ...overrides,
    };
  }

  function chamar({ empresa, usuario, plano, snap }) {
    return pool.query(
      `SELECT * FROM public.iniciar_aquisicao_comercial_v2($1,$2,$3,$4,$5,$6,$7,$8)`,
      [empresa, usuario, plano, 'pos_trial_continuar', snap, 'Cliente PG', null, true],
    );
  }

  test('concorrencia mesma composicao cria/reusa uma aquisicao canonica', async () => {
    const fx = await fixtureEmpresa();
    const snap = snapshot(fx.plano);
    const resultados = await Promise.all([chamar({ ...fx, snap }), chamar({ ...fx, snap })]);
    const rows = resultados.map((r) => r.rows[0]);

    assert.equal(new Set(rows.map((r) => r.proposta_id)).size, 1);
    assert.equal(new Set(rows.map((r) => r.contrato_id)).size, 1);
    const { rows: counts } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE p.origem IN ('aquisicao_explicita','pos_trial_continuar'))::int AS propostas,
         count(c.id)::int AS contratos
       FROM public.propostas_comerciais p
       LEFT JOIN public.contratos_comerciais c ON c.proposta_id = p.id
       WHERE p.empresa_id = $1`,
      [fx.empresa],
    );
    assert.equal(counts[0].propostas, 1);
    assert.equal(counts[0].contratos, 1);
  });

  test('concorrencia composicao divergente deixa uma ativa e uma em conflito', async () => {
    const fx = await fixtureEmpresa();
    const plano2 = randomUUID();
    await pool.query('INSERT INTO public.planos (id, nome) VALUES ($1, $2)', [plano2, 'Outro PG']);
    const a = chamar({ ...fx, snap: snapshot(fx.plano) });
    const b = chamar({ empresa: fx.empresa, usuario: fx.usuario, plano: plano2, snap: snapshot(plano2, { valor_mensal: 799.9 }) });
    const rows = (await Promise.all([a, b])).map((r) => r.rows[0]);

    assert.equal(rows.filter((r) => r.resultado === 'criada').length, 1);
    assert.equal(rows.filter((r) => r.resultado === 'conflito_aquisicao_ativa').length, 1);
    const { rows: counts } = await pool.query(
      `SELECT count(*)::int AS n FROM public.propostas_comerciais
       WHERE empresa_id = $1 AND origem IN ('aquisicao_explicita','pos_trial_continuar') AND status IN ('rascunho','enviada','aceita')`,
      [fx.empresa],
    );
    assert.equal(counts[0].n, 1);
  });

  test('erro depois de superseder contrato antigo faz rollback integral', async () => {
    const fx = await fixtureEmpresa();
    const { rows: prop } = await pool.query(
      `INSERT INTO public.propostas_comerciais (empresa_id, plano_id, status, origem, snapshot, valor_mensal)
       VALUES ($1,$2,'enviada','cadastro_publico',$3,499.90) RETURNING id`,
      [fx.empresa, fx.plano, snapshot(fx.plano)],
    );
    const { rows: ct } = await pool.query(
      `INSERT INTO public.contratos_comerciais (empresa_id, proposta_id, status, obrigatorio, template_version, provider, content_hash)
       VALUES ($1,$2,'aguardando_assinatura',true,'v','manual',$3) RETURNING id`,
      [fx.empresa, prop[0].id, 'a'.repeat(64)],
    );

    await assert.rejects(
      () => chamar({ ...fx, snap: snapshot(fx.plano, { valor_mensal: 'valor-invalido' }) }),
      /invalid input syntax|aquisicao/i,
    );

    const { rows } = await pool.query('SELECT status FROM public.contratos_comerciais WHERE id = $1', [ct[0].id]);
    assert.equal(rows[0].status, 'aguardando_assinatura');
  });
}

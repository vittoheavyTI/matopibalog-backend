-- 00_bootstrap_pre.sql — pré-requisitos para testar as migrations REAIS em Postgres isolado (CI).
--
-- Estratégia (mandato seção 3/4, opção B/C): NÃO copiamos dados de produção. Criamos
-- apenas as tabelas pré-existentes das quais 060/061 dependem (planos, empresas,
-- usuarios) e os papéis do Supabase (anon/authenticated/service_role) — para que as
-- migrations 060 e 061 sejam aplicadas VERBATIM por cima e testadas com transações
-- reais. As tabelas do catálogo (funcionalidades, plano_funcionalidades,
-- funcionalidade_auditoria) e a coluna planos.matriz_funcionalidades_versao vêm da
-- migration 060 real (fidelidade máxima). Fixtures são 100% sintéticas.

-- Schema `extensions` do Supabase — onde pg_trgm é instalado (a migration 061 faz
-- CREATE EXTENSION ... WITH SCHEMA extensions e usa extensions.gin_trgm_ops).
-- Reproduz a organização real do Supabase no Postgres efêmero.
CREATE SCHEMA IF NOT EXISTS extensions;

-- Papéis do Supabase (NOLOGIN) — para os REVOKE/GRANT da RPC funcionarem igual à prod.
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabelas base pré-existentes (mínimas, mas com as colunas que 060/061 e a RPC tocam).
CREATE TABLE IF NOT EXISTS public.usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.planos (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL
  -- planos.matriz_funcionalidades_versao é adicionada pela migration 060 real.
);

CREATE TABLE IF NOT EXISTS public.empresas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          varchar NULL,
  cnpj          varchar NULL,
  cnpj_cpf      varchar NULL,
  email_contato text    NULL
);

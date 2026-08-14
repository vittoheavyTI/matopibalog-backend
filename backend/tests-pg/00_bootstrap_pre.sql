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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL,
  tipo text NULL,
  status text NULL,
  is_super_admin boolean NOT NULL DEFAULT false
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
  email_contato text    NULL,
  status         varchar NULL,              -- referenciado por buscar_empresas
  plano_id       uuid    NULL,              -- idem (JOIN com planos)
  arquivada_em   timestamptz NULL,          -- idem (flag arquivada + ordenação)
  codigo_convite text    NULL               -- idem (match exato de convite)
);

-- 3A-1 ja possui contratos_comerciais em producao (migrations 053-057). O
-- bootstrap PG de billing mantem apenas as colunas que o carregador de add-ons
-- precisa para provar aceite financeiro por contrato/aditivo concluido.
CREATE TABLE IF NOT EXISTS public.contratos_comerciais (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  status     text NOT NULL,
  aceito_em  timestamptz NULL
);

-- Tabela `fretes` mínima — pré-requisito do FK frete_id da migration 064
-- (frete_tracking_credenciais). SOMENTE colunas tocadas pelos testes; 100% sintética.
CREATE TABLE IF NOT EXISTS public.fretes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NULL,
  motorista_id        uuid NULL,
  status              text NULL,
  data                timestamptz NULL,
  modalidade_calculo  text NULL,
  toneladas           numeric NULL,
  valor_tonelada_km   numeric NULL,
  valor_frete         numeric NULL,
  km_inicial          numeric NULL,
  km_final            numeric NULL
);

CREATE TABLE IF NOT EXISTS public.motoristas (
  id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  placa_veiculo text NULL
);

CREATE TABLE IF NOT EXISTS public.despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  motorista_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  frete_id uuid NULL REFERENCES public.fretes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.abastecimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  motorista_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  frete_id uuid NULL REFERENCES public.fretes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.vales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  motorista_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  frete_id uuid NULL REFERENCES public.fretes(id) ON DELETE SET NULL
);

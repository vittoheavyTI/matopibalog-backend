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
  nome text NOT NULL,
  -- planos.matriz_funcionalidades_versao é adicionada pela migration 060 real.
  -- Colunas comerciais pré-existentes em produção (migrations 025/038) das quais a
  -- migration 069 depende para calcular a matriz de disponibilidade por plano.
  categoria          text NOT NULL DEFAULT 'ambos' CHECK (categoria IN ('empresa','autonomo','ambos')),
  limite_motoristas  integer NULL,
  capacidade_inclusa integer NULL,
  requer_negociacao  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.empresas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          varchar NULL,
  cnpj          varchar NULL,
  cnpj_cpf      varchar NULL,
  email_contato text    NULL,
  status         varchar NULL,              -- referenciado por buscar_empresas
  plano_id       uuid    NULL,              -- idem (JOIN com planos)
  trial_started_at timestamptz NULL,        -- preexistente em producao antes da 058
  trial_ends_at    timestamptz NULL,        -- idem; usado pela aquisicao v2
  arquivada_em   timestamptz NULL,          -- idem (flag arquivada + ordenação)
  codigo_convite text    NULL               -- idem (match exato de convite)
);

-- 3A-1 ja possui propostas/contratos comerciais em producao (migrations 053-057).
-- O bootstrap PG reproduz o subconjunto estrutural que as migrations PG atuais
-- precisam antes da 068. Colunas historicamente opcionais nos testes permanecem
-- nullable para preservar fixtures sinteticas legadas.
CREATE TABLE IF NOT EXISTS public.propostas_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  plano_id uuid NULL REFERENCES public.planos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviada','aceita','cancelada','expirada')),
  origem text NOT NULL DEFAULT 'cadastro_publico'
    CONSTRAINT propostas_comerciais_origem_check
    CHECK (origem IN ('cadastro_publico','painel_admin','upload_manual','mock')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_mensal numeric(10,2) NOT NULL DEFAULT 0 CHECK (valor_mensal >= 0),
  valor_implantacao numeric(10,2) NOT NULL DEFAULT 0 CHECK (valor_implantacao >= 0),
  total_inicial numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_inicial >= 0),
  trial_dias integer NOT NULL DEFAULT 0 CHECK (trial_dias >= 0),
  implantacao_override_motivo text NULL CHECK (implantacao_override_motivo IS NULL OR length(implantacao_override_motivo) BETWEEN 8 AND 240),
  criado_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  aceito_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  aceito_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.contratos_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid NULL REFERENCES public.propostas_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho',
    'aguardando_assinatura',
    'pronto_assinatura',
    'aguardando_assinatura_cliente',
    'aguardando_assinatura_matopiba',
    'plenamente_assinado',
    'assinado',
    'aceito_manualmente',
    'recusado',
    'expirado',
    'substituido',
    'cancelado'
  )),
  obrigatorio boolean NOT NULL DEFAULT false,
  template_version text NULL,
  provider text NULL DEFAULT 'manual',
  content_hash text NULL CHECK (content_hash IS NULL OR length(content_hash) = 64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  aceito_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  aceito_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contratos_comerciais_proposta
  ON public.contratos_comerciais (proposta_id)
  WHERE proposta_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.contrato_signatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  papel text NOT NULL CHECK (papel IN ('cliente','matopiba','testemunha','outro')),
  email_hash text NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','assinado','recusado','cancelado')),
  assinado_em timestamptz NULL,
  metodo_assinatura text NULL,
  assinatura_hash text NULL CHECK (assinatura_hash IS NULL OR assinatura_hash ~ '^[0-9a-f]{64}$'),
  document_hash_assinado text NULL CHECK (document_hash_assinado IS NULL OR document_hash_assinado ~ '^[0-9a-f]{64}$'),
  consent_text_version text NULL,
  consent_text text NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_signatarios_parte_principal
  ON public.contrato_signatarios (contrato_id, papel)
  WHERE papel IN ('cliente','matopiba');

CREATE TABLE IF NOT EXISTS public.contrato_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
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

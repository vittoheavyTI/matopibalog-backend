-- 060_catalogo_funcionalidades.sql
-- Macrofrente: Catálogo de Funcionalidades, Entitlements e Add-ons (PR 2C).
--
-- ADITIVA e REVERSÍVEL. Cria o modelo estruturado que substitui o campo livre
-- planos.recursos como fonte comercial/técnica. NÃO altera planos existentes nem
-- contas; não apaga recursos. RLS habilitada sem policies (acesso via backend
-- service_role; anon/authenticated bloqueados — mesmo padrão das demais tabelas).
--
-- Separação de conceitos:
--   funcionalidades.status_ciclo_vida  → estado TÉCNICO (implementada? em breve?)
--   plano_funcionalidades.disponibilidade → ENTITLEMENT comercial por plano
--   plano_funcionalidades.exibir_no_card / funcionalidades.visivel_publicamente → VISIBILIDADE

-- ── Catálogo de funcionalidades ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.funcionalidades (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                text NOT NULL UNIQUE,          -- imutável após uso (regra na app)
  nome                  text NOT NULL,
  descricao_publica     text NULL,
  descricao_interna     text NULL,
  categoria             text NULL,
  modulo                text NULL,
  status_ciclo_vida     text NOT NULL DEFAULT 'disponivel',   -- disponivel|em_breve|em_desenvolvimento|planejada|descontinuada
  modelo_cobranca       text NOT NULL DEFAULT 'incluso',      -- incluso|adicional|sob_negociacao
  preco_padrao_centavos integer NULL,
  unidade_cobranca      text NULL,                            -- mensal|por_motorista|unico
  ativo                 boolean NOT NULL DEFAULT true,
  visivel_publicamente  boolean NOT NULL DEFAULT false,
  plataformas           text[] NOT NULL DEFAULT ARRAY['web','app']::text[],
  ordem_exibicao        integer NOT NULL DEFAULT 0,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funcionalidades_status_chk CHECK (status_ciclo_vida IN ('disponivel','em_breve','em_desenvolvimento','planejada','descontinuada')),
  CONSTRAINT funcionalidades_cobranca_chk CHECK (modelo_cobranca IN ('incluso','adicional','sob_negociacao'))
);
CREATE INDEX IF NOT EXISTS idx_funcionalidades_visiveis ON public.funcionalidades (ordem_exibicao) WHERE ativo AND visivel_publicamente;

-- ── Matriz plano × funcionalidade (entitlement comercial) ────────────────────
CREATE TABLE IF NOT EXISTS public.plano_funcionalidades (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id                  uuid NOT NULL REFERENCES public.planos(id) ON DELETE CASCADE,
  funcionalidade_id         uuid NOT NULL REFERENCES public.funcionalidades(id) ON DELETE CASCADE,
  disponibilidade           text NOT NULL DEFAULT 'indisponivel',  -- incluida|opcional_paga|indisponivel|em_breve|sob_negociacao
  limite_incluso            integer NULL,
  preco_especifico_centavos integer NULL,
  exibir_no_card            boolean NOT NULL DEFAULT true,
  destaque                  boolean NOT NULL DEFAULT false,
  texto_publico             text NULL,
  ordem_exibicao            integer NOT NULL DEFAULT 0,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plano_func_disp_chk CHECK (disponibilidade IN ('incluida','opcional_paga','indisponivel','em_breve','sob_negociacao')),
  CONSTRAINT plano_func_unico UNIQUE (plano_id, funcionalidade_id)
);
CREATE INDEX IF NOT EXISTS idx_plano_func_plano ON public.plano_funcionalidades (plano_id);

-- ── Dependências entre funcionalidades ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.funcionalidade_dependencias (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionalidade_id           uuid NOT NULL REFERENCES public.funcionalidades(id) ON DELETE CASCADE,
  depende_de_funcionalidade_id uuid NOT NULL REFERENCES public.funcionalidades(id) ON DELETE CASCADE,
  regra                       text NOT NULL DEFAULT 'requer',   -- requer|conflita
  CONSTRAINT func_dep_chk CHECK (regra IN ('requer','conflita')),
  CONSTRAINT func_dep_nao_auto CHECK (funcionalidade_id <> depende_de_funcionalidade_id),
  CONSTRAINT func_dep_unico UNIQUE (funcionalidade_id, depende_de_funcionalidade_id)
);

-- ── Entitlements por empresa (PREPARAÇÃO — billing ativado só no PR 3A) ───────
CREATE TABLE IF NOT EXISTS public.empresa_funcionalidades (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  funcionalidade_id     uuid NOT NULL REFERENCES public.funcionalidades(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'ativa',          -- ativa|inativa|pendente
  origem                text NOT NULL DEFAULT 'plano',          -- plano|adicional|cortesia|beta|negociacao
  preco_mensal_centavos integer NULL,
  quantidade            integer NULL,
  vigencia_inicio       timestamptz NULL,
  vigencia_fim          timestamptz NULL,
  motivo                text NULL,
  aprovado_por          uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  contrato_id           uuid NULL,
  aditivo_id            uuid NULL,
  billing_component_id  text NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_func_status_chk CHECK (status IN ('ativa','inativa','pendente')),
  CONSTRAINT empresa_func_origem_chk CHECK (origem IN ('plano','adicional','cortesia','beta','negociacao'))
);
CREATE INDEX IF NOT EXISTS idx_empresa_func_empresa ON public.empresa_funcionalidades (empresa_id);

-- ── Auditoria de alterações do catálogo/matriz (super-admin) ─────────────────
CREATE TABLE IF NOT EXISTS public.funcionalidade_auditoria (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade     text NOT NULL,               -- funcionalidade|plano_funcionalidade|dependencia
  entidade_id  uuid NULL,
  acao         text NOT NULL,               -- criar|editar|arquivar|ativar|desativar|vincular|desvincular
  detalhe      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ator_id      uuid NULL,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_func_auditoria_entidade ON public.funcionalidade_auditoria (entidade, entidade_id);

-- ── Versão da matriz de funcionalidades (para snapshot/contrato) ─────────────
-- Contador simples incrementado a cada alteração relevante do catálogo/matriz.
-- Permite o cadastro/contrato registrar QUAL versão foi usada, sem reescrever
-- contratos já assinados.
ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS matriz_funcionalidades_versao integer NOT NULL DEFAULT 1;

-- RLS: habilitada sem policies (acesso só via backend service_role).
ALTER TABLE public.funcionalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plano_funcionalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionalidade_dependencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_funcionalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionalidade_auditoria ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROLLBACK (documentado; NÃO executar salvo necessidade):
--   ALTER TABLE public.planos DROP COLUMN IF EXISTS matriz_funcionalidades_versao;
--   DROP TABLE IF EXISTS public.funcionalidade_auditoria;
--   DROP TABLE IF EXISTS public.empresa_funcionalidades;
--   DROP TABLE IF EXISTS public.funcionalidade_dependencias;
--   DROP TABLE IF EXISTS public.plano_funcionalidades;
--   DROP TABLE IF EXISTS public.funcionalidades;
-- ============================================================================

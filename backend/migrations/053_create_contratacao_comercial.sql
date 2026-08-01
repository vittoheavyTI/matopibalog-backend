-- Jornada comercial, proposta e contrato.
-- Aditiva/idempotente. Nao ativa preco de implantacao, nao cria fatura e nao
-- chama provedor de pagamento. Dados financeiros ficam congelados em snapshot JSONB.

CREATE TABLE IF NOT EXISTS public.propostas_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  plano_id uuid NULL REFERENCES public.planos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviada','aceita','cancelada','expirada')),
  origem text NOT NULL DEFAULT 'cadastro_publico' CHECK (origem IN ('cadastro_publico','painel_admin','upload_manual','mock')),
  snapshot jsonb NOT NULL,
  valor_mensal numeric(10,2) NOT NULL CHECK (valor_mensal >= 0),
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

CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_empresa
  ON public.propostas_comerciais (empresa_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_status
  ON public.propostas_comerciais (status, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.contratos_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid NOT NULL REFERENCES public.propostas_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aguardando_assinatura','assinado','aceito_manualmente','cancelado')),
  template_version text NOT NULL,
  provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','mock','clicksign')),
  provider_ref text NULL,
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  storage_path text NULL,
  signed_storage_path text NULL,
  signed_file_hash text NULL CHECK (signed_file_hash IS NULL OR length(signed_file_hash) = 64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  aceito_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  aceito_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_contratos_comerciais_empresa
  ON public.contratos_comerciais (empresa_id, criado_em DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contratos_comerciais_proposta
  ON public.contratos_comerciais (proposta_id);

CREATE TABLE IF NOT EXISTS public.contrato_signatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  papel text NOT NULL CHECK (papel IN ('cliente','matopiba','testemunha','outro')),
  email_hash text NULL,
  provider_ref text NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','assinado','recusado','cancelado')),
  assinado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contrato_signatarios_contrato
  ON public.contrato_signatarios (contrato_id);

CREATE TABLE IF NOT EXISTS public.contrato_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contrato_eventos_contrato
  ON public.contrato_eventos (contrato_id, criado_em DESC);

ALTER TABLE public.propostas_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrato_signatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrato_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propostas_comerciais_select_tenant ON public.propostas_comerciais;
CREATE POLICY propostas_comerciais_select_tenant ON public.propostas_comerciais
  FOR SELECT
  TO authenticated
  USING (
    public.rls_is_super_admin()
    OR (empresa_id IS NOT NULL AND public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

DROP POLICY IF EXISTS contratos_comerciais_select_tenant ON public.contratos_comerciais;
CREATE POLICY contratos_comerciais_select_tenant ON public.contratos_comerciais
  FOR SELECT
  TO authenticated
  USING (
    public.rls_is_super_admin()
    OR (empresa_id IS NOT NULL AND public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

DROP POLICY IF EXISTS contrato_signatarios_select_tenant ON public.contrato_signatarios;
CREATE POLICY contrato_signatarios_select_tenant ON public.contrato_signatarios
  FOR SELECT
  TO authenticated
  USING (
    public.rls_is_super_admin()
    OR (empresa_id IS NOT NULL AND public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

DROP POLICY IF EXISTS contrato_eventos_select_tenant ON public.contrato_eventos;
CREATE POLICY contrato_eventos_select_tenant ON public.contrato_eventos
  FOR SELECT
  TO authenticated
  USING (
    public.rls_is_super_admin()
    OR (empresa_id IS NOT NULL AND public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contratos-comerciais', 'contratos-comerciais', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf'];

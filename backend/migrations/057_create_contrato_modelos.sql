-- 057_create_contrato_modelos.sql
-- Modelos de contrato comercial POR PLANO (versionado, publicável) para o super-admin.
-- Aditiva/idempotente e deploy-safe. NÃO cria cobrança, NÃO toca Asaas, NÃO altera
-- planos/faturas. Contratos JÁ EMITIDOS não mudam quando um modelo é editado:
-- cada contrato congela sua própria cópia do conteúdo (colunas de snapshot abaixo).
--
-- Regra de produto: contrato obrigatório vale só para contas novas. Esta migration
-- é apenas estrutural (sem UPDATE/DELETE); não gera contrato retroativo e não bloqueia
-- nenhuma conta existente.

CREATE TABLE IF NOT EXISTS public.contrato_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.planos(id) ON DELETE CASCADE,
  versao integer NOT NULL CHECK (versao >= 1),
  titulo text NOT NULL,
  conteudo text NOT NULL,
  conteudo_hash text NOT NULL CHECK (conteudo_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado','arquivado')),
  vigencia_inicio timestamptz NULL,
  vigencia_fim timestamptz NULL,
  criado_por uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  publicado_em timestamptz NULL,
  atualizado_em timestamptz NULL
);

-- Uma versão por (plano, versao).
CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_modelos_plano_versao
  ON public.contrato_modelos (plano_id, versao);

-- No máximo UM modelo 'publicado' (vigente) por plano.
CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_modelos_um_publicado_por_plano
  ON public.contrato_modelos (plano_id)
  WHERE status = 'publicado';

CREATE INDEX IF NOT EXISTS idx_contrato_modelos_plano
  ON public.contrato_modelos (plano_id, status, versao DESC);

-- Congelamento da versão usada dentro do contrato emitido. NULL = sem modelo
-- vigente na emissão (fallback para o texto técnico padrão). Mudanças futuras no
-- modelo NÃO afetam estas colunas em contratos já emitidos.
ALTER TABLE public.contratos_comerciais
  ADD COLUMN IF NOT EXISTS modelo_id uuid NULL REFERENCES public.contrato_modelos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modelo_versao integer NULL,
  ADD COLUMN IF NOT EXISTS modelo_conteudo_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS modelo_conteudo_hash text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contratos_comerciais_modelo_conteudo_hash_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      ADD CONSTRAINT contratos_comerciais_modelo_conteudo_hash_check
      CHECK (modelo_conteudo_hash IS NULL OR modelo_conteudo_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- RLS: leitura só super-admin (o backend usa service_role). Espelha a filosofia
-- das políticas de `termos`/`contratos_comerciais`.
ALTER TABLE public.contrato_modelos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contrato_modelos_select_superadmin ON public.contrato_modelos;
CREATE POLICY contrato_modelos_select_superadmin ON public.contrato_modelos
  FOR SELECT
  TO authenticated
  USING (public.rls_is_super_admin());

COMMENT ON TABLE public.contrato_modelos IS
  'Modelos de contrato comercial por plano, versionados (rascunho/publicado/arquivado). No máximo um publicado por plano. Contratos emitidos congelam sua própria cópia (contratos_comerciais.modelo_conteudo_snapshot).';

REVOKE ALL ON TABLE public.contrato_modelos FROM PUBLIC;
REVOKE ALL ON TABLE public.contrato_modelos FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contrato_modelos TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contrato_modelos FROM service_role;

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
  -- RESTRICT: modelo é documento jurídico/comercial versionado; não deve sumir
  -- automaticamente se um plano for apagado por engano. Apagar um plano com
  -- modelos passa a ser barrado pelo banco (protege o histórico contratual).
  plano_id uuid NOT NULL REFERENCES public.planos(id) ON DELETE RESTRICT,
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

-- Proteção no banco (defesa em profundidade, além do bloqueio no backend):
-- SÓ rascunho pode ter conteúdo/título/hash editados. Publicado/arquivado só
-- aceitam transição de status e carimbos de tempo (ex.: publicar arquiva o
-- anterior; arquivar muda o status) — nunca reescrita silenciosa do conteúdo.
-- Trigger simples e escopada (sem lógica complexa). "Editar conteúdo" de um
-- modelo publicado/arquivado exige NOVA versão/rascunho.
CREATE OR REPLACE FUNCTION public.contrato_modelos_protege_publicado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'rascunho' AND (
       NEW.conteudo      IS DISTINCT FROM OLD.conteudo
    OR NEW.titulo        IS DISTINCT FROM OLD.titulo
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
  ) THEN
    RAISE EXCEPTION 'Modelo de contrato % (status %) nao pode ter conteudo/titulo editado. Crie uma nova versao.', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contrato_modelos_protege_publicado ON public.contrato_modelos;
CREATE TRIGGER trg_contrato_modelos_protege_publicado
  BEFORE UPDATE ON public.contrato_modelos
  FOR EACH ROW
  EXECUTE FUNCTION public.contrato_modelos_protege_publicado();

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

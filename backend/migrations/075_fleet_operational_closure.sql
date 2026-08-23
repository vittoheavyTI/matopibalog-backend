-- Migration 075: Fleet operational closure.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_FLEET_075.
--
-- Escopo aditivo:
--   * metadados de upload/preview para documentos de ativo;
--   * autoridade operacional para pneus em estoque via unidade_operacional_id;
--   * RPC transacional para handoff de motorista sem janela de conflito ativo.
--
-- Nao cria bucket/policy de Storage, nao altera fretes legados e nao executa
-- backfill de negocio fora das derivacoes objetivas mantidas pela aplicacao.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE public.asset_documents
  ADD COLUMN IF NOT EXISTS nome_arquivo TEXT NULL,
  ADD COLUMN IF NOT EXISTS nome_documento TEXT NULL,
  ADD COLUMN IF NOT EXISTS descricao TEXT NULL,
  ADD COLUMN IF NOT EXISTS mime TEXT NULL,
  ADD COLUMN IF NOT EXISTS tamanho_bytes BIGINT NULL,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT NULL,
  ADD COLUMN IF NOT EXISTS document_contract_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL;

DO $$ BEGIN
  ALTER TABLE public.asset_documents
    ADD CONSTRAINT asset_documents_contract_version_chk
    CHECK (document_contract_version IN (1, 2));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_documents
    ADD CONSTRAINT asset_documents_file_size_chk
    CHECK (tamanho_bytes IS NULL OR tamanho_bytes > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_documents
    ADD CONSTRAINT asset_documents_source_chk
    CHECK (source IS NULL OR source IN ('web','app','api','system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS asset_documents_contract_status_idx
  ON public.asset_documents (empresa_id, document_contract_version, status, created_at DESC);

ALTER TABLE public.tires
  ADD COLUMN IF NOT EXISTS unidade_operacional_id UUID NULL;

UPDATE public.tires t
   SET unidade_operacional_id = a.unidade_operacional_id
  FROM public.fleet_assets a
 WHERE t.current_asset_id = a.id
   AND t.empresa_id = a.empresa_id
   AND t.unidade_operacional_id IS NULL
   AND a.unidade_operacional_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.tires
    ADD CONSTRAINT tires_unit_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE SET NULL (unidade_operacional_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS tires_empresa_unit_status_idx
  ON public.tires (empresa_id, unidade_operacional_id, status);

ALTER TABLE public.driver_vehicle_assignments
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS driver_vehicle_assignments_handoff_request_key
  ON public.driver_vehicle_assignments (empresa_id, COALESCE(created_by, '00000000-0000-0000-0000-000000000000'::uuid), request_id)
  WHERE request_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.driver_vehicle_assignments
    ADD CONSTRAINT driver_assignments_source_chk
    CHECK (source IS NULL OR source IN ('web','app','api','system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.fleet_driver_handoff(
  p_empresa_id UUID,
  p_driver_id UUID,
  p_asset_id UUID DEFAULT NULL,
  p_composition_id UUID DEFAULT NULL,
  p_valid_from TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL
)
RETURNS public.driver_vehicle_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.driver_vehicle_assignments%ROWTYPE;
  v_effective_from TIMESTAMPTZ := COALESCE(p_valid_from, now());
  v_request_id TEXT := NULLIF(trim(p_request_id), '');
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio' USING ERRCODE = '23514';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id obrigatorio' USING ERRCODE = '23514';
  END IF;

  IF (p_asset_id IS NULL) = (p_composition_id IS NULL) THEN
    RAISE EXCEPTION 'informe exatamente um alvo' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = p_driver_id AND u.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'motorista fora do tenant' USING ERRCODE = '23503';
  END IF;

  IF p_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_assets a
    WHERE a.id = p_asset_id AND a.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'ativo fora do tenant' USING ERRCODE = '23503';
  END IF;

  IF p_composition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_compositions c
    WHERE c.id = p_composition_id AND c.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'composicao fora do tenant' USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::TEXT || ':driver:' || p_driver_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::TEXT || ':target:' || COALESCE(p_asset_id::TEXT, p_composition_id::TEXT), 0));

  IF v_request_id IS NOT NULL THEN
    SELECT *
      INTO v_assignment
      FROM public.driver_vehicle_assignments d
     WHERE d.empresa_id = p_empresa_id
       AND COALESCE(d.created_by, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND d.request_id = v_request_id
     LIMIT 1;

    IF FOUND THEN
      RETURN v_assignment;
    END IF;
  END IF;

  UPDATE public.driver_vehicle_assignments d
     SET assignment_status = 'ended',
         valid_until = GREATEST(v_effective_from, d.valid_from + interval '1 millisecond'),
         ended_reason = COALESCE(NULLIF(trim(p_reason), ''), 'driver_handoff')
   WHERE d.empresa_id = p_empresa_id
     AND d.assignment_status = 'active'
     AND d.valid_until IS NULL
     AND (
       d.driver_id = p_driver_id
       OR (p_asset_id IS NOT NULL AND d.asset_id = p_asset_id)
       OR (p_composition_id IS NOT NULL AND d.composition_id = p_composition_id)
     );

  INSERT INTO public.driver_vehicle_assignments
    (empresa_id, driver_id, asset_id, composition_id, assignment_status,
     valid_from, created_by, ended_reason, source, request_id, correlation_id)
  VALUES
    (p_empresa_id, p_driver_id, p_asset_id, p_composition_id, 'active',
     v_effective_from, p_actor_id, NULL, 'web', v_request_id, NULLIF(trim(p_correlation_id), ''))
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_driver_handoff(UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fleet_driver_handoff(UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT,UUID,TEXT,TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fleet_driver_handoff(UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT,UUID,TEXT,TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fleet_driver_handoff(UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT,UUID,TEXT,TEXT) TO service_role;

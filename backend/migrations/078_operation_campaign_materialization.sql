-- Migration 078: Operation Campaign-B materialization linkage.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_CAMPAIGN_078.
--
-- Escopo aditivo:
--   * vinculo relacional Campaign approved planned trip -> frete canonico;
--   * idempotencia por planned_trip_id e por frete_id;
--   * auditoria minima de materializacao com request/correlation.
--
-- Nao altera fretes, nao cria fretes em producao e nao implementa dispatch/ofertas.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.campaign_trip_freights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NOT NULL REFERENCES public.campaign_plan_versions(id) ON DELETE RESTRICT,
  planned_trip_id UUID NOT NULL REFERENCES public.campaign_planned_trips(id) ON DELETE RESTRICT,
  frete_id UUID NOT NULL REFERENCES public.fretes(id) ON DELETE RESTRICT,
  materialization_status TEXT NOT NULL DEFAULT 'MATERIALIZED'
    CHECK (materialization_status IN ('MATERIALIZED','CANCELLED','RECONCILED')),
  source TEXT NOT NULL DEFAULT 'campaign_materialization'
    CHECK (source IN ('campaign_materialization','reconciliation','test')),
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_trip_freights_trip_key
  ON public.campaign_trip_freights (planned_trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_trip_freights_frete_key
  ON public.campaign_trip_freights (frete_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_trip_freights_id_empresa_key
  ON public.campaign_trip_freights (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_trip_freights_campaign_idx
  ON public.campaign_trip_freights (empresa_id, campaign_id, plan_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_trip_freights_request_idx
  ON public.campaign_trip_freights (empresa_id, request_id)
  WHERE request_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.campaign_trip_freights
    ADD CONSTRAINT campaign_trip_freights_plan_campaign_fk
    FOREIGN KEY (plan_version_id, campaign_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, campaign_id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_trip_freights
    ADD CONSTRAINT campaign_trip_freights_trip_plan_campaign_fk
    FOREIGN KEY (planned_trip_id, plan_version_id, campaign_id, empresa_id)
    REFERENCES public.campaign_planned_trips (id, plan_version_id, campaign_id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_trip_freights
    ADD CONSTRAINT campaign_trip_freights_frete_empresa_fk
    FOREIGN KEY (frete_id, empresa_id)
    REFERENCES public.fretes (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_trip_freights
    ADD CONSTRAINT campaign_trip_freights_created_by_empresa_fk
    FOREIGN KEY (created_by, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE SET NULL (created_by);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.campaign_trip_freights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_trip_freights_tenant_access ON public.campaign_trip_freights;
CREATE POLICY campaign_trip_freights_tenant_access ON public.campaign_trip_freights
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

REVOKE ALL ON public.campaign_trip_freights FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_trip_freights TO authenticated;
GRANT ALL ON public.campaign_trip_freights TO service_role;

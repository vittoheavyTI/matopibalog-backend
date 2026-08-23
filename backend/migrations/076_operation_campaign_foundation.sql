-- Migration 076: Operation Campaign-A foundation.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_CAMPAIGN_076.
--
-- Escopo aditivo:
--   * entitlement tecnico operation_campaign sem mapping comercial de planos;
--   * schema Campaign-A ate APPROVED_PLAN;
--   * multi-unidade por associacao explicita;
--   * RLS/grants tenant-safe;
--   * helper tecnico para adicionar permissoes Campaign aos templates existentes.
--
-- Nao cria fretes, nao altera fretes, nao materializa viagens e nao toca
-- billing/Asaas/fiscal/env.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO public.funcionalidades
  (codigo, nome, descricao_publica, categoria, modulo, status_ciclo_vida,
   modelo_cobranca, ativo, visivel_publicamente, ordem_exibicao)
VALUES
  ('operation_campaign', 'Operacao de escoamento',
   'Planejamento deterministico de campanhas operacionais ate plano aprovado.',
   'operacao', 'operation_campaign', 'disponivel', 'sob_negociacao', true, false, 260)
ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao_publica = EXCLUDED.descricao_publica,
  categoria = EXCLUDED.categoria,
  modulo = EXCLUDED.modulo,
  status_ciclo_vida = EXCLUDED.status_ciclo_vida,
  modelo_cobranca = EXCLUDED.modelo_cobranca,
  ativo = true,
  visivel_publicamente = false,
  atualizado_em = now();

CREATE TABLE IF NOT EXISTS public.operation_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  reference_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  cargo_name TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  planned_start TIMESTAMPTZ NULL,
  planned_end TIMESTAMPTZ NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNING','READY_FOR_REVIEW','APPROVED','CANCELLED')),
  planning_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (planning_status IN ('DRAFT','GENERATING','READY_FOR_REVIEW','APPROVED','REJECTED','SUPERSEDED','CANCELLED')),
  approved_plan_version_id UUID NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cancelled_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancellation_reason TEXT NULL,
  client_request_id TEXT NULL,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','app','api','system','test')),
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_campaigns_empresa_reference_key
  ON public.operation_campaigns (empresa_id, lower(reference_code));
CREATE UNIQUE INDEX IF NOT EXISTS operation_campaigns_client_request_key
  ON public.operation_campaigns (empresa_id, COALESCE(created_by, '00000000-0000-0000-0000-000000000000'::uuid), client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS operation_campaigns_id_empresa_key
  ON public.operation_campaigns (id, empresa_id);
CREATE INDEX IF NOT EXISTS operation_campaigns_empresa_status_idx
  ON public.operation_campaigns (empresa_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.campaign_operational_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  unidade_operacional_id UUID NOT NULL REFERENCES public.unidades_operacionais(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'scope' CHECK (role IN ('scope','origin','destination','resource')),
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_operational_units_campaign_unit_key
  ON public.campaign_operational_units (campaign_id, unidade_operacional_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_operational_units_id_empresa_key
  ON public.campaign_operational_units (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_operational_units_empresa_unit_idx
  ON public.campaign_operational_units (empresa_id, unidade_operacional_id);

CREATE TABLE IF NOT EXISTS public.campaign_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('origin','destination')),
  name TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'operational' CHECK (location_type IN ('operational','farm','warehouse','customer','other')),
  unidade_operacional_id UUID NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL,
  address_text TEXT NULL,
  latitude NUMERIC(10,7) NULL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude NUMERIC(10,7) NULL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  time_window_start TIMESTAMPTZ NULL,
  time_window_end TIMESTAMPTZ NULL,
  target_quantity NUMERIC(14,3) NULL CHECK (target_quantity IS NULL OR target_quantity >= 0),
  quantity_unit TEXT NULL CHECK (quantity_unit IS NULL OR quantity_unit IN ('kg','ton','tonelada')),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (time_window_end IS NULL OR time_window_start IS NULL OR time_window_end > time_window_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_locations_id_empresa_key
  ON public.campaign_locations (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_locations_campaign_kind_idx
  ON public.campaign_locations (campaign_id, kind, priority, created_at);
CREATE INDEX IF NOT EXISTS campaign_locations_empresa_unit_idx
  ON public.campaign_locations (empresa_id, unidade_operacional_id);

CREATE TABLE IF NOT EXISTS public.campaign_demands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  origin_location_id UUID NOT NULL REFERENCES public.campaign_locations(id) ON DELETE RESTRICT,
  destination_location_id UUID NOT NULL REFERENCES public.campaign_locations(id) ON DELETE RESTRICT,
  cargo_name TEXT NOT NULL,
  target_quantity NUMERIC(14,3) NOT NULL CHECK (target_quantity >= 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('kg','ton','tonelada')),
  planned_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
  allocated_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (allocated_quantity >= 0),
  executed_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (executed_quantity >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_demands_id_empresa_key
  ON public.campaign_demands (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_demands_campaign_idx
  ON public.campaign_demands (campaign_id, origin_location_id, destination_location_id);

CREATE TABLE IF NOT EXISTS public.campaign_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','READY_FOR_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  rules_version TEXT NOT NULL,
  resource_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  superseded_by UUID NULL REFERENCES public.campaign_plan_versions(id) ON DELETE SET NULL,
  client_request_id TEXT NULL,
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_versions_campaign_version_key
  ON public.campaign_plan_versions (campaign_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_versions_one_review_key
  ON public.campaign_plan_versions (campaign_id)
  WHERE status = 'READY_FOR_REVIEW';
CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_versions_one_approved_key
  ON public.campaign_plan_versions (campaign_id)
  WHERE status = 'APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_versions_client_request_key
  ON public.campaign_plan_versions (empresa_id, campaign_id, COALESCE(generated_by, '00000000-0000-0000-0000-000000000000'::uuid), client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_versions_id_empresa_key
  ON public.campaign_plan_versions (id, empresa_id);

CREATE TABLE IF NOT EXISTS public.campaign_plan_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NOT NULL REFERENCES public.campaign_plan_versions(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL,
  label TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'deterministic_greedy_planner',
  capacity_gap_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (capacity_gap_quantity >= 0),
  capacity_gap_trips INTEGER NOT NULL DEFAULT 0 CHECK (capacity_gap_trips >= 0),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_scenarios_plan_key
  ON public.campaign_plan_scenarios (plan_version_id, scenario_key);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_scenarios_id_empresa_key
  ON public.campaign_plan_scenarios (id, empresa_id);

CREATE TABLE IF NOT EXISTS public.campaign_planned_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NOT NULL REFERENCES public.campaign_plan_versions(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES public.campaign_plan_scenarios(id) ON DELETE CASCADE,
  origin_location_id UUID NOT NULL REFERENCES public.campaign_locations(id) ON DELETE RESTRICT,
  destination_location_id UUID NOT NULL REFERENCES public.campaign_locations(id) ON DELETE RESTRICT,
  demand_id UUID NULL REFERENCES public.campaign_demands(id) ON DELETE SET NULL,
  planned_quantity NUMERIC(14,3) NOT NULL CHECK (planned_quantity >= 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('kg','ton','tonelada')),
  required_capacity_kg NUMERIC(14,3) NOT NULL CHECK (required_capacity_kg >= 0),
  candidate_asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE SET NULL,
  candidate_composition_id UUID NULL REFERENCES public.vehicle_compositions(id) ON DELETE SET NULL,
  candidate_driver_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  planned_departure_at TIMESTAMPTZ NULL,
  planned_arrival_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','UNASSIGNED','BLOCKED','CANCELLED')),
  constraint_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((candidate_asset_id IS NULL) OR (candidate_composition_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_planned_trips_id_empresa_key
  ON public.campaign_planned_trips (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_planned_trips_plan_idx
  ON public.campaign_planned_trips (plan_version_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.campaign_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NOT NULL REFERENCES public.campaign_plan_versions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('APPROVE','REJECT')),
  actor_user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  client_request_id TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_approvals_one_approve_key
  ON public.campaign_approvals (plan_version_id, action)
  WHERE action = 'APPROVE';
CREATE UNIQUE INDEX IF NOT EXISTS campaign_approvals_client_request_key
  ON public.campaign_approvals (empresa_id, plan_version_id, actor_user_id, action, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_approvals_id_empresa_key
  ON public.campaign_approvals (id, empresa_id);

CREATE TABLE IF NOT EXISTS public.campaign_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NULL REFERENCES public.campaign_plan_versions(id) ON DELETE CASCADE,
  planned_trip_id UUID NULL REFERENCES public.campaign_planned_trips(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('INSUFFICIENT_CAPACITY','NO_DRIVER','VEHICLE_UNAVAILABLE','DOCUMENT_BLOCK','MAINTENANCE_CONFLICT','WINDOW_RISK','UNASSIGNED_TRIP')),
  severity TEXT NOT NULL CHECK (severity IN ('HARD_CONSTRAINT','WARNING','INFO')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  resolved_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  resolution_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_exceptions_id_empresa_key
  ON public.campaign_exceptions (id, empresa_id);
CREATE INDEX IF NOT EXISTS campaign_exceptions_campaign_status_idx
  ON public.campaign_exceptions (campaign_id, status, severity, created_at DESC);

-- Tenant-consistency FKs.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_id_empresa_key
  ON public.usuarios (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS unidades_operacionais_id_empresa_key
  ON public.unidades_operacionais (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS fleet_assets_id_empresa_key
  ON public.fleet_assets (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_compositions_id_empresa_key
  ON public.vehicle_compositions (id, empresa_id);

DO $$ BEGIN
  ALTER TABLE public.operation_campaigns
    ADD CONSTRAINT operation_campaigns_created_by_empresa_fk
    FOREIGN KEY (created_by, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE SET NULL (created_by);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.operation_campaigns
    ADD CONSTRAINT operation_campaigns_approved_plan_empresa_fk
    FOREIGN KEY (approved_plan_version_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, empresa_id)
    ON DELETE SET NULL (approved_plan_version_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_operational_units
    ADD CONSTRAINT campaign_units_campaign_empresa_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_operational_units
    ADD CONSTRAINT campaign_units_unit_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_locations
    ADD CONSTRAINT campaign_locations_campaign_empresa_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_locations
    ADD CONSTRAINT campaign_locations_unit_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE SET NULL (unidade_operacional_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_demands
    ADD CONSTRAINT campaign_demands_campaign_empresa_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_demands
    ADD CONSTRAINT campaign_demands_origin_empresa_fk
    FOREIGN KEY (origin_location_id, empresa_id)
    REFERENCES public.campaign_locations (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_demands
    ADD CONSTRAINT campaign_demands_destination_empresa_fk
    FOREIGN KEY (destination_location_id, empresa_id)
    REFERENCES public.campaign_locations (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_plan_versions
    ADD CONSTRAINT campaign_plan_versions_campaign_empresa_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_plan_scenarios
    ADD CONSTRAINT campaign_scenarios_plan_empresa_fk
    FOREIGN KEY (plan_version_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_plan_empresa_fk
    FOREIGN KEY (plan_version_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_scenario_empresa_fk
    FOREIGN KEY (scenario_id, empresa_id)
    REFERENCES public.campaign_plan_scenarios (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_origin_empresa_fk
    FOREIGN KEY (origin_location_id, empresa_id)
    REFERENCES public.campaign_locations (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_destination_empresa_fk
    FOREIGN KEY (destination_location_id, empresa_id)
    REFERENCES public.campaign_locations (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_demand_empresa_fk
    FOREIGN KEY (demand_id, empresa_id)
    REFERENCES public.campaign_demands (id, empresa_id)
    ON DELETE SET NULL (demand_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_asset_empresa_fk
    FOREIGN KEY (candidate_asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE SET NULL (candidate_asset_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_planned_trips
    ADD CONSTRAINT campaign_trips_comp_empresa_fk
    FOREIGN KEY (candidate_composition_id, empresa_id)
    REFERENCES public.vehicle_compositions (id, empresa_id)
    ON DELETE SET NULL (candidate_composition_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_approvals
    ADD CONSTRAINT campaign_approvals_plan_empresa_fk
    FOREIGN KEY (plan_version_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_approvals
    ADD CONSTRAINT campaign_approvals_actor_empresa_fk
    FOREIGN KEY (actor_user_id, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_exceptions
    ADD CONSTRAINT campaign_exceptions_plan_empresa_fk
    FOREIGN KEY (plan_version_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.campaign_exceptions
    ADD CONSTRAINT campaign_exceptions_trip_empresa_fk
    FOREIGN KEY (planned_trip_id, empresa_id)
    REFERENCES public.campaign_planned_trips (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.operation_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_operational_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_plan_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_planned_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_campaigns_tenant_access ON public.operation_campaigns;
CREATE POLICY operation_campaigns_tenant_access ON public.operation_campaigns
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_operational_units_tenant_access ON public.campaign_operational_units;
CREATE POLICY campaign_operational_units_tenant_access ON public.campaign_operational_units
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_locations_tenant_access ON public.campaign_locations;
CREATE POLICY campaign_locations_tenant_access ON public.campaign_locations
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_demands_tenant_access ON public.campaign_demands;
CREATE POLICY campaign_demands_tenant_access ON public.campaign_demands
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_plan_versions_tenant_access ON public.campaign_plan_versions;
CREATE POLICY campaign_plan_versions_tenant_access ON public.campaign_plan_versions
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_plan_scenarios_tenant_access ON public.campaign_plan_scenarios;
CREATE POLICY campaign_plan_scenarios_tenant_access ON public.campaign_plan_scenarios
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_planned_trips_tenant_access ON public.campaign_planned_trips;
CREATE POLICY campaign_planned_trips_tenant_access ON public.campaign_planned_trips
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_approvals_tenant_access ON public.campaign_approvals;
CREATE POLICY campaign_approvals_tenant_access ON public.campaign_approvals
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS campaign_exceptions_tenant_access ON public.campaign_exceptions;
CREATE POLICY campaign_exceptions_tenant_access ON public.campaign_exceptions
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

REVOKE ALL ON public.operation_campaigns FROM anon;
REVOKE ALL ON public.campaign_operational_units FROM anon;
REVOKE ALL ON public.campaign_locations FROM anon;
REVOKE ALL ON public.campaign_demands FROM anon;
REVOKE ALL ON public.campaign_plan_versions FROM anon;
REVOKE ALL ON public.campaign_plan_scenarios FROM anon;
REVOKE ALL ON public.campaign_planned_trips FROM anon;
REVOKE ALL ON public.campaign_approvals FROM anon;
REVOKE ALL ON public.campaign_exceptions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operation_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_operational_units TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_demands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_plan_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_plan_scenarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_planned_trips TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_approvals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_exceptions TO authenticated;

GRANT ALL ON public.operation_campaigns TO service_role;
GRANT ALL ON public.campaign_operational_units TO service_role;
GRANT ALL ON public.campaign_locations TO service_role;
GRANT ALL ON public.campaign_demands TO service_role;
GRANT ALL ON public.campaign_plan_versions TO service_role;
GRANT ALL ON public.campaign_plan_scenarios TO service_role;
GRANT ALL ON public.campaign_planned_trips TO service_role;
GRANT ALL ON public.campaign_approvals TO service_role;
GRANT ALL ON public.campaign_exceptions TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_operation_campaign_template_permissions_for_empresa(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl record;
  v_keys text[];
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio' USING ERRCODE = '23514';
  END IF;

  FOR v_tpl IN
    SELECT id, stable_key
      FROM public.permission_templates
     WHERE empresa_id = p_empresa_id
  LOOP
    v_keys := CASE v_tpl.stable_key
      WHEN 'administrador' THEN ARRAY['campaign.view','campaign.create','campaign.plan','campaign.approve','campaign.manage']
      WHEN 'gerente_frota' THEN ARRAY['campaign.view','campaign.create','campaign.plan','campaign.approve','campaign.manage']
      WHEN 'gerente_filial' THEN ARRAY['campaign.view','campaign.create','campaign.plan','campaign.approve']
      WHEN 'gerente_regional' THEN ARRAY['campaign.view','campaign.create','campaign.plan','campaign.approve']
      WHEN 'gerente_nacional' THEN ARRAY['campaign.view','campaign.create','campaign.plan','campaign.approve']
      WHEN 'operador' THEN ARRAY['campaign.view','campaign.create','campaign.plan']
      ELSE ARRAY[]::text[]
    END;

    INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
    SELECT v_tpl.id, key, true FROM unnest(v_keys) AS key
    ON CONFLICT (template_id, permission_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_operation_campaign_template_permissions_for_empresa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_operation_campaign_template_permissions_for_empresa(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_operation_campaign_template_permissions_for_empresa(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_operation_campaign_template_permissions_for_empresa(uuid) TO service_role;

DO $$
DECLARE
  v_emp uuid;
BEGIN
  FOR v_emp IN SELECT id FROM public.empresas LOOP
    PERFORM public.ensure_operation_campaign_template_permissions_for_empresa(v_emp);
  END LOOP;
END $$;

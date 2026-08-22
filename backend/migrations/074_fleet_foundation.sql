-- Migration 074: Onda 2 Fleet Foundation.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_FLEET.
--
-- Escopo:
--   * ativos de frota, composicoes e membros temporais;
--   * vinculo temporal motorista -> ativo/composicao;
--   * vinculo temporal frete -> ativo/composicao/motoristas;
--   * documentos de ativo, eventos de odometro, pneus e manutencao.
--
-- Aditiva e idempotente. Nao altera fretes legados, nao migra fotos de odometro
-- existentes e nao toca Storage/env.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH upsert_func AS (
  INSERT INTO public.funcionalidades
    (codigo, nome, descricao_publica, categoria, modulo, status_ciclo_vida,
     modelo_cobranca, ativo, visivel_publicamente, ordem_exibicao)
  VALUES
    ('fleet', 'Frota',
     'Ativos, composições, vínculos temporais, pneus e manutenção.', 'operacao', 'fleet',
     'disponivel', 'incluso', true, true, 240)
  ON CONFLICT (codigo) DO UPDATE SET
    nome = EXCLUDED.nome,
    descricao_publica = EXCLUDED.descricao_publica,
    categoria = EXCLUDED.categoria,
    modulo = EXCLUDED.modulo,
    status_ciclo_vida = EXCLUDED.status_ciclo_vida,
    modelo_cobranca = EXCLUDED.modelo_cobranca,
    ativo = true,
    visivel_publicamente = true,
    atualizado_em = now()
  RETURNING id, codigo, nome
),
funcs AS (
  SELECT id, codigo, nome FROM upsert_func
  UNION
  SELECT id, codigo, nome FROM public.funcionalidades WHERE codigo = 'fleet'
),
planos_alvo AS (
  SELECT id FROM public.planos WHERE categoria IN ('empresa', 'ambos')
)
INSERT INTO public.plano_funcionalidades
  (plano_id, funcionalidade_id, disponibilidade, exibir_no_card, texto_publico, ordem_exibicao)
SELECT p.id, f.id, 'incluida', true, f.nome, 240
FROM planos_alvo p
CROSS JOIN funcs f
ON CONFLICT (plano_id, funcionalidade_id) DO UPDATE SET
  disponibilidade = EXCLUDED.disponibilidade,
  exibir_no_card = EXCLUDED.exibir_no_card,
  texto_publico = EXCLUDED.texto_publico,
  ordem_exibicao = EXCLUDED.ordem_exibicao,
  atualizado_em = now();

CREATE TABLE IF NOT EXISTS public.fleet_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  unidade_operacional_id UUID NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('truck','tractor','semitrailer','trailer','dolly','implement','other')),
  plate TEXT NULL,
  internal_identifier TEXT NOT NULL,
  brand TEXT NULL,
  model TEXT NULL,
  model_year INTEGER NULL CHECK (model_year IS NULL OR (model_year BETWEEN 1950 AND 2100)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance','sold','archived')),
  useful_capacity_kg NUMERIC(12,2) NULL CHECK (useful_capacity_kg IS NULL OR useful_capacity_kg >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fleet_assets_empresa_internal_identifier_key
  ON public.fleet_assets (empresa_id, lower(internal_identifier));
CREATE UNIQUE INDEX IF NOT EXISTS fleet_assets_empresa_plate_key
  ON public.fleet_assets (empresa_id, upper(plate))
  WHERE plate IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_assets_empresa_status_type_idx
  ON public.fleet_assets (empresa_id, status, asset_type);

CREATE TABLE IF NOT EXISTS public.vehicle_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  unidade_operacional_id UUID NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_compositions_empresa_code_key
  ON public.vehicle_compositions (empresa_id, lower(code));
CREATE INDEX IF NOT EXISTS vehicle_compositions_empresa_status_idx
  ON public.vehicle_compositions (empresa_id, status);

CREATE TABLE IF NOT EXISTS public.vehicle_composition_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  composition_id UUID NOT NULL REFERENCES public.vehicle_compositions(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  member_role TEXT NOT NULL CHECK (member_role IN ('primary_power','trailer','dolly','implement','accessory')),
  position_order INTEGER NOT NULL DEFAULT 1 CHECK (position_order > 0),
  position_label TEXT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NULL,
  ended_reason TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_composition_members_active_asset_key
  ON public.vehicle_composition_members (asset_id)
  WHERE valid_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_composition_members_active_pair_key
  ON public.vehicle_composition_members (composition_id, asset_id)
  WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS vehicle_composition_members_composition_idx
  ON public.vehicle_composition_members (composition_id, valid_until, position_order);
CREATE INDEX IF NOT EXISTS vehicle_composition_members_empresa_idx
  ON public.vehicle_composition_members (empresa_id, valid_until);

CREATE TABLE IF NOT EXISTS public.driver_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  composition_id UUID NULL REFERENCES public.vehicle_compositions(id) ON DELETE RESTRICT,
  assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('active','ended')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NULL,
  ended_reason TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((asset_id IS NULL) <> (composition_id IS NULL)),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_vehicle_assignments_active_driver_key
  ON public.driver_vehicle_assignments (driver_id)
  WHERE valid_until IS NULL AND assignment_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS driver_vehicle_assignments_active_asset_key
  ON public.driver_vehicle_assignments (asset_id)
  WHERE asset_id IS NOT NULL AND valid_until IS NULL AND assignment_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS driver_vehicle_assignments_active_composition_key
  ON public.driver_vehicle_assignments (composition_id)
  WHERE composition_id IS NOT NULL AND valid_until IS NULL AND assignment_status = 'active';
CREATE INDEX IF NOT EXISTS driver_vehicle_assignments_empresa_idx
  ON public.driver_vehicle_assignments (empresa_id, valid_until, driver_id);

CREATE TABLE IF NOT EXISTS public.freight_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  frete_id UUID NOT NULL REFERENCES public.fretes(id) ON DELETE CASCADE,
  asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  composition_id UUID NULL REFERENCES public.vehicle_compositions(id) ON DELETE RESTRICT,
  primary_driver_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  secondary_driver_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('active','replaced','ended')),
  assigned_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_until TIMESTAMPTZ NULL,
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((asset_id IS NULL) <> (composition_id IS NULL)),
  CHECK (assigned_until IS NULL OR assigned_until > assigned_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS freight_vehicle_assignments_active_frete_key
  ON public.freight_vehicle_assignments (frete_id)
  WHERE assigned_until IS NULL AND assignment_status = 'active';
CREATE INDEX IF NOT EXISTS freight_vehicle_assignments_empresa_idx
  ON public.freight_vehicle_assignments (empresa_id, assigned_until, frete_id);

CREATE TABLE IF NOT EXISTS public.asset_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.fleet_assets(id) ON DELETE CASCADE,
  document_category TEXT NOT NULL DEFAULT 'VEHICLE_DOCUMENT' CHECK (document_category = 'VEHICLE_DOCUMENT'),
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  issued_at DATE NULL,
  expires_at DATE NULL,
  client_request_id TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_documents_client_request_key
  ON public.asset_documents (asset_id, created_by, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_documents_empresa_asset_idx
  ON public.asset_documents (empresa_id, asset_id, status, expires_at);

CREATE TABLE IF NOT EXISTS public.odometer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  frete_id UUID NULL REFERENCES public.fretes(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('check_in','check_out','manual','correction')),
  reading_km NUMERIC(12,1) NOT NULL CHECK (reading_km >= 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  photo_path TEXT NULL,
  source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('api','app','web','migration','correction')),
  recorded_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS odometer_events_asset_time_idx
  ON public.odometer_events (asset_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS odometer_events_frete_idx
  ON public.odometer_events (frete_id)
  WHERE frete_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fire_number TEXT NOT NULL,
  brand TEXT NULL,
  model TEXT NULL,
  size TEXT NULL,
  purchase_date DATE NULL,
  purchase_value NUMERIC(12,2) NULL CHECK (purchase_value IS NULL OR purchase_value >= 0),
  status TEXT NOT NULL DEFAULT 'stock' CHECK (status IN ('stock','installed','retread','retired','lost')),
  current_asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tires_empresa_fire_number_key
  ON public.tires (empresa_id, lower(fire_number));
CREATE INDEX IF NOT EXISTS tires_empresa_status_idx
  ON public.tires (empresa_id, status, current_asset_id);

CREATE TABLE IF NOT EXISTS public.tire_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tire_id UUID NOT NULL REFERENCES public.tires(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  position_label TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  installed_km NUMERIC(12,1) NULL CHECK (installed_km IS NULL OR installed_km >= 0),
  removed_at TIMESTAMPTZ NULL,
  removed_km NUMERIC(12,1) NULL CHECK (removed_km IS NULL OR removed_km >= 0),
  removal_reason TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (removed_at IS NULL OR removed_at > installed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS tire_installations_active_tire_key
  ON public.tire_installations (tire_id)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tire_installations_active_position_key
  ON public.tire_installations (asset_id, lower(position_label))
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS tire_installations_empresa_idx
  ON public.tire_installations (empresa_id, asset_id, removed_at);

CREATE TABLE IF NOT EXISTS public.tire_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tire_id UUID NOT NULL REFERENCES public.tires(id) ON DELETE CASCADE,
  asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('install','remove','retread','inspection','repair','retire')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  odometer_km NUMERIC(12,1) NULL CHECK (odometer_km IS NULL OR odometer_km >= 0),
  cost NUMERIC(12,2) NULL CHECK (cost IS NULL OR cost >= 0),
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tire_events_tire_time_idx
  ON public.tire_events (tire_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.maintenance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  maintenance_type TEXT NOT NULL CHECK (maintenance_type IN ('preventive','corrective')),
  category TEXT NOT NULL CHECK (category IN ('engine','transmission','oil','filters','brake','suspension','electrical','tires','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','completed','cancelled')),
  work_order TEXT NULL,
  supplier TEXT NULL,
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost NUMERIC(12,2) NULL CHECK (cost IS NULL OR cost >= 0),
  odometer_km NUMERIC(12,1) NULL CHECK (odometer_km IS NULL OR odometer_km >= 0),
  scheduled_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  downtime_minutes INTEGER NULL CHECK (downtime_minutes IS NULL OR downtime_minutes >= 0),
  notes TEXT NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_events_asset_time_idx
  ON public.maintenance_events (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_events_empresa_status_idx
  ON public.maintenance_events (empresa_id, status, category);

-- Tenant-consistency FKs: ids globais garantem existencia; os pares (id, empresa_id)
-- garantem que relacionamentos Fleet nao apontem para objetos de outro tenant.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_id_empresa_key
  ON public.usuarios (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS fretes_id_empresa_key
  ON public.fretes (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS fleet_assets_id_empresa_key
  ON public.fleet_assets (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_compositions_id_empresa_key
  ON public.vehicle_compositions (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS tires_id_empresa_key
  ON public.tires (id, empresa_id);

DO $$ BEGIN
  ALTER TABLE public.fleet_assets
    ADD CONSTRAINT fleet_assets_unit_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE SET NULL (unidade_operacional_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vehicle_compositions
    ADD CONSTRAINT veh_comp_unit_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE SET NULL (unidade_operacional_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vehicle_composition_members
    ADD CONSTRAINT veh_comp_members_comp_empresa_fk
    FOREIGN KEY (composition_id, empresa_id)
    REFERENCES public.vehicle_compositions (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vehicle_composition_members
    ADD CONSTRAINT veh_comp_members_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.driver_vehicle_assignments
    ADD CONSTRAINT driver_assign_driver_empresa_fk
    FOREIGN KEY (driver_id, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.driver_vehicle_assignments
    ADD CONSTRAINT driver_assign_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.driver_vehicle_assignments
    ADD CONSTRAINT driver_assign_comp_empresa_fk
    FOREIGN KEY (composition_id, empresa_id)
    REFERENCES public.vehicle_compositions (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.freight_vehicle_assignments
    ADD CONSTRAINT freight_assign_frete_empresa_fk
    FOREIGN KEY (frete_id, empresa_id)
    REFERENCES public.fretes (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.freight_vehicle_assignments
    ADD CONSTRAINT freight_assign_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.freight_vehicle_assignments
    ADD CONSTRAINT freight_assign_comp_empresa_fk
    FOREIGN KEY (composition_id, empresa_id)
    REFERENCES public.vehicle_compositions (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.freight_vehicle_assignments
    ADD CONSTRAINT freight_assign_primary_driver_empresa_fk
    FOREIGN KEY (primary_driver_id, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE SET NULL (primary_driver_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.freight_vehicle_assignments
    ADD CONSTRAINT freight_assign_secondary_driver_empresa_fk
    FOREIGN KEY (secondary_driver_id, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE SET NULL (secondary_driver_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_documents
    ADD CONSTRAINT asset_docs_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.odometer_events
    ADD CONSTRAINT odometer_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.odometer_events
    ADD CONSTRAINT odometer_frete_empresa_fk
    FOREIGN KEY (frete_id, empresa_id)
    REFERENCES public.fretes (id, empresa_id)
    ON DELETE SET NULL (frete_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tires
    ADD CONSTRAINT tires_current_asset_empresa_fk
    FOREIGN KEY (current_asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE SET NULL (current_asset_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tire_installations
    ADD CONSTRAINT tire_inst_tire_empresa_fk
    FOREIGN KEY (tire_id, empresa_id)
    REFERENCES public.tires (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tire_installations
    ADD CONSTRAINT tire_inst_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tire_events
    ADD CONSTRAINT tire_events_tire_empresa_fk
    FOREIGN KEY (tire_id, empresa_id)
    REFERENCES public.tires (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tire_events
    ADD CONSTRAINT tire_events_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE SET NULL (asset_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.maintenance_events
    ADD CONSTRAINT maintenance_asset_empresa_fk
    FOREIGN KEY (asset_id, empresa_id)
    REFERENCES public.fleet_assets (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.fleet_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_composition_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freight_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odometer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tire_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tire_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_assets_tenant_access ON public.fleet_assets;
CREATE POLICY fleet_assets_tenant_access ON public.fleet_assets
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS vehicle_compositions_tenant_access ON public.vehicle_compositions;
CREATE POLICY vehicle_compositions_tenant_access ON public.vehicle_compositions
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS vehicle_composition_members_tenant_access ON public.vehicle_composition_members;
CREATE POLICY vehicle_composition_members_tenant_access ON public.vehicle_composition_members
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS driver_vehicle_assignments_tenant_access ON public.driver_vehicle_assignments;
CREATE POLICY driver_vehicle_assignments_tenant_access ON public.driver_vehicle_assignments
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS freight_vehicle_assignments_tenant_access ON public.freight_vehicle_assignments;
CREATE POLICY freight_vehicle_assignments_tenant_access ON public.freight_vehicle_assignments
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS asset_documents_tenant_access ON public.asset_documents;
CREATE POLICY asset_documents_tenant_access ON public.asset_documents
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS odometer_events_tenant_access ON public.odometer_events;
CREATE POLICY odometer_events_tenant_access ON public.odometer_events
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS tires_tenant_access ON public.tires;
CREATE POLICY tires_tenant_access ON public.tires
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS tire_installations_tenant_access ON public.tire_installations;
CREATE POLICY tire_installations_tenant_access ON public.tire_installations
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS tire_events_tenant_access ON public.tire_events;
CREATE POLICY tire_events_tenant_access ON public.tire_events
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

DROP POLICY IF EXISTS maintenance_events_tenant_access ON public.maintenance_events;
CREATE POLICY maintenance_events_tenant_access ON public.maintenance_events
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

REVOKE ALL ON public.fleet_assets FROM anon;
REVOKE ALL ON public.vehicle_compositions FROM anon;
REVOKE ALL ON public.vehicle_composition_members FROM anon;
REVOKE ALL ON public.driver_vehicle_assignments FROM anon;
REVOKE ALL ON public.freight_vehicle_assignments FROM anon;
REVOKE ALL ON public.asset_documents FROM anon;
REVOKE ALL ON public.odometer_events FROM anon;
REVOKE ALL ON public.tires FROM anon;
REVOKE ALL ON public.tire_installations FROM anon;
REVOKE ALL ON public.tire_events FROM anon;
REVOKE ALL ON public.maintenance_events FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_compositions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_composition_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_vehicle_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.freight_vehicle_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odometer_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tires TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tire_installations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tire_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_events TO authenticated;

GRANT ALL ON public.fleet_assets TO service_role;
GRANT ALL ON public.vehicle_compositions TO service_role;
GRANT ALL ON public.vehicle_composition_members TO service_role;
GRANT ALL ON public.driver_vehicle_assignments TO service_role;
GRANT ALL ON public.freight_vehicle_assignments TO service_role;
GRANT ALL ON public.asset_documents TO service_role;
GRANT ALL ON public.odometer_events TO service_role;
GRANT ALL ON public.tires TO service_role;
GRANT ALL ON public.tire_installations TO service_role;
GRANT ALL ON public.tire_events TO service_role;
GRANT ALL ON public.maintenance_events TO service_role;

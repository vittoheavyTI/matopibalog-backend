-- e38_production_shape_fixture.sql
--
-- Fixture DEDICADA e ISOLADA para a suite de testes E3.8 (Unified Audit & Digital Envelope).
-- NAO incluir no bootstrap compartilhado (00_bootstrap_pre.sql) para evitar regressoes
-- em suites de testes historicas (076, 077, 078, 079, 082, etc.).
--
-- Cria exclusivamente as tabelas com shape exato de producao para as fontes de auditoria
-- que nao sao criadas pelas migrations canonicas anteriores a 085.

CREATE TABLE IF NOT EXISTS public.frete_documentos (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  frete_id uuid NOT NULL REFERENCES public.fretes(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  tipo text NOT NULL DEFAULT 'canhoto',
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.frete_documento_eventos (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.frete_documentos(id) ON DELETE CASCADE,
  frete_id uuid NOT NULL REFERENCES public.fretes(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  evento text NOT NULL,
  actor_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_role text NULL,
  source text NOT NULL DEFAULT 'api',
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_network_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_partner_user_id uuid NULL,
  source text NOT NULL DEFAULT 'web',
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_exceptions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL,
  plan_version_id uuid NULL,
  planned_trip_id uuid NULL,
  exception_type text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  resolved_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  resolution_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.odometer_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL,
  frete_id uuid NULL REFERENCES public.fretes(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  reading_km numeric(10,2) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  photo_path text NULL,
  source text NOT NULL DEFAULT 'api',
  recorded_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL,
  maintenance_type text NOT NULL,
  category text NULL,
  status text NOT NULL DEFAULT 'open',
  work_order text NULL,
  supplier text NULL,
  parts jsonb NULL,
  cost numeric(12,2) NULL,
  odometer_km numeric(10,2) NULL,
  scheduled_at timestamptz NULL,
  completed_at timestamptz NULL,
  downtime_minutes integer NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.frete_documentos,
  public.frete_documento_eventos,
  public.partner_network_events,
  public.campaign_exceptions,
  public.odometer_events,
  public.maintenance_events
TO service_role;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.frete_envelopes_digitais FROM service_role;

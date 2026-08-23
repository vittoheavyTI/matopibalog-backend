-- Migration 077: reconcile production payload drift from 076.
--
-- Scope:
--   * Replace only campaign_exceptions_plan_campaign_fk with the canonical
--     Campaign-A triple relationship from migration 076 HEAD.
--
-- No tables, columns, RLS, grants, functions, feature rows, commercial mapping,
-- business data, Fleet, Freight, billing, storage, or environment changes.

ALTER TABLE public.campaign_exceptions
  DROP CONSTRAINT IF EXISTS campaign_exceptions_plan_campaign_fk;

ALTER TABLE public.campaign_exceptions
  ADD CONSTRAINT campaign_exceptions_plan_campaign_fk
  FOREIGN KEY (plan_version_id, campaign_id, empresa_id)
  REFERENCES public.campaign_plan_versions (id, campaign_id, empresa_id)
  ON DELETE CASCADE;

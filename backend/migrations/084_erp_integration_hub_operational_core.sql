-- 084_erp_integration_hub_operational_core.sql
-- E3.7B: persistent ERP Integration Hub operational core.
--
-- Additive only. No provider real, no secrets, no business event wiring and no
-- production business DML. The objects are backend-mediated and service_role-only.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.erp_outbox (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 80),
  event_id text NOT NULL CHECK (length(trim(event_id)) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (length(trim(event_type)) BETWEEN 1 AND 80),
  dedupe_key text NOT NULL CHECK (length(trim(dedupe_key)) BETWEEN 1 AND 240),
  intent_fingerprint text NOT NULL CHECK (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_envelope jsonb NOT NULL CHECK (jsonb_typeof(canonical_envelope) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','failed','succeeded','unknown','dead')),
  next_action text NULL CHECK (next_action IS NULL OR next_action IN ('SEND','RECONCILE')),
  claim_action text NULL CHECK (claim_action IS NULL OR claim_action IN ('SEND','RECONCILE')),
  claim_token uuid NULL,
  claim_authority text NULL CHECK (claim_authority IS NULL OR length(claim_authority) <= 120),
  lease_expires_at timestamptz NULL,
  send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  reconcile_attempts integer NOT NULL DEFAULT 0 CHECK (reconcile_attempts >= 0),
  max_send_attempts integer NOT NULL DEFAULT 8 CHECK (max_send_attempts > 0 AND max_send_attempts <= 100),
  max_reconcile_attempts integer NOT NULL DEFAULT 8 CHECK (max_reconcile_attempts > 0 AND max_reconcile_attempts <= 100),
  retry_authorized boolean NOT NULL DEFAULT false,
  retry_safe_evidence jsonb NULL CHECK (retry_safe_evidence IS NULL OR jsonb_typeof(retry_safe_evidence) = 'object'),
  next_retry_at timestamptz NULL,
  last_reconcile_status text NULL CHECK (
    last_reconcile_status IS NULL OR last_reconcile_status IN ('SUCCEEDED','NOT_FOUND','PENDING','UNKNOWN','FAILED')
  ),
  blocked_reason text NULL CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 160),
  sanitized_failure_info text NULL CHECK (sanitized_failure_info IS NULL OR length(sanitized_failure_info) <= 500),
  external_reference text NULL CHECK (external_reference IS NULL OR length(external_reference) <= 240),
  external_result jsonb NULL CHECK (external_result IS NULL OR jsonb_typeof(external_result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  CONSTRAINT erp_outbox_logical_event_key UNIQUE (empresa_id, provider, event_id),
  CONSTRAINT erp_outbox_dedupe_key UNIQUE (empresa_id, provider, dedupe_key),
  CHECK ((status = 'succeeded') = (processed_at IS NOT NULL)),
  CHECK ((claim_token IS NULL AND claim_action IS NULL) OR status = 'processing'),
  CHECK ((status IN ('pending','failed','unknown')) OR next_action IS NULL OR status = 'processing')
);

CREATE INDEX IF NOT EXISTS ix_erp_outbox_claim_send
  ON public.erp_outbox (status, next_action, next_retry_at, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS ix_erp_outbox_claim_reconcile_expired
  ON public.erp_outbox (status, lease_expires_at, created_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS ix_erp_outbox_empresa_status
  ON public.erp_outbox (empresa_id, status, created_at);

ALTER TABLE public.erp_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.erp_external_identity_mappings (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 80),
  entity_type text NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 80),
  internal_entity_id text NOT NULL CHECK (length(trim(internal_entity_id)) BETWEEN 1 AND 240),
  external_entity_id text NOT NULL CHECK (length(trim(external_entity_id)) BETWEEN 1 AND 240),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  rebind_reason text NULL CHECK (rebind_reason IS NULL OR length(rebind_reason) BETWEEN 4 AND 500),
  rebound_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_external_identity_internal_key UNIQUE (empresa_id, provider, entity_type, internal_entity_id),
  CONSTRAINT erp_external_identity_external_key UNIQUE (empresa_id, provider, entity_type, external_entity_id)
);

CREATE INDEX IF NOT EXISTS ix_erp_external_identity_empresa_provider
  ON public.erp_external_identity_mappings (empresa_id, provider, entity_type);

ALTER TABLE public.erp_external_identity_mappings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.erp_sanitize_failure(p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_message IS NULL THEN NULL
    ELSE left(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(p_message, '\mBearer\s+\S+', 'Bearer [secret]', 'gi'),
            '([?&](token|key|api_?key|secret|password|senha|access_token)=)[^[:space:]&#]+',
            '\1[secret]',
            'gi'
          ),
          'https?://\S+',
          '[url]',
          'gi'
        ),
        '\m[0-9a-fA-F]{20,}\M',
        '[token]',
        'g'
      ),
      500
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.erp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_erp_outbox_touch_updated_at ON public.erp_outbox;
CREATE TRIGGER trg_erp_outbox_touch_updated_at
BEFORE UPDATE ON public.erp_outbox
FOR EACH ROW EXECUTE FUNCTION public.erp_touch_updated_at();

DROP TRIGGER IF EXISTS trg_erp_external_identity_touch_updated_at ON public.erp_external_identity_mappings;
CREATE TRIGGER trg_erp_external_identity_touch_updated_at
BEFORE UPDATE ON public.erp_external_identity_mappings
FOR EACH ROW EXECUTE FUNCTION public.erp_touch_updated_at();

CREATE OR REPLACE FUNCTION public.erp_enqueue_outbox(
  p_empresa_id uuid,
  p_provider text,
  p_envelope jsonb,
  p_intent_fingerprint text,
  p_dedupe_key text,
  p_max_send_attempts integer DEFAULT 8,
  p_max_reconcile_attempts integer DEFAULT 8
)
RETURNS TABLE (
  code text,
  item_id uuid,
  status text,
  intent_fingerprint text,
  dedupe_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_envelope_empresa_id uuid;
  v_event_id text;
  v_event_type text;
  v_inserted public.erp_outbox%ROWTYPE;
  v_existing public.erp_outbox%ROWTYPE;
BEGIN
  IF p_empresa_id IS NULL THEN
    RETURN QUERY SELECT 'invalid_empresa_id', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;
  IF p_provider IS NULL OR trim(p_provider) = '' THEN
    RETURN QUERY SELECT 'invalid_provider', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_envelope', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;
  IF p_intent_fingerprint IS NULL OR p_intent_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid_intent_fingerprint', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;
  IF p_dedupe_key IS NULL OR trim(p_dedupe_key) = '' THEN
    RETURN QUERY SELECT 'invalid_dedupe_key', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;

  BEGIN
    v_envelope_empresa_id := (p_envelope->>'empresa_id')::uuid;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 'invalid_empresa_id', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END;
  v_event_id := p_envelope->>'event_id';
  v_event_type := p_envelope->>'event_type';
  IF v_envelope_empresa_id IS NULL OR COALESCE(trim(v_event_id), '') = '' OR COALESCE(trim(v_event_type), '') = '' THEN
    RETURN QUERY SELECT 'invalid_envelope_authority', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;
  IF v_envelope_empresa_id IS DISTINCT FROM p_empresa_id THEN
    RETURN QUERY SELECT 'tenant_mismatch', NULL::uuid, NULL::text, p_intent_fingerprint, p_dedupe_key;
    RETURN;
  END IF;

  INSERT INTO public.erp_outbox (
    empresa_id, provider, event_id, event_type, dedupe_key, intent_fingerprint,
    canonical_envelope, status, next_action, max_send_attempts, max_reconcile_attempts
  )
  VALUES (
    p_empresa_id, p_provider, v_event_id, v_event_type, p_dedupe_key, p_intent_fingerprint,
    p_envelope, 'pending', 'SEND', COALESCE(p_max_send_attempts, 8), COALESCE(p_max_reconcile_attempts, 8)
  )
  ON CONFLICT ON CONSTRAINT erp_outbox_logical_event_key DO NOTHING
  RETURNING * INTO v_inserted;

  IF v_inserted.id IS NOT NULL THEN
    RETURN QUERY SELECT 'inserted', v_inserted.id, v_inserted.status, v_inserted.intent_fingerprint, v_inserted.dedupe_key;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.erp_outbox
  WHERE empresa_id = p_empresa_id AND provider = p_provider AND event_id = v_event_id;

  IF v_existing.intent_fingerprint = p_intent_fingerprint THEN
    RETURN QUERY SELECT 'duplicate', v_existing.id, v_existing.status, v_existing.intent_fingerprint, v_existing.dedupe_key;
  ELSE
    RETURN QUERY SELECT 'idempotency_conflict', v_existing.id, v_existing.status, v_existing.intent_fingerprint, v_existing.dedupe_key;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_claim_next_outbox(
  p_action text,
  p_claim_authority text DEFAULT 'worker',
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  code text,
  item_id uuid,
  claim_token uuid,
  claim_action text,
  status text,
  send_attempts integer,
  reconcile_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_action text := upper(COALESCE(p_action, ''));
  v_now timestamptz := now();
  v_claim uuid := extensions.gen_random_uuid();
  v_item public.erp_outbox%ROWTYPE;
BEGIN
  IF v_action NOT IN ('SEND','RECONCILE') THEN
    RETURN QUERY SELECT 'invalid_action', NULL::uuid, NULL::uuid, v_action, NULL::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  WITH candidate AS (
    SELECT e.id
    FROM public.erp_outbox e
    WHERE
      (
        v_action = 'SEND'
        AND e.status IN ('pending','failed')
        AND e.next_action = 'SEND'
        AND e.send_attempts < e.max_send_attempts
        AND (e.next_retry_at IS NULL OR e.next_retry_at <= v_now)
      )
      OR (
        v_action = 'RECONCILE'
        AND (
          (
            e.status IN ('failed','unknown')
            AND e.next_action = 'RECONCILE'
            AND e.reconcile_attempts < e.max_reconcile_attempts
            AND (e.next_retry_at IS NULL OR e.next_retry_at <= v_now)
          )
          OR (
            e.status = 'processing'
            AND e.lease_expires_at IS NOT NULL
            AND e.lease_expires_at <= v_now
            AND e.reconcile_attempts < e.max_reconcile_attempts
          )
        )
      )
    ORDER BY e.created_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.erp_outbox o
  SET status = 'processing',
      claim_action = v_action,
      claim_token = v_claim,
      claim_authority = left(COALESCE(NULLIF(p_claim_authority, ''), 'worker'), 120),
      lease_expires_at = v_now + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 300), 1)),
      send_attempts = CASE WHEN v_action = 'SEND' THEN o.send_attempts + 1 ELSE o.send_attempts END,
      reconcile_attempts = CASE WHEN v_action = 'RECONCILE' THEN o.reconcile_attempts + 1 ELSE o.reconcile_attempts END,
      sanitized_failure_info = NULL
  FROM candidate
  WHERE o.id = candidate.id
  RETURNING o.* INTO v_item;

  IF v_item.id IS NULL THEN
    RETURN QUERY SELECT 'empty', NULL::uuid, NULL::uuid, v_action, NULL::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'claimed', v_item.id, v_claim, v_action, v_item.status, v_item.send_attempts, v_item.reconcile_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_mark_outbox_succeeded(
  p_item_id uuid,
  p_claim_token uuid,
  p_external_reference text DEFAULT NULL,
  p_external_result jsonb DEFAULT NULL
)
RETURNS TABLE (code text, item_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item public.erp_outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.erp_outbox WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RETURN QUERY SELECT 'not_found', p_item_id, NULL::text; RETURN; END IF;
  IF v_item.status = 'succeeded' THEN RETURN QUERY SELECT 'already_succeeded', p_item_id, v_item.status; RETURN; END IF;
  IF v_item.status <> 'processing' THEN RETURN QUERY SELECT 'invalid_state', p_item_id, v_item.status; RETURN; END IF;
  IF v_item.claim_token IS DISTINCT FROM p_claim_token THEN RETURN QUERY SELECT 'stale_claim', p_item_id, v_item.status; RETURN; END IF;
  IF v_item.claim_action <> 'SEND' THEN RETURN QUERY SELECT 'invalid_claim_action', p_item_id, v_item.status; RETURN; END IF;

  UPDATE public.erp_outbox
  SET status = 'succeeded',
      next_action = NULL,
      claim_action = NULL,
      claim_token = NULL,
      claim_authority = NULL,
      lease_expires_at = NULL,
      retry_authorized = false,
      retry_safe_evidence = NULL,
      next_retry_at = NULL,
      blocked_reason = NULL,
      sanitized_failure_info = NULL,
      external_reference = NULL,
      external_result = NULL,
      processed_at = now()
  WHERE id = p_item_id;
  RETURN QUERY SELECT 'succeeded', p_item_id, 'succeeded';
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_mark_outbox_failed(
  p_item_id uuid,
  p_claim_token uuid,
  p_failure text,
  p_retry_safe boolean DEFAULT false,
  p_retry_safe_evidence jsonb DEFAULT NULL
)
RETURNS TABLE (code text, item_id uuid, status text, next_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item public.erp_outbox%ROWTYPE;
  v_dead boolean;
  v_next text;
BEGIN
  SELECT * INTO v_item FROM public.erp_outbox WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RETURN QUERY SELECT 'not_found', p_item_id, NULL::text, NULL::text; RETURN; END IF;
  IF v_item.status <> 'processing' THEN RETURN QUERY SELECT 'invalid_state', p_item_id, v_item.status, v_item.next_action; RETURN; END IF;
  IF v_item.claim_token IS DISTINCT FROM p_claim_token THEN RETURN QUERY SELECT 'stale_claim', p_item_id, v_item.status, v_item.next_action; RETURN; END IF;

  v_dead := CASE
    WHEN v_item.claim_action = 'SEND' THEN v_item.send_attempts >= v_item.max_send_attempts
    ELSE v_item.reconcile_attempts >= v_item.max_reconcile_attempts
  END;
  v_next := CASE
    WHEN v_dead THEN NULL
    WHEN v_item.claim_action = 'SEND' AND p_retry_safe THEN 'SEND'
    ELSE 'RECONCILE'
  END;

  UPDATE public.erp_outbox
  SET status = CASE WHEN v_dead THEN 'dead' ELSE 'failed' END,
      next_action = v_next,
      claim_action = NULL,
      claim_token = NULL,
      claim_authority = NULL,
      lease_expires_at = NULL,
      retry_authorized = (v_item.claim_action = 'SEND' AND p_retry_safe AND NOT v_dead),
      retry_safe_evidence = CASE WHEN p_retry_safe THEN COALESCE(p_retry_safe_evidence, '{}'::jsonb) ELSE NULL END,
      next_retry_at = CASE WHEN v_dead THEN NULL ELSE now() END,
      blocked_reason = CASE
        WHEN v_dead AND v_item.claim_action = 'SEND' THEN 'max_send_attempts'
        WHEN v_dead THEN 'max_reconcile_attempts'
        WHEN v_item.claim_action = 'SEND' AND NOT p_retry_safe THEN 'send_failed_sem_evidencia'
        WHEN v_item.claim_action = 'SEND' THEN NULL
        ELSE 'reconcile_falhou'
      END,
      sanitized_failure_info = public.erp_sanitize_failure(p_failure)
  WHERE id = p_item_id;

  RETURN QUERY SELECT CASE WHEN v_dead THEN 'dead' ELSE 'failed' END, p_item_id, CASE WHEN v_dead THEN 'dead' ELSE 'failed' END, v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_record_outbox_reconcile(
  p_item_id uuid,
  p_claim_token uuid,
  p_reconcile_status text,
  p_retry_safe boolean DEFAULT false,
  p_retry_safe_evidence jsonb DEFAULT NULL
)
RETURNS TABLE (code text, item_id uuid, status text, next_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item public.erp_outbox%ROWTYPE;
  v_status text := upper(COALESCE(p_reconcile_status, 'UNKNOWN'));
  v_dead boolean;
  v_next text;
BEGIN
  IF v_status NOT IN ('SUCCEEDED','NOT_FOUND','PENDING','UNKNOWN','FAILED') THEN
    v_status := 'UNKNOWN';
  END IF;
  SELECT * INTO v_item FROM public.erp_outbox WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RETURN QUERY SELECT 'not_found', p_item_id, NULL::text, NULL::text; RETURN; END IF;
  IF v_item.status <> 'processing' THEN RETURN QUERY SELECT 'invalid_state', p_item_id, v_item.status, v_item.next_action; RETURN; END IF;
  IF v_item.claim_token IS DISTINCT FROM p_claim_token THEN RETURN QUERY SELECT 'stale_claim', p_item_id, v_item.status, v_item.next_action; RETURN; END IF;
  IF v_item.claim_action <> 'RECONCILE' THEN RETURN QUERY SELECT 'invalid_claim_action', p_item_id, v_item.status, v_item.next_action; RETURN; END IF;

  IF v_status = 'SUCCEEDED' THEN
    UPDATE public.erp_outbox
    SET status = 'succeeded', next_action = NULL, claim_action = NULL, claim_token = NULL,
        claim_authority = NULL, lease_expires_at = NULL, retry_authorized = false,
        retry_safe_evidence = NULL, next_retry_at = NULL, blocked_reason = NULL,
        sanitized_failure_info = NULL, last_reconcile_status = v_status, processed_at = now()
    WHERE id = p_item_id;
    RETURN QUERY SELECT 'succeeded', p_item_id, 'succeeded', NULL::text;
    RETURN;
  END IF;

  IF v_status = 'NOT_FOUND' OR (v_status = 'FAILED' AND p_retry_safe) THEN
    v_next := 'SEND';
  ELSIF v_status = 'FAILED' THEN
    v_next := NULL;
  ELSE
    v_next := 'RECONCILE';
  END IF;
  v_dead := v_next = 'RECONCILE' AND v_item.reconcile_attempts >= v_item.max_reconcile_attempts;

  UPDATE public.erp_outbox
  SET status = CASE WHEN v_dead THEN 'dead' WHEN v_status = 'UNKNOWN' THEN 'unknown' ELSE 'failed' END,
      next_action = CASE WHEN v_dead THEN NULL ELSE v_next END,
      claim_action = NULL,
      claim_token = NULL,
      claim_authority = NULL,
      lease_expires_at = NULL,
      retry_authorized = (v_next = 'SEND'),
      retry_safe_evidence = CASE WHEN v_next = 'SEND' THEN COALESCE(p_retry_safe_evidence, '{}'::jsonb) ELSE NULL END,
      next_retry_at = CASE WHEN v_dead OR v_next IS NULL THEN NULL ELSE now() END,
      blocked_reason = CASE
        WHEN v_dead THEN 'max_reconcile_attempts'
        WHEN v_status = 'FAILED' AND v_next IS NULL THEN 'reconcile_failed_sem_evidencia'
        WHEN v_status = 'UNKNOWN' THEN 'reconcile_unknown'
        WHEN v_status = 'PENDING' THEN 'reconcile_pending'
        ELSE NULL
      END,
      last_reconcile_status = v_status
  WHERE id = p_item_id;

  RETURN QUERY SELECT
    CASE WHEN v_dead THEN 'dead' WHEN v_next = 'SEND' THEN 'resend_authorized' WHEN v_next IS NULL THEN 'blocked' ELSE 'reconcile_again' END,
    p_item_id,
    CASE WHEN v_dead THEN 'dead' WHEN v_status = 'UNKNOWN' THEN 'unknown' ELSE 'failed' END,
    CASE WHEN v_dead THEN NULL ELSE v_next END;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_bind_external_identity(
  p_empresa_id uuid,
  p_provider text,
  p_entity_type text,
  p_internal_entity_id text,
  p_external_entity_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (code text, mapping_id uuid, external_entity_id text, internal_entity_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted public.erp_external_identity_mappings%ROWTYPE;
  v_existing public.erp_external_identity_mappings%ROWTYPE;
  v_external_owner public.erp_external_identity_mappings%ROWTYPE;
BEGIN
  IF p_empresa_id IS NULL OR COALESCE(trim(p_provider), '') = '' OR COALESCE(trim(p_entity_type), '') = ''
     OR COALESCE(trim(p_internal_entity_id), '') = '' OR COALESCE(trim(p_external_entity_id), '') = '' THEN
    RETURN QUERY SELECT 'invalid_input', NULL::uuid, p_external_entity_id, p_internal_entity_id;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.erp_external_identity_mappings (
      empresa_id, provider, entity_type, internal_entity_id, external_entity_id, metadata
    )
    VALUES (p_empresa_id, p_provider, p_entity_type, p_internal_entity_id, p_external_entity_id, COALESCE(p_metadata, '{}'::jsonb))
    RETURNING * INTO v_inserted;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  IF v_inserted.id IS NOT NULL THEN
    RETURN QUERY SELECT 'bound', v_inserted.id, v_inserted.external_entity_id, v_inserted.internal_entity_id;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.erp_external_identity_mappings m
  WHERE m.empresa_id = p_empresa_id AND m.provider = p_provider AND m.entity_type = p_entity_type
    AND m.internal_entity_id = p_internal_entity_id;

  IF v_existing.external_entity_id = p_external_entity_id THEN
    RETURN QUERY SELECT 'idempotent', v_existing.id, v_existing.external_entity_id, v_existing.internal_entity_id;
    RETURN;
  END IF;

  SELECT * INTO v_external_owner
  FROM public.erp_external_identity_mappings m
  WHERE m.empresa_id = p_empresa_id AND m.provider = p_provider AND m.entity_type = p_entity_type
    AND m.external_entity_id = p_external_entity_id;
  IF v_external_owner.id IS NOT NULL THEN
    RETURN QUERY SELECT 'conflict_external_already_bound', v_external_owner.id, v_external_owner.external_entity_id, v_external_owner.internal_entity_id;
  ELSE
    RETURN QUERY SELECT 'conflict_internal_already_bound', v_existing.id, v_existing.external_entity_id, v_existing.internal_entity_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_rebind_external_identity(
  p_empresa_id uuid,
  p_provider text,
  p_entity_type text,
  p_internal_entity_id text,
  p_external_entity_id text,
  p_reason text
)
RETURNS TABLE (code text, mapping_id uuid, external_entity_id text, internal_entity_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current public.erp_external_identity_mappings%ROWTYPE;
  v_owner public.erp_external_identity_mappings%ROWTYPE;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN QUERY SELECT 'reason_required', NULL::uuid, p_external_entity_id, p_internal_entity_id;
    RETURN;
  END IF;
  SELECT * INTO v_current
  FROM public.erp_external_identity_mappings m
  WHERE m.empresa_id = p_empresa_id AND m.provider = p_provider AND m.entity_type = p_entity_type
    AND m.internal_entity_id = p_internal_entity_id
  FOR UPDATE;
  IF v_current.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, p_external_entity_id, p_internal_entity_id;
    RETURN;
  END IF;
  IF v_current.external_entity_id = p_external_entity_id THEN
    RETURN QUERY SELECT 'idempotent', v_current.id, v_current.external_entity_id, v_current.internal_entity_id;
    RETURN;
  END IF;

  SELECT * INTO v_owner
  FROM public.erp_external_identity_mappings m
  WHERE m.empresa_id = p_empresa_id AND m.provider = p_provider AND m.entity_type = p_entity_type
    AND m.external_entity_id = p_external_entity_id
  FOR UPDATE;
  IF v_owner.id IS NOT NULL AND v_owner.id <> v_current.id THEN
    RETURN QUERY SELECT 'conflict_external_already_bound', v_current.id, v_current.external_entity_id, v_current.internal_entity_id;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.erp_external_identity_mappings
    SET external_entity_id = p_external_entity_id,
        rebind_reason = p_reason,
        rebound_at = now()
    WHERE id = v_current.id
    RETURNING * INTO v_current;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'conflict_external_already_bound', v_current.id, v_current.external_entity_id, v_current.internal_entity_id;
    RETURN;
  END;

  RETURN QUERY SELECT 'rebound', v_current.id, v_current.external_entity_id, v_current.internal_entity_id;
END;
$$;

REVOKE ALL ON TABLE public.erp_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.erp_external_identity_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_external_identity_mappings TO service_role;

REVOKE ALL ON FUNCTION public.erp_sanitize_failure(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_enqueue_outbox(uuid,text,jsonb,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_claim_next_outbox(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_mark_outbox_succeeded(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_mark_outbox_failed(uuid,uuid,text,boolean,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_record_outbox_reconcile(uuid,uuid,text,boolean,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_bind_external_identity(uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_rebind_external_identity(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.erp_sanitize_failure(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_enqueue_outbox(uuid,text,jsonb,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_claim_next_outbox(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_mark_outbox_succeeded(uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_mark_outbox_failed(uuid,uuid,text,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_record_outbox_reconcile(uuid,uuid,text,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_bind_external_identity(uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_rebind_external_identity(uuid,text,text,text,text,text) TO service_role;

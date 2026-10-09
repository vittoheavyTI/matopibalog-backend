-- 085_unified_audit_digital_envelope.sql
--
-- E3.8: read model unificado de auditoria + envelope digital formal de
-- encerramento de frete. A migration e aditiva/idempotente, nao backfilla
-- historico e nao aplica nenhuma escrita de negocio por si so.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.frete_envelopes_digitais (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  frete_id uuid NOT NULL REFERENCES public.fretes(id) ON DELETE RESTRICT,
  envelope_type text NOT NULL DEFAULT 'formal_freight_closure'
    CHECK (envelope_type = 'formal_freight_closure'),
  schema_version text NOT NULL DEFAULT 'e38.freight_closure.v1'
    CHECK (schema_version = 'e38.freight_closure.v1'),
  status text NOT NULL DEFAULT 'sealed'
    CHECK (status = 'sealed'),
  source text NOT NULL DEFAULT 'backend_finalization'
    CHECK (source IN ('backend_finalization')),
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 8 AND 128),
  actor_user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_auth_uid text NULL CHECK (actor_auth_uid IS NULL OR length(btrim(actor_auth_uid)) BETWEEN 8 AND 128),
  actor_role text NULL CHECK (actor_role IS NULL OR length(btrim(actor_role)) BETWEEN 2 AND 64),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  correlation_id text NULL CHECK (correlation_id IS NULL OR length(btrim(correlation_id)) BETWEEN 8 AND 128),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  frete_snapshot jsonb NOT NULL CHECK (jsonb_typeof(frete_snapshot) = 'object'),
  financial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(financial_snapshot) = 'object'),
  audit_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audit_summary) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  envelope_hash text NOT NULL CHECK (length(envelope_hash) = 64),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_frete_envelopes_digitais_frete_formal
  ON public.frete_envelopes_digitais (frete_id)
  WHERE envelope_type = 'formal_freight_closure';

CREATE UNIQUE INDEX IF NOT EXISTS ux_frete_envelopes_digitais_request
  ON public.frete_envelopes_digitais (source, request_id);

CREATE INDEX IF NOT EXISTS idx_frete_envelopes_digitais_empresa_sealed
  ON public.frete_envelopes_digitais (empresa_id, sealed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_frete_envelopes_digitais_frete
  ON public.frete_envelopes_digitais (frete_id, sealed_at DESC, id DESC);

ALTER TABLE public.frete_envelopes_digitais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frete_envelopes_digitais FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.frete_envelopes_digitais FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.frete_envelopes_digitais TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.frete_envelopes_digitais FROM service_role;

CREATE OR REPLACE FUNCTION public.frete_envelopes_digitais_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'FRETE_ENVELOPE_DIGITAL_IMUTAVEL' USING errcode = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_frete_envelopes_digitais_append_only ON public.frete_envelopes_digitais;
CREATE TRIGGER trg_frete_envelopes_digitais_append_only
  BEFORE UPDATE OR DELETE ON public.frete_envelopes_digitais
  FOR EACH ROW EXECUTE FUNCTION public.frete_envelopes_digitais_append_only();

-- Constraint trigger deferrable na tabela fretes:
-- Garante a invariante estrita NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true
-- sem depender de variaveis de sessao / GUCs controlaveis pelo caller.
-- Na finalizacao formal, o frete e atualizado e o envelope e inserido
-- dentro da mesma transacao; no COMMIT, o trigger verifica a existencia
-- de exatamente 1 envelope formal selado. Qualquer tentativa de UPDATE direto
-- para 'finalizado' por qualquer role (incluindo service_role) sem envelope falha no COMMIT.
CREATE OR REPLACE FUNCTION public.e38_check_frete_finalizado_envelope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.status = 'finalizado' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'finalizado') THEN
    SELECT count(*)
      INTO v_count
      FROM public.frete_envelopes_digitais e
     WHERE e.frete_id = NEW.id
       AND e.empresa_id = NEW.empresa_id
       AND e.envelope_type = 'formal_freight_closure';

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE: frete % deve possuir exatamente 1 envelope formal selado na mesma transacao (encontrados: %)', NEW.id, v_count
        USING errcode = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_e38_guard_frete_finalizado_envelope ON public.fretes;
DROP TRIGGER IF EXISTS trg_e38_check_frete_finalizado_envelope ON public.fretes;
CREATE CONSTRAINT TRIGGER trg_e38_check_frete_finalizado_envelope
  AFTER INSERT OR UPDATE OF status ON public.fretes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.e38_check_frete_finalizado_envelope();

CREATE OR REPLACE FUNCTION public.e38_jsonb_pick_existing(p_src jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_k text;
BEGIN
  IF p_src IS NULL OR jsonb_typeof(p_src) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;
  FOREACH v_k IN ARRAY p_keys
  LOOP
    IF p_src ? v_k THEN
      v_out := v_out || jsonb_build_object(v_k, p_src->v_k);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.e38_finalize_frete_with_envelope(
  p_frete_id uuid,
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_actor_auth_uid text,
  p_actor_role text,
  p_reason text,
  p_source text,
  p_request_id text,
  p_correlation_id text,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_frete public.fretes%ROWTYPE;
  v_after public.fretes%ROWTYPE;
  v_existing public.frete_envelopes_digitais%ROWTYPE;
  v_envelope public.frete_envelopes_digitais%ROWTYPE;
  v_update jsonb;
  v_payload jsonb;
  v_financial jsonb;
  v_frete_snapshot jsonb;
  v_audit_summary jsonb;
  v_envelope_hash text;
  v_key text;
  v_allowed_patch text[] := ARRAY['status','km_inicial','km_final','valor_frete'];
BEGIN
  IF p_empresa_id IS NULL OR p_frete_id IS NULL THEN
    RAISE EXCEPTION 'e38_frete_envelope_identity_required';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'e38_frete_envelope_reason_required';
  END IF;
  IF btrim(coalesce(p_source, '')) <> 'backend_finalization' THEN
    RAISE EXCEPTION 'e38_frete_envelope_source_invalid';
  END IF;
  IF btrim(coalesce(p_request_id, '')) = '' THEN
    RAISE EXCEPTION 'e38_frete_envelope_request_id_required';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'e38_frete_envelope_patch_invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('e38_frete_envelope'), hashtext(p_frete_id::text));

  SELECT *
    INTO v_existing
    FROM public.frete_envelopes_digitais
   WHERE source = btrim(p_source)
     AND request_id = btrim(p_request_id);

  IF FOUND THEN
    IF v_existing.frete_id <> p_frete_id OR v_existing.empresa_id <> p_empresa_id THEN
      RAISE EXCEPTION 'e38_frete_envelope_request_id_conflict';
    END IF;
    RETURN jsonb_build_object(
      'idempotent', true,
      'frete', (SELECT to_jsonb(f) FROM public.fretes f WHERE f.id = v_existing.frete_id),
      'envelope', to_jsonb(v_existing)
    );
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed_patch)) THEN
      RAISE EXCEPTION 'e38_frete_envelope_patch_field_not_allowed:%', v_key;
    END IF;
  END LOOP;

  SELECT *
    INTO v_frete
    FROM public.fretes
   WHERE id = p_frete_id
     AND empresa_id = p_empresa_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'e38_frete_envelope_frete_not_found';
  END IF;

  IF v_frete.status = 'finalizado' THEN
    SELECT *
      INTO v_existing
      FROM public.frete_envelopes_digitais
     WHERE frete_id = p_frete_id
       AND envelope_type = 'formal_freight_closure';

    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', true,
        'frete', to_jsonb(v_frete),
        'envelope', to_jsonb(v_existing)
      );
    END IF;
    RAISE EXCEPTION 'E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE';
  END IF;

  IF coalesce(v_frete.status, '') = 'cancelado' THEN
    RAISE EXCEPTION 'e38_frete_envelope_status_locked';
  END IF;

  v_update := coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('status', 'finalizado');

  UPDATE public.fretes
     SET status = 'finalizado',
         km_inicial = CASE WHEN v_update ? 'km_inicial' THEN (v_update->>'km_inicial')::numeric ELSE km_inicial END,
         km_final = CASE WHEN v_update ? 'km_final' THEN (v_update->>'km_final')::numeric ELSE km_final END,
         valor_frete = CASE WHEN v_update ? 'valor_frete' THEN (v_update->>'valor_frete')::numeric ELSE valor_frete END
   WHERE id = p_frete_id
     AND empresa_id = p_empresa_id
   RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'e38_frete_envelope_update_failed';
  END IF;

  v_frete_snapshot := public.e38_jsonb_pick_existing(
    to_jsonb(v_after),
    ARRAY[
      'id','empresa_id','motorista_id','status','data','origem','destino',
      'km_inicial','km_final','modalidade_calculo','toneladas',
      'valor_tonelada_km','valor_frete','quem_recebeu',
      'unidade_operacional_id','foto_odometro_inicial_path','foto_odometro_final_path'
    ]
  );

  v_financial := public.e38_jsonb_pick_existing(
    to_jsonb(v_after),
    ARRAY['modalidade_calculo','toneladas','valor_tonelada_km','valor_frete','km_inicial','km_final','quem_recebeu']
  );

  SELECT jsonb_build_object(
    'lancamento_eventos_count',
      CASE WHEN to_regclass('public.lancamento_eventos') IS NULL THEN NULL
           ELSE (SELECT count(*) FROM public.lancamento_eventos le WHERE le.frete_id = p_frete_id) END,
    'fretes_financeiro_auditoria_count',
      CASE WHEN to_regclass('public.fretes_financeiro_auditoria') IS NULL THEN NULL
           ELSE (SELECT count(*) FROM public.fretes_financeiro_auditoria fa WHERE fa.frete_id = p_frete_id) END,
    'historical_completeness',
      CASE WHEN v_frete.status = 'finalizado' THEN 'legacy_source' ELSE 'formal_snapshot' END
  ) INTO v_audit_summary;

  v_payload := jsonb_build_object(
    'schema_version', 'e38.freight_closure.v1',
    'envelope_type', 'formal_freight_closure',
    'empresa_id', p_empresa_id,
    'frete_id', p_frete_id,
    'source', btrim(p_source),
    'request_id', btrim(p_request_id),
    'correlation_id', p_correlation_id,
    'actor_user_id', p_actor_user_id,
    'actor_auth_uid', p_actor_auth_uid,
    'actor_role', p_actor_role,
    'reason', btrim(p_reason),
    'frete_snapshot', v_frete_snapshot,
    'financial_snapshot', v_financial,
    'audit_summary', v_audit_summary,
    'metadata', jsonb_build_object(
      'sealed_from_status', v_frete.status,
      'patch_applied', p_patch
    )
  );

  v_envelope_hash := encode(extensions.digest(v_payload::text, 'sha256'), 'hex');

  INSERT INTO public.frete_envelopes_digitais (
    empresa_id,
    frete_id,
    envelope_type,
    schema_version,
    status,
    source,
    request_id,
    actor_user_id,
    actor_auth_uid,
    actor_role,
    reason,
    correlation_id,
    sealed_at,
    frete_snapshot,
    financial_snapshot,
    audit_summary,
    metadata,
    envelope_hash,
    payload
  ) VALUES (
    p_empresa_id,
    p_frete_id,
    'formal_freight_closure',
    'e38.freight_closure.v1',
    'sealed',
    btrim(p_source),
    btrim(p_request_id),
    p_actor_user_id,
    p_actor_auth_uid,
    p_actor_role,
    btrim(p_reason),
    p_correlation_id,
    now(),
    v_frete_snapshot,
    v_financial,
    v_audit_summary,
    jsonb_build_object(
      'sealed_from_status', v_frete.status,
      'patch_applied', p_patch
    ),
    v_envelope_hash,
    v_payload
  )
  RETURNING * INTO v_envelope;

  RETURN jsonb_build_object(
    'idempotent', false,
    'frete', to_jsonb(v_after),
    'envelope', to_jsonb(v_envelope)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.e38_finalize_frete_with_envelope(uuid,uuid,uuid,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e38_finalize_frete_with_envelope(uuid,uuid,uuid,text,text,text,text,text,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.e38_check_frete_finalizado_envelope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e38_check_frete_finalizado_envelope() TO service_role;

-- Read model SQL unificado de auditoria:
-- Suporta projecao unificada de eventos operacionais com filtragem de entidade/frete
-- ANTES do LIMIT e paginacao estável por cursor (occurred_at, event_id).
CREATE OR REPLACE FUNCTION public.listar_auditoria_unificada(
  p_empresa_id uuid,
  p_limit integer DEFAULT 100,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_event_id text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL
)
RETURNS TABLE (
  event_id text,
  source_kind text,
  source_record_id text,
  empresa_id uuid,
  entity_type text,
  entity_id text,
  actor_user_id text,
  actor_role text,
  occurred_at timestamptz,
  action text,
  reason text,
  metadata jsonb,
  authority_class text,
  historical_completeness text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'e38_auditoria_unificada_empresa_id_required';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.e38_audit_events (
    event_id text,
    source_kind text,
    source_record_id text,
    empresa_id uuid,
    entity_type text,
    entity_id text,
    actor_user_id text,
    actor_role text,
    occurred_at timestamptz,
    action text,
    reason text,
    metadata jsonb,
    authority_class text,
    historical_completeness text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.e38_audit_events;

  -- 1. Frete Envelopes Digitais
  IF (p_entity_type IS NULL OR p_entity_type = 'frete') AND to_regclass('public.frete_envelopes_digitais') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'frete_envelope:' || e.id::text,
      'frete_envelopes_digitais',
      e.id::text,
      e.empresa_id,
      'frete',
      e.frete_id::text,
      e.actor_user_id::text,
      e.actor_role,
      e.sealed_at,
      'freight_closure_envelope_sealed',
      e.reason,
      jsonb_build_object('schema_version', e.schema_version, 'correlation_id', e.correlation_id, 'envelope_hash', e.envelope_hash),
      'formal_digital_envelope',
      'complete'
    FROM public.frete_envelopes_digitais e
    WHERE e.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR e.frete_id::text = p_entity_id OR e.id::text = p_entity_id);
  END IF;

  -- 2. Lancamento Eventos (despesas, adiantamentos, abastecimentos)
  IF (p_entity_type IS NULL OR p_entity_type IN ('frete', 'despesa', 'adiantamento', 'abastecimento')) AND to_regclass('public.lancamento_eventos') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'lancamento_evento:' || le.id::text,
      'lancamento_eventos',
      le.id::text,
      le.empresa_id,
      le.entity_type,
      le.entity_id::text,
      le.actor_user_id::text,
      le.actor_role,
      le.occurred_at,
      le.action,
      le.reason,
      coalesce(le.metadata, '{}'::jsonb) || jsonb_build_object('frete_id', le.frete_id),
      'domain_ledger',
      'complete'
    FROM public.lancamento_eventos le
    WHERE le.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR le.frete_id::text = p_entity_id OR le.entity_id::text = p_entity_id);
  END IF;

  -- 3. Fretes Financeiro Auditoria
  IF (p_entity_type IS NULL OR p_entity_type = 'frete') AND to_regclass('public.fretes_financeiro_auditoria') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'frete_financeiro:' || fa.id::text,
      'fretes_financeiro_auditoria',
      fa.id::text,
      fa.empresa_id,
      'frete',
      fa.frete_id::text,
      fa.actor_user_id::text,
      NULL,
      fa.created_at,
      fa.correction_type,
      fa.reason,
      jsonb_build_object('source', fa.source, 'request_id', fa.request_id),
      'domain_ledger',
      'complete'
    FROM public.fretes_financeiro_auditoria fa
    WHERE fa.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR fa.frete_id::text = p_entity_id);
  END IF;

  -- 4. Frete Documento Eventos
  IF (p_entity_type IS NULL OR p_entity_type IN ('frete', 'frete_documento')) AND to_regclass('public.frete_documento_eventos') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'frete_documento_evento:' || fde.id::text,
      'frete_documento_eventos',
      fde.id::text,
      fde.empresa_id,
      'frete_documento',
      fde.documento_id::text,
      fde.actor_user_id::text,
      fde.actor_role,
      fde.occurred_at,
      fde.action,
      fde.reason,
      coalesce(fde.metadata, '{}'::jsonb) || jsonb_build_object('frete_id', fde.frete_id),
      'domain_ledger',
      'complete'
    FROM public.frete_documento_eventos fde
    WHERE fde.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR fde.frete_id::text = p_entity_id OR fde.documento_id::text = p_entity_id);
  END IF;

  -- 5. ERP Outbox
  IF (p_entity_type IS NULL OR p_entity_type = 'frete' OR p_entity_type = 'erp_event') AND to_regclass('public.erp_outbox') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'erp_outbox:' || eo.id::text,
      'erp_outbox',
      eo.id::text,
      eo.empresa_id,
      coalesce(eo.canonical_envelope->>'entity_type', 'erp_event'),
      coalesce(eo.canonical_envelope->>'entity_id', eo.id::text),
      NULL,
      NULL,
      eo.created_at,
      coalesce(eo.canonical_envelope->>'event_type', eo.status),
      eo.next_action,
      jsonb_build_object('provider', eo.provider, 'status', eo.status, 'event_id', eo.event_id),
      'integration_outbox',
      'complete'
    FROM public.erp_outbox eo
    WHERE eo.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR eo.canonical_envelope->>'entity_id' = p_entity_id OR eo.id::text = p_entity_id);
  END IF;

  -- 6. Permission Change Events (somente quando consulta global ou por usuario)
  IF (p_entity_type IS NULL OR p_entity_type = 'usuario') AND to_regclass('public.permission_change_events') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'permission_change:' || pce.id::text,
      'permission_change_events',
      pce.id::text,
      pce.empresa_id,
      'usuario',
      pce.usuario_id::text,
      pce.altered_by_user_id::text,
      NULL,
      pce.created_at,
      pce.change_type,
      pce.reason,
      jsonb_build_object('permission_key', pce.permission_key, 'old_effect', pce.old_effect, 'new_effect', pce.new_effect),
      'governance_ledger',
      'complete'
    FROM public.permission_change_events pce
    WHERE pce.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR pce.usuario_id::text = p_entity_id);
  END IF;

  -- 7. Operational Scope Auditoria (somente quando consulta global ou por unidade)
  IF (p_entity_type IS NULL OR p_entity_type = 'unidade_operacional') AND to_regclass('public.operational_scope_auditoria') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'operational_scope:' || osa.id::text,
      'operational_scope_auditoria',
      osa.id::text,
      osa.empresa_id,
      'unidade_operacional',
      osa.unidade_operacional_id::text,
      osa.actor_user_id::text,
      NULL,
      osa.created_at,
      osa.action,
      osa.reason,
      jsonb_build_object('user_id', osa.usuario_id, 'tipo_acesso', osa.tipo_acesso),
      'governance_ledger',
      'complete'
    FROM public.operational_scope_auditoria osa
    WHERE osa.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR osa.unidade_operacional_id::text = p_entity_id OR osa.usuario_id::text = p_entity_id);
  END IF;

  -- 8. Auth Event Audit (somente quando consulta global ou por usuario)
  IF (p_entity_type IS NULL OR p_entity_type = 'usuario') AND to_regclass('public.auth_event_audit') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'auth_event:' || aea.id::text,
      'auth_event_audit',
      aea.id::text,
      aea.empresa_id,
      'usuario',
      aea.user_id::text,
      aea.user_id::text,
      NULL,
      aea.created_at,
      aea.event_type,
      NULL,
      jsonb_build_object('ip', aea.ip, 'user_agent', aea.user_agent),
      'security_ledger',
      'complete'
    FROM public.auth_event_audit aea
    WHERE aea.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR aea.user_id::text = p_entity_id);
  END IF;

  -- 9. Billing Outbox (somente quando consulta global ou por billing)
  IF (p_entity_type IS NULL OR p_entity_type = 'billing') AND to_regclass('public.billing_outbox') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'billing_outbox:' || bo.id::text,
      'billing_outbox',
      bo.id::text,
      bo.empresa_id,
      'billing',
      bo.empresa_id::text,
      NULL,
      NULL,
      bo.created_at,
      bo.event_type,
      NULL,
      jsonb_build_object('status', bo.status, 'retry_count', bo.retry_count),
      'integration_outbox',
      'complete'
    FROM public.billing_outbox bo
    WHERE bo.empresa_id = p_empresa_id;
  END IF;

  -- 10. Contrato Eventos (somente quando consulta global ou por contrato)
  IF (p_entity_type IS NULL OR p_entity_type = 'empresa_contrato') AND to_regclass('public.contrato_eventos') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'contrato_evento:' || ce.id::text,
      'contrato_eventos',
      ce.id::text,
      ce.empresa_id,
      'empresa_contrato',
      ce.contrato_id::text,
      ce.criado_por::text,
      NULL,
      ce.criado_em,
      ce.tipo,
      NULL,
      coalesce(ce.detalhe, '{}'::jsonb),
      'commercial_contract_ledger',
      CASE WHEN ce.criado_por IS NULL THEN 'legacy_source' ELSE 'complete' END
    FROM public.contrato_eventos ce
    WHERE ce.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR ce.contrato_id::text = p_entity_id);
  END IF;

  -- 11. Partner Network Events (se existir tabela)
  IF (p_entity_type IS NULL OR p_entity_type = 'partner') AND to_regclass('public.partner_network_events') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'partner_network:' || pne.id::text,
      'partner_network_events',
      pne.id::text,
      pne.empresa_id,
      coalesce(pne.partner_entity_type, 'partner'),
      coalesce(pne.partner_entity_id::text, pne.id::text),
      pne.actor_user_id::text,
      NULL,
      pne.created_at,
      pne.event_type,
      NULL,
      coalesce(pne.metadata, '{}'::jsonb),
      'domain_ledger',
      'complete'
    FROM public.partner_network_events pne
    WHERE pne.empresa_id = p_empresa_id;
  END IF;

  -- 12. Campaign Exceptions (se existir tabela)
  IF (p_entity_type IS NULL OR p_entity_type = 'campaign') AND to_regclass('public.campaign_exceptions') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'campaign_exception:' || ce.id::text,
      'campaign_exceptions',
      ce.id::text,
      ce.empresa_id,
      'campaign',
      ce.campaign_id::text,
      ce.created_by::text,
      NULL,
      ce.created_at,
      ce.exception_type,
      ce.reason,
      jsonb_build_object('severity', ce.severity, 'status', ce.status),
      'domain_ledger',
      'complete'
    FROM public.campaign_exceptions ce
    WHERE ce.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR ce.campaign_id::text = p_entity_id);
  END IF;

  -- 13. Funcionalidade Auditoria (se existir tabela)
  IF (p_entity_type IS NULL OR p_entity_type = 'funcionalidade') AND to_regclass('public.funcionalidade_auditoria') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'funcionalidade_audit:' || fa.id::text,
      'funcionalidade_auditoria',
      fa.id::text,
      fa.empresa_id,
      'funcionalidade',
      fa.funcionalidade_id::text,
      fa.alterado_por::text,
      NULL,
      fa.criado_em,
      fa.acao,
      fa.motivo,
      coalesce(fa.detalhes, '{}'::jsonb),
      'governance_ledger',
      'complete'
    FROM public.funcionalidade_auditoria fa
    WHERE fa.empresa_id = p_empresa_id;
  END IF;

  -- 14. Fleet Odometer Events (se existir tabela)
  IF (p_entity_type IS NULL OR p_entity_type = 'fleet_asset') AND to_regclass('public.odometer_events') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'odometer_event:' || oe.id::text,
      'odometer_events',
      oe.id::text,
      oe.empresa_id,
      'fleet_asset',
      oe.asset_id::text,
      oe.recorded_by::text,
      NULL,
      oe.recorded_at,
      oe.event_type,
      oe.reason,
      jsonb_build_object('km', oe.km_value, 'source', oe.source),
      'domain_ledger',
      'complete'
    FROM public.odometer_events oe
    WHERE oe.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR oe.asset_id::text = p_entity_id);
  END IF;

  -- 15. Fleet Maintenance Events (se existir tabela)
  IF (p_entity_type IS NULL OR p_entity_type = 'fleet_asset') AND to_regclass('public.maintenance_events') IS NOT NULL THEN
    INSERT INTO pg_temp.e38_audit_events
    SELECT
      'maintenance_event:' || me.id::text,
      'maintenance_events',
      me.id::text,
      me.empresa_id,
      'fleet_asset',
      me.asset_id::text,
      me.created_by::text,
      NULL,
      me.created_at,
      me.service_type,
      me.notes,
      jsonb_build_object('status', me.status, 'cost', me.cost),
      'domain_ledger',
      'complete'
    FROM public.maintenance_events me
    WHERE me.empresa_id = p_empresa_id
      AND (p_entity_id IS NULL OR me.asset_id::text = p_entity_id);
  END IF;

  RETURN QUERY
  SELECT ev.event_id, ev.source_kind, ev.source_record_id, ev.empresa_id, ev.entity_type,
         ev.entity_id, ev.actor_user_id, ev.actor_role, ev.occurred_at, ev.action,
         ev.reason, ev.metadata, ev.authority_class, ev.historical_completeness
    FROM pg_temp.e38_audit_events ev
   WHERE (p_before_occurred_at IS NULL OR (ev.occurred_at, ev.event_id) < (p_before_occurred_at, coalesce(p_before_event_id, chr(127))))
   ORDER BY ev.occurred_at DESC, ev.event_id DESC
   LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_auditoria_unificada(uuid, integer, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_auditoria_unificada(uuid, integer, timestamptz, text, text, text) TO service_role;

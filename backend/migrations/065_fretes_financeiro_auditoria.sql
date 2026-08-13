-- 065_fretes_financeiro_auditoria.sql
--
-- Auditoria atomica para recuperacao segura de fretes legado tonelada/km.
-- Nao corrige dados por si so e nao amplia limites comerciais: a API calcula
-- pelo helper canonico JS e chama esta RPC apenas com campos allowlisted.

CREATE TABLE IF NOT EXISTS public.fretes_financeiro_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id uuid NOT NULL REFERENCES public.fretes(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_auth_uid text NULL,
  reason text NOT NULL,
  source text NOT NULL,
  request_id text NOT NULL,
  correction_type text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fretes_fin_aud_reason_chk CHECK (length(btrim(reason)) >= 8 AND length(reason) <= 500),
  CONSTRAINT fretes_fin_aud_source_chk CHECK (btrim(source) IN ('painel_admin')),
  CONSTRAINT fretes_fin_aud_request_id_chk CHECK (length(btrim(request_id)) >= 8 AND length(request_id) <= 128),
  CONSTRAINT fretes_fin_aud_correction_type_chk CHECK (btrim(correction_type) IN ('manual_legacy_financial_correction')),
  CONSTRAINT fretes_fin_aud_actor_auth_uid_chk CHECK (actor_auth_uid IS NULL OR length(btrim(actor_auth_uid)) BETWEEN 8 AND 128),
  CONSTRAINT fretes_fin_aud_before_obj_chk CHECK (jsonb_typeof(before_snapshot) = 'object'),
  CONSTRAINT fretes_fin_aud_after_obj_chk CHECK (jsonb_typeof(after_snapshot) = 'object')
);

ALTER TABLE public.fretes_financeiro_auditoria
  ADD COLUMN IF NOT EXISTS actor_auth_uid text NULL;

ALTER TABLE public.fretes_financeiro_auditoria
  DROP CONSTRAINT IF EXISTS fretes_fin_aud_source_chk,
  DROP CONSTRAINT IF EXISTS fretes_fin_aud_correction_type_chk,
  DROP CONSTRAINT IF EXISTS fretes_fin_aud_actor_auth_uid_chk,
  ADD CONSTRAINT fretes_fin_aud_source_chk CHECK (btrim(source) IN ('painel_admin')),
  ADD CONSTRAINT fretes_fin_aud_correction_type_chk CHECK (btrim(correction_type) IN ('manual_legacy_financial_correction')),
  ADD CONSTRAINT fretes_fin_aud_actor_auth_uid_chk CHECK (actor_auth_uid IS NULL OR length(btrim(actor_auth_uid)) BETWEEN 8 AND 128);

CREATE INDEX IF NOT EXISTS idx_fretes_fin_aud_frete_id
  ON public.fretes_financeiro_auditoria (frete_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fretes_fin_aud_empresa_id
  ON public.fretes_financeiro_auditoria (empresa_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fretes_fin_aud_idempotency
  ON public.fretes_financeiro_auditoria (source, request_id);

ALTER TABLE public.fretes_financeiro_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fretes_financeiro_auditoria FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fretes_financeiro_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.fretes_financeiro_auditoria TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.fretes_financeiro_auditoria FROM service_role;

DROP FUNCTION IF EXISTS public.corrigir_frete_financeiro_legacy(uuid, uuid, uuid, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.corrigir_frete_financeiro_legacy(
  p_frete_id uuid,
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_actor_auth_uid text,
  p_reason text,
  p_source text,
  p_request_id text,
  p_correction_type text,
  p_expected_before_snapshot jsonb,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_frete public.fretes%ROWTYPE;
  v_after public.fretes%ROWTYPE;
  v_audit public.fretes_financeiro_auditoria%ROWTYPE;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_key text;
  v_allowed_fields text[] := ARRAY[
    'modalidade_calculo',
    'toneladas',
    'valor_tonelada_km',
    'valor_frete',
    'km_inicial',
    'km_final'
  ];
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'frete_financial_correction_reason_required';
  END IF;
  IF btrim(coalesce(p_source, '')) = '' THEN
    RAISE EXCEPTION 'frete_financial_correction_source_required';
  END IF;
  IF btrim(coalesce(p_request_id, '')) = '' THEN
    RAISE EXCEPTION 'frete_financial_correction_request_id_required';
  END IF;
  IF btrim(coalesce(p_source, '')) <> 'painel_admin' THEN
    RAISE EXCEPTION 'frete_financial_correction_source_not_allowed';
  END IF;
  IF btrim(coalesce(p_correction_type, '')) <> 'manual_legacy_financial_correction' THEN
    RAISE EXCEPTION 'frete_financial_correction_type_not_allowed';
  END IF;
  IF p_expected_before_snapshot IS NULL OR jsonb_typeof(p_expected_before_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'frete_financial_correction_expected_snapshot_required';
  END IF;
  IF coalesce(p_patch, '{}'::jsonb) = '{}'::jsonb THEN
    RAISE EXCEPTION 'frete_financial_correction_empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(btrim(p_source)), hashtext(btrim(p_request_id)));

  SELECT *
    INTO v_audit
    FROM public.fretes_financeiro_auditoria
   WHERE source = btrim(p_source)
     AND request_id = btrim(p_request_id);

  IF FOUND THEN
    IF v_audit.frete_id <> p_frete_id OR v_audit.empresa_id <> p_empresa_id THEN
      RAISE EXCEPTION 'frete_financial_correction_request_id_conflict';
    END IF;
    RETURN jsonb_build_object(
      'idempotent', true,
      'audit_id', v_audit.id,
      'frete_id', v_audit.frete_id,
      'before_snapshot', v_audit.before_snapshot,
      'after_snapshot', v_audit.after_snapshot
    );
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed_fields)) THEN
      RAISE EXCEPTION 'frete_financial_correction_field_not_allowed:%', v_key;
    END IF;
  END LOOP;

  SELECT *
    INTO v_frete
    FROM public.fretes
   WHERE id = p_frete_id
     AND empresa_id = p_empresa_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'frete_financial_correction_not_found';
  END IF;

  IF v_frete.status IN ('finalizado', 'cancelado') THEN
    RAISE EXCEPTION 'frete_financial_correction_status_locked';
  END IF;
  IF coalesce(v_frete.status, '') NOT IN ('ativo', 'pendente') THEN
    RAISE EXCEPTION 'frete_financial_correction_status_unknown';
  END IF;

  v_before_snapshot := jsonb_build_object(
    'modalidade_calculo', v_frete.modalidade_calculo,
    'toneladas', v_frete.toneladas,
    'valor_tonelada_km', v_frete.valor_tonelada_km,
    'valor_frete', v_frete.valor_frete,
    'km_inicial', v_frete.km_inicial,
    'km_final', v_frete.km_final,
    'status', v_frete.status
  );

  IF v_before_snapshot <> p_expected_before_snapshot THEN
    RAISE EXCEPTION 'frete_financial_correction_concurrent_change';
  END IF;

  UPDATE public.fretes
     SET modalidade_calculo = CASE WHEN p_patch ? 'modalidade_calculo' THEN p_patch->>'modalidade_calculo' ELSE modalidade_calculo END,
         toneladas = CASE WHEN p_patch ? 'toneladas' THEN (p_patch->>'toneladas')::numeric ELSE toneladas END,
         valor_tonelada_km = CASE WHEN p_patch ? 'valor_tonelada_km' THEN (p_patch->>'valor_tonelada_km')::numeric ELSE valor_tonelada_km END,
         valor_frete = CASE WHEN p_patch ? 'valor_frete' THEN (p_patch->>'valor_frete')::numeric ELSE valor_frete END,
         km_inicial = CASE WHEN p_patch ? 'km_inicial' THEN (p_patch->>'km_inicial')::numeric ELSE km_inicial END,
         km_final = CASE WHEN p_patch ? 'km_final' THEN (p_patch->>'km_final')::numeric ELSE km_final END
   WHERE id = p_frete_id
     AND empresa_id = p_empresa_id
   RETURNING * INTO v_after;

  IF coalesce(v_after.modalidade_calculo, 'valor_fixo') NOT IN ('valor_fixo', 'tonelada_km') THEN
    RAISE EXCEPTION 'frete_financial_correction_invalid_modality';
  END IF;
  IF v_after.toneladas IS NOT NULL AND (v_after.toneladas <= 0 OR v_after.toneladas > 100) THEN
    RAISE EXCEPTION 'frete_operational_limit:toneladas';
  END IF;
  IF v_after.valor_tonelada_km IS NOT NULL AND (v_after.valor_tonelada_km <= 0 OR v_after.valor_tonelada_km > 10) THEN
    RAISE EXCEPTION 'frete_operational_limit:valor_tonelada_km';
  END IF;
  IF v_after.valor_frete IS NOT NULL AND (v_after.valor_frete < 0 OR v_after.valor_frete > 1000000) THEN
    RAISE EXCEPTION 'frete_operational_limit:valor_frete';
  END IF;
  IF coalesce(v_after.modalidade_calculo, 'valor_fixo') <> 'tonelada_km'
     AND v_after.valor_frete IS NOT NULL
     AND v_after.valor_frete <= 0 THEN
    RAISE EXCEPTION 'frete_operational_limit:valor_frete';
  END IF;
  IF v_after.km_inicial IS NOT NULL
     AND v_after.km_final IS NOT NULL
     AND v_after.km_final <= v_after.km_inicial THEN
    RAISE EXCEPTION 'frete_operational_limit:km';
  END IF;

  v_after_snapshot := jsonb_build_object(
    'modalidade_calculo', v_after.modalidade_calculo,
    'toneladas', v_after.toneladas,
    'valor_tonelada_km', v_after.valor_tonelada_km,
    'valor_frete', v_after.valor_frete,
    'km_inicial', v_after.km_inicial,
    'km_final', v_after.km_final,
    'status', v_after.status
  );

  INSERT INTO public.fretes_financeiro_auditoria (
    frete_id,
    empresa_id,
    actor_user_id,
    actor_auth_uid,
    reason,
    source,
    request_id,
    correction_type,
    before_snapshot,
    after_snapshot
  ) VALUES (
    p_frete_id,
    p_empresa_id,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_auth_uid, '')), ''),
    btrim(p_reason),
    btrim(p_source),
    btrim(p_request_id),
    btrim(p_correction_type),
    v_before_snapshot,
    v_after_snapshot
  )
  RETURNING * INTO v_audit;

  RETURN jsonb_build_object(
    'idempotent', false,
    'audit_id', v_audit.id,
    'frete_id', p_frete_id,
    'before_snapshot', v_before_snapshot,
    'after_snapshot', v_after_snapshot
  );
END
$$;

REVOKE ALL ON FUNCTION public.corrigir_frete_financeiro_legacy(uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corrigir_frete_financeiro_legacy(uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb)
  TO service_role;

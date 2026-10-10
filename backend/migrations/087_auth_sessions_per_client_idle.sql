-- backend/migrations/087_auth_sessions_per_client_idle.sql
--
-- R1B-B: Server-authoritative per-client session idle policy.
-- Torna autoritativa a inatividade de 30 minutos para client_type='web' sem
-- encurtar clientes móveis (android/ios) ou api, e preservando estritamente
-- a precedência atômica da detecção de reúso de refresh tokens.
--
-- PRESERVA a assinatura exata da RPC pública:
--   public.rotacionar_refresh_token(text, text, timestamptz, timestamptz, text, text, integer)
--
-- Sem novas colunas, sem novas tabelas, sem mutação de DML/backfill.

CREATE OR REPLACE FUNCTION public.rotacionar_refresh_token(
  p_apresentado_hash     text,
  p_novo_token_hash      text,
  p_novo_expires_at      timestamptz,
  p_novo_idle_expires_at timestamptz,
  p_request_id           text DEFAULT NULL,
  p_origin               text DEFAULT NULL,
  p_grace_seconds        integer DEFAULT 10
)
RETURNS TABLE (
  resultado     text,
  session_id    uuid,
  usuario_id    uuid,
  empresa_id    uuid,
  client_type   text,
  novo_token_id uuid,
  nova_version  int,
  novo_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tok    public.auth_refresh_tokens%ROWTYPE;
  v_sess   public.auth_sessions%ROWTYPE;
  v_new_id uuid;
  v_new_ver int;
  v_novo_expires_at timestamptz;
  v_agora  timestamptz := now();   -- transaction_timestamp: constante na tx
  v_grace  interval;
BEGIN
  -- Janela de graça: server-side, faixa segura, nunca do frontend.
  IF p_grace_seconds IS NULL OR p_grace_seconds < 0 OR p_grace_seconds > 300 THEN
    RAISE EXCEPTION 'grace_invalido' USING ERRCODE = 'P0001';
  END IF;
  v_grace := make_interval(secs => p_grace_seconds);

  SELECT * INTO v_tok FROM public.auth_refresh_tokens WHERE token_hash = p_apresentado_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_sess FROM public.auth_sessions WHERE id = v_tok.session_id FOR UPDATE;

  -- 1. Detecção de reúso / colisão concorrente PRIMEIRO.
  -- Obrigatório executar ANTES de qualquer checagem de inatividade (inclusive se sessão web >30m).
  IF v_tok.used_at IS NOT NULL THEN
    -- COLISÃO concorrente / retry dentro da janela: NÃO revoga, NÃO emite novo.
    IF v_tok.reuse_detected_at IS NULL AND v_sess.revoked_at IS NULL
       AND (v_agora - v_tok.used_at) <= v_grace THEN
      INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, origem, request_id, resultado, motivo, ip_hash, user_agent)
        VALUES ('refresh_colisao', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.refresh_family_id, v_sess.client_type, p_origin, p_request_id, 'refresh_already_rotated', 'retry/colisao concorrente na janela', v_sess.ip_hash, v_sess.user_agent);
      RETURN QUERY SELECT 'refresh_already_rotated'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
      RETURN;
    END IF;
    -- REUSE suspeito (fora da janela ou família já marcada): revoga a FAMÍLIA.
    UPDATE public.auth_refresh_tokens
       SET reuse_detected_at = COALESCE(reuse_detected_at, v_agora), revoked_at = COALESCE(revoked_at, v_agora)
     WHERE family_id = v_tok.family_id;
    UPDATE public.auth_sessions
       SET revoked_at = COALESCE(revoked_at, v_agora), revoke_reason = COALESCE(revoke_reason, 'refresh_reuse_detected'), updated_at = v_agora
     WHERE refresh_family_id = v_tok.family_id;
    INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, origem, request_id, resultado, motivo, ip_hash, user_agent)
      VALUES ('refresh_reuse', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.refresh_family_id, v_sess.client_type, p_origin, p_request_id, 'reuse_detected', 'refresh usado reapresentado fora da janela', v_sess.ip_hash, v_sess.user_agent);
    RETURN QUERY SELECT 'reuse_detected'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;

  -- 2. Token revogado / expirado
  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revogado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_tok.expires_at <= v_agora THEN
    RETURN QUERY SELECT 'expirado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;

  -- 3. Sessão revogada ou expiração absoluta
  IF v_sess.revoked_at IS NOT NULL OR v_sess.absolute_expires_at <= v_agora THEN
    RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;

  -- 4. Inatividade efetiva por client_type (R1B-B)
  -- Para web: prazo efetivo é MIN(idle_expires_at persistido, last_activity_at + 30 minutos).
  -- Para não-web (android, ios, api): preserva v_sess.idle_expires_at.
  IF v_sess.client_type = 'web' THEN
    IF LEAST(v_sess.idle_expires_at, v_sess.last_activity_at + interval '30 minutes') <= v_agora THEN
      RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
      RETURN;
    END IF;
  ELSE
    IF v_sess.idle_expires_at <= v_agora THEN
      RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
      RETURN;
    END IF;
  END IF;

  -- 5. Rotação bem-sucedida: marca usado + emite o novo (um único filho).
  v_new_ver := v_tok.version + 1;
  v_novo_expires_at := LEAST(p_novo_expires_at, v_sess.absolute_expires_at);
  INSERT INTO public.auth_refresh_tokens (session_id, family_id, token_hash, version, expires_at)
  VALUES (v_sess.id, v_sess.refresh_family_id, p_novo_token_hash, v_new_ver, v_novo_expires_at)
  RETURNING id INTO v_new_id;

  UPDATE public.auth_refresh_tokens SET used_at = v_agora, replaced_by = v_new_id WHERE id = v_tok.id;

  UPDATE public.auth_sessions
     SET last_activity_at = v_agora,
         idle_expires_at = CASE
           WHEN v_sess.client_type = 'web' THEN
             LEAST(p_novo_idle_expires_at, v_agora + interval '30 minutes', v_sess.absolute_expires_at)
           ELSE
             LEAST(p_novo_idle_expires_at, v_sess.absolute_expires_at)
         END,
         updated_at = v_agora
   WHERE id = v_sess.id;

  INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, origem, request_id, resultado, ip_hash, user_agent)
    VALUES ('refresh_sucesso', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.refresh_family_id, v_sess.client_type, p_origin, p_request_id, 'ok', v_sess.ip_hash, v_sess.user_agent);

  RETURN QUERY SELECT 'ok'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, v_new_id, v_new_ver, v_novo_expires_at;
END;
$$;

-- Permissões rigorosas mantidas
REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) TO service_role';
  END IF;
END $$;

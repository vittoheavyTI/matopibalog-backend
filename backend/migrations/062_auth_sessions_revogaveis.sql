-- 062_auth_sessions_revogaveis.sql
-- Macrofrente SEC-1 — Sessões Revogáveis e Endurecimento da Autenticação.
--
-- ADITIVA e REVERSÍVEL. Não altera o login atual, não apaga dados, não faz
-- backfill, não força relogin. Cria a infraestrutura de sessões usada pelos novos
-- logins (modo compatível); tokens legados de 7 dias seguem válidos até o Gate B.
--
-- Entrega: auth_sessions, auth_refresh_tokens, auth_event_audit (append-only real),
-- e as RPCs criar_sessao_auth / rotacionar_refresh_token (rotação single-use com
-- janela de graça: colisão→refresh_already_rotated sem revogar; reuse fora da janela
-- →reuse_detected revogando a família) / limpar_sessoes_expiradas (só sessões).
--
-- Hardening (complemento):
--   * auth_event_audit é APPEND-ONLY REAL: triggers bloqueiam UPDATE/DELETE (linha) e
--     TRUNCATE (statement) para QUALQUER papel; service_role recebe só INSERT+SELECT
--     (REVOKE UPDATE/DELETE/TRUNCATE) e NÃO é owner (não pode ALTER/DISABLE TRIGGER).
--   * RPCs SEM relógio injetável: usam now() (transaction_timestamp — constante na tx,
--     o que torna os testes de limite determinísticos ajustando used_at na MESMA tx).
--   * Janela de graça validada em faixa segura dentro da função (nunca do frontend).
--   * Auditoria sobrevive ao resultado (retorno estruturado, sem RAISE de domínio).
--   * Nenhum token/hash/pepper/cookie/Authorization é gravado ou retornado.
--
-- Reversão (não destrutiva por padrão):
--   DROP FUNCTION IF EXISTS public.revogar_sessao_auth(uuid,text,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.revogar_sessoes_usuario(uuid,text,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer);
--   DROP FUNCTION IF EXISTS public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid);
--   DROP FUNCTION IF EXISTS public.limpar_sessoes_expiradas(integer);
--   DROP TRIGGER  IF EXISTS trg_auth_event_audit_no_upd_del ON public.auth_event_audit;
--   DROP TRIGGER  IF EXISTS trg_auth_event_audit_no_truncate ON public.auth_event_audit;
--   DROP FUNCTION IF EXISTS public.auth_event_audit_append_only();
--   -- TABELAS: só se nunca receberam dados reais.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) auth_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id          uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  empresa_id          uuid NULL REFERENCES public.empresas(id) ON DELETE SET NULL,
  client_type         text NOT NULL CHECK (client_type IN ('web','android','ios','api')),
  device_id           text NULL,
  device_label        text NULL,
  refresh_family_id   uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_activity_at    timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz NULL,
  revoke_reason       text NULL,
  ip_hash             text NULL,   -- IP JÁ hasheado/mascarado pelo backend (nunca cru)
  user_agent          text NULL,   -- truncado pelo backend
  created_by          uuid NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_expiracao_chk CHECK (absolute_expires_at >= created_at),
  CONSTRAINT auth_sessions_idle_le_absolute_chk CHECK (idle_expires_at <= absolute_expires_at)
);

COMMENT ON TABLE public.auth_sessions IS 'SEC-1: sessões server-side revogáveis. Backend-only. Nunca guarda token aberto.';

CREATE INDEX IF NOT EXISTS idx_auth_sessions_usuario      ON public.auth_sessions (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_empresa      ON public.auth_sessions (empresa_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family       ON public.auth_sessions (refresh_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_ativas       ON public.auth_sessions (usuario_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_absolute_exp ON public.auth_sessions (absolute_expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) auth_refresh_tokens
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  family_id         uuid NOT NULL,
  token_hash        text NOT NULL,   -- HMAC/SHA(pepper || token) — nunca o token aberto
  version           int  NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz NULL,
  replaced_by       uuid NULL REFERENCES public.auth_refresh_tokens(id) ON DELETE SET NULL,
  revoked_at        timestamptz NULL,
  reuse_detected_at timestamptz NULL,
  CONSTRAINT auth_refresh_tokens_hash_uniq UNIQUE (token_hash)
);

COMMENT ON TABLE public.auth_refresh_tokens IS 'SEC-1: histórico de refresh (hash). Single-use rotativo; reuse fora da janela revoga a família.';

CREATE INDEX IF NOT EXISTS idx_auth_refresh_session ON public.auth_refresh_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_family  ON public.auth_refresh_tokens (family_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) auth_event_audit — trilha APPEND-ONLY de eventos de segurança de auth.
-- Suporta eventos SEM sessão (ex.: login_falha): quase tudo nullable.
-- NUNCA armazena token/hash/cookie/Authorization/OTP/senha/payload bruto.
-- Limites de tamanho em todos os campos textuais.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_event_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event             text NOT NULL,
  usuario_id        uuid NULL,
  empresa_id        uuid NULL,
  session_id        uuid NULL,
  refresh_family_id uuid NULL,
  client_type       text NULL,
  origem            text NULL,
  request_id        text NULL,
  resultado         text NULL,
  motivo            text NULL,   -- sanitizado pelo backend (sem stack trace/payload)
  ip_hash           text NULL,   -- IP mascarado/hasheado (nunca cru)
  user_agent        text NULL,   -- reduzido/sanitizado
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_event_audit_len_chk CHECK (
    char_length(event)       <= 64  AND
    char_length(coalesce(client_type,'')) <= 16  AND
    char_length(coalesce(origem,''))      <= 64  AND
    char_length(coalesce(request_id,''))  <= 128 AND
    char_length(coalesce(resultado,''))   <= 64  AND
    char_length(coalesce(motivo,''))      <= 500 AND
    char_length(coalesce(ip_hash,''))     <= 128 AND
    char_length(coalesce(user_agent,''))  <= 512
  )
);

COMMENT ON TABLE public.auth_event_audit IS 'SEC-1: auditoria append-only de auth. Sem token/hash/cookie/Authorization/OTP/senha.';

CREATE INDEX IF NOT EXISTS idx_auth_event_usuario ON public.auth_event_audit (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auth_event_session ON public.auth_event_audit (session_id);
CREATE INDEX IF NOT EXISTS idx_auth_event_family  ON public.auth_event_audit (refresh_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_event_created ON public.auth_event_audit (created_at);
CREATE INDEX IF NOT EXISTS idx_auth_event_event   ON public.auth_event_audit (event);

-- APPEND-ONLY REAL: bloqueia UPDATE/DELETE (linha) e TRUNCATE (statement) para
-- QUALQUER papel (triggers não são contornados por bypassrls). Retenção/purge
-- futura exige desabilitar os triggers sob controle explícito do owner (Gate A).
CREATE OR REPLACE FUNCTION public.auth_event_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'auth_event_audit e append-only (UPDATE/DELETE/TRUNCATE bloqueado)' USING ERRCODE = 'P0001';
END;
$$;
DROP TRIGGER IF EXISTS trg_auth_event_audit_no_upd_del  ON public.auth_event_audit;
DROP TRIGGER IF EXISTS trg_auth_event_audit_no_truncate ON public.auth_event_audit;
CREATE TRIGGER trg_auth_event_audit_no_upd_del
  BEFORE UPDATE OR DELETE ON public.auth_event_audit
  FOR EACH ROW EXECUTE FUNCTION public.auth_event_audit_append_only();
CREATE TRIGGER trg_auth_event_audit_no_truncate
  BEFORE TRUNCATE ON public.auth_event_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.auth_event_audit_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: habilita e força; sem policy → nega anon/authenticated. service_role bypassa.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auth_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_event_audit    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_event_audit    FORCE ROW LEVEL SECURITY;

-- Matriz de privilégios. auth_event_audit: service_role só INSERT+SELECT
-- (REVOKE UPDATE/DELETE/TRUNCATE — defesa em profundidade além dos triggers).
REVOKE ALL ON public.auth_sessions       FROM PUBLIC;
REVOKE ALL ON public.auth_refresh_tokens FROM PUBLIC;
REVOKE ALL ON public.auth_event_audit    FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.auth_sessions FROM anon';
    EXECUTE 'REVOKE ALL ON public.auth_refresh_tokens FROM anon';
    EXECUTE 'REVOKE ALL ON public.auth_event_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.auth_sessions FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.auth_refresh_tokens FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.auth_event_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_refresh_tokens TO service_role';
    EXECUTE 'REVOKE ALL ON public.auth_event_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON public.auth_event_audit TO service_role';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.auth_event_audit FROM service_role';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (D) criar_sessao_auth() — cria sessão + 1º refresh token (atômico).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_sessao_auth(
  p_usuario_id          uuid,
  p_empresa_id          uuid,
  p_client_type         text,
  p_device_id           text,
  p_device_label        text,
  p_refresh_family_id   uuid,
  p_refresh_token_hash  text,
  p_refresh_expires_at  timestamptz,
  p_idle_expires_at     timestamptz,
  p_absolute_expires_at timestamptz,
  p_ip_hash             text,
  p_user_agent          text,
  p_created_by          uuid
)
RETURNS TABLE (session_id uuid, refresh_family_id uuid, refresh_token_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_token_id   uuid;
BEGIN
  IF p_client_type NOT IN ('web','android','ios','api') THEN
    RAISE EXCEPTION 'client_type_invalido' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.auth_sessions (
    usuario_id, empresa_id, client_type, device_id, device_label,
    refresh_family_id, idle_expires_at, absolute_expires_at, ip_hash, user_agent, created_by
  ) VALUES (
    p_usuario_id, p_empresa_id, p_client_type, p_device_id, p_device_label,
    p_refresh_family_id, p_idle_expires_at, p_absolute_expires_at, p_ip_hash, p_user_agent, p_created_by
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.auth_refresh_tokens (session_id, family_id, token_hash, version, expires_at)
  VALUES (v_session_id, p_refresh_family_id, p_refresh_token_hash, 1, p_refresh_expires_at)
  RETURNING id INTO v_token_id;

  INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, resultado, motivo, ip_hash, user_agent)
    VALUES ('sessao_criada', p_usuario_id, p_empresa_id, v_session_id, p_refresh_family_id, p_client_type, 'ok', 'login', p_ip_hash, p_user_agent);

  RETURN QUERY SELECT v_session_id, p_refresh_family_id, v_token_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (E) rotacionar_refresh_token() — rotação single-use com janela de graça.
-- SEM relógio injetável: usa now() (constante na transação). p_grace_seconds vem
-- do CONFIG server-side (nunca do frontend) e é VALIDADO em faixa [0, 300].
-- Retorno estruturado (auditoria sobrevive; sem RAISE de domínio):
--   'ok' (200) · 'refresh_already_rotated' (409) · 'reuse_detected' (401)
--   'expirado'/'revogado'/'sessao_invalida'/'invalido' (401). Nunca retorna
--   token/hash/pepper/cookie.
-- ─────────────────────────────────────────────────────────────────────────────
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

  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revogado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_tok.expires_at <= v_agora THEN
    RETURN QUERY SELECT 'expirado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_sess.revoked_at IS NOT NULL OR v_sess.idle_expires_at <= v_agora OR v_sess.absolute_expires_at <= v_agora THEN
    RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int, NULL::timestamptz;
    RETURN;
  END IF;

  -- Rotação: marca usado + emite o novo (um único filho).
  v_new_ver := v_tok.version + 1;
  v_novo_expires_at := LEAST(p_novo_expires_at, v_sess.absolute_expires_at);
  INSERT INTO public.auth_refresh_tokens (session_id, family_id, token_hash, version, expires_at)
  VALUES (v_sess.id, v_sess.refresh_family_id, p_novo_token_hash, v_new_ver, v_novo_expires_at)
  RETURNING id INTO v_new_id;

  UPDATE public.auth_refresh_tokens SET used_at = v_agora, replaced_by = v_new_id WHERE id = v_tok.id;
  UPDATE public.auth_sessions
     SET last_activity_at = v_agora, idle_expires_at = LEAST(p_novo_idle_expires_at, absolute_expires_at), updated_at = v_agora
   WHERE id = v_sess.id;

  INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, origem, request_id, resultado, ip_hash, user_agent)
    VALUES ('refresh_sucesso', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.refresh_family_id, v_sess.client_type, p_origin, p_request_id, 'ok', v_sess.ip_hash, v_sess.user_agent);

  RETURN QUERY SELECT 'ok'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, v_new_id, v_new_ver, v_novo_expires_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (F) revogacao de sessoes com auditoria transacional.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revogar_sessao_auth(
  p_session_id uuid,
  p_motivo text,
  p_actor_usuario_id uuid DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_origin text DEFAULT NULL
)
RETURNS TABLE (revogada boolean, usuario_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sess public.auth_sessions%ROWTYPE;
  v_agora timestamptz := now();
  v_revogada boolean := false;
BEGIN
  SELECT * INTO v_sess FROM public.auth_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  IF v_sess.revoked_at IS NULL THEN
    UPDATE public.auth_sessions
       SET revoked_at = v_agora,
           revoke_reason = COALESCE(NULLIF(p_motivo, ''), 'revogacao'),
           updated_at = v_agora
     WHERE id = p_session_id;

    UPDATE public.auth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, v_agora)
     WHERE session_id = p_session_id
       AND revoked_at IS NULL;

    v_revogada := true;
  END IF;

  INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, refresh_family_id, client_type, origem, request_id, resultado, motivo, ip_hash, user_agent)
    VALUES ('sessao_revogada', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.refresh_family_id, v_sess.client_type, p_origin, p_request_id, CASE WHEN v_revogada THEN 'ok' ELSE 'already_revoked' END, COALESCE(NULLIF(p_motivo, ''), 'revogacao'), v_sess.ip_hash, v_sess.user_agent);

  RETURN QUERY SELECT v_revogada, v_sess.usuario_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revogar_sessoes_usuario(
  p_usuario_id uuid,
  p_motivo text,
  p_actor_usuario_id uuid DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_origin text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agora timestamptz := now();
  v_motivo text := COALESCE(NULLIF(p_motivo, ''), 'revogacao_usuario');
  v_count integer := 0;
BEGIN
  WITH atualizadas AS (
    UPDATE public.auth_sessions
       SET revoked_at = v_agora,
           revoke_reason = v_motivo,
           updated_at = v_agora
     WHERE usuario_id = p_usuario_id
       AND revoked_at IS NULL
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM atualizadas;

  UPDATE public.auth_refresh_tokens rt
     SET revoked_at = COALESCE(rt.revoked_at, v_agora)
    FROM public.auth_sessions s
   WHERE rt.session_id = s.id
     AND s.usuario_id = p_usuario_id
     AND rt.revoked_at IS NULL;

  INSERT INTO public.auth_event_audit (event, usuario_id, origem, request_id, resultado, motivo)
    VALUES ('sessoes_usuario_revogadas', p_usuario_id, p_origin, p_request_id, 'ok', v_motivo);

  RETURN v_count;
END;
$$;

-- (G) limpar_sessoes_expiradas(p_reter_dias): manutencao de sessoes, sem purge de auditoria.
CREATE OR REPLACE FUNCTION public.limpar_sessoes_expiradas(p_reter_dias integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removidas integer;
  v_corte timestamptz := now() - make_interval(days => GREATEST(p_reter_dias, 0));
BEGIN
  WITH del AS (
    DELETE FROM public.auth_sessions
     WHERE (revoked_at IS NOT NULL AND revoked_at < v_corte) OR (absolute_expires_at < v_corte)
    RETURNING 1
  )
  SELECT count(*) INTO v_removidas FROM del;
  RETURN v_removidas;
END;
$$;

-- EXECUTE só para o backend (service_role). Nega PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revogar_sessao_auth(uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revogar_sessoes_usuario(uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.revogar_sessao_auth(uuid,text,uuid,text,text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.revogar_sessoes_usuario(uuid,text,uuid,text,text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.revogar_sessao_auth(uuid,text,uuid,text,text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.revogar_sessoes_usuario(uuid,text,uuid,text,text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.revogar_sessao_auth(uuid,text,uuid,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.revogar_sessoes_usuario(uuid,text,uuid,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.limpar_sessoes_expiradas(integer) TO service_role';
  END IF;
END $$;

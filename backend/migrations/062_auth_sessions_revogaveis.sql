-- 062_auth_sessions_revogaveis.sql
-- Macrofrente SEC-1 — Sessões Revogáveis e Endurecimento da Autenticação.
--
-- ADITIVA e REVERSÍVEL. Não altera o fluxo de login atual, não apaga dados, não
-- faz backfill, não força relogin. Cria a infraestrutura de sessões server-side
-- que passa a ser usada pelos novos logins (modo compatível); tokens legados de
-- 7 dias continuam válidos até o Gate B (modo estrito).
--
-- Entrega:
--   (A) Tabela auth_sessions: identidade da sessão (usuário/tenant/cliente/
--       dispositivo), atividade, expiração por inatividade e absoluta, revogação
--       com motivo, e família de refresh (para revogar a linhagem inteira).
--   (B) Tabela auth_refresh_tokens: histórico de refresh tokens (hash, versão,
--       uso, substituição, reuse) — permite rotação single-use e DETECÇÃO DE
--       REUTILIZAÇÃO com revogação de família.
--   (C) RPC criar_sessao_auth(): cria a sessão + o 1º refresh token, atômico.
--   (D) RPC rotacionar_refresh_token(): valida o refresh apresentado, detecta
--       reuse (→ revoga a família), aplica inatividade/expiração absoluta,
--       rotaciona o token (marca o antigo usado, emite o novo) e atualiza a
--       atividade — TUDO na MESMA transação.
--   (E) RPC limpar_sessoes_expiradas(): manutenção (retenção configurável).
--
-- Segurança:
--   * Nenhum token é armazenado aberto — só SHA-256(pepper || token) via caller.
--   * Tabelas com RLS habilitado e SEM policies para anon/authenticated; o backend
--     usa service_role (bypassa RLS). REVOKE explícito de PUBLIC/anon/authenticated.
--   * RPCs SECURITY INVOKER (rodam como o chamador = service_role), search_path
--     fixado, EXECUTE revogado de PUBLIC/anon/authenticated.
--   * IP é armazenado JÁ HASHEADO/mascarado pelo caller (coluna ip_hash), nunca cru.
--
-- Reversão (não destrutiva por padrão): DROP das RPCs; as TABELAS só devem ser
-- dropadas se NUNCA receberam sessões reais (senão preservar para auditoria).
--   DROP FUNCTION IF EXISTS public.limpar_sessoes_expiradas(integer);
--   DROP FUNCTION IF EXISTS public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,timestamptz);
--   DROP FUNCTION IF EXISTS public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid);
--   -- DROP TABLE IF EXISTS public.auth_refresh_tokens;  -- só se vazia/descartável
--   -- DROP TABLE IF EXISTS public.auth_sessions;        -- só se vazia/descartável

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
  CONSTRAINT auth_sessions_expiracao_chk CHECK (absolute_expires_at >= created_at)
);

COMMENT ON TABLE public.auth_sessions IS 'SEC-1: sessões server-side revogáveis. Backend-only (service_role). Nunca guarda token aberto.';

CREATE INDEX IF NOT EXISTS idx_auth_sessions_usuario        ON public.auth_sessions (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_empresa        ON public.auth_sessions (empresa_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family         ON public.auth_sessions (refresh_family_id);
-- Sessões ativas (revoked_at NULL): usado por "listar minhas sessões" e revogações em massa.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_ativas         ON public.auth_sessions (usuario_id) WHERE revoked_at IS NULL;
-- Manutenção/limpeza por expiração.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_absolute_exp   ON public.auth_sessions (absolute_expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) auth_refresh_tokens (histórico p/ rotação single-use + reuse detection)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  family_id         uuid NOT NULL,
  token_hash        text NOT NULL,   -- SHA-256(pepper || refresh_token) — nunca o token aberto
  version           int  NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz NULL,        -- setado na rotação (single-use)
  replaced_by       uuid NULL REFERENCES public.auth_refresh_tokens(id) ON DELETE SET NULL,
  revoked_at        timestamptz NULL,
  reuse_detected_at timestamptz NULL,
  CONSTRAINT auth_refresh_tokens_hash_uniq UNIQUE (token_hash)
);

COMMENT ON TABLE public.auth_refresh_tokens IS 'SEC-1: histórico de refresh tokens (hash). Single-use rotativo; reuse de token já usado revoga a família.';

CREATE INDEX IF NOT EXISTS idx_auth_refresh_session ON public.auth_refresh_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_family  ON public.auth_refresh_tokens (family_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: habilita e NÃO cria policy → nega tudo para anon/authenticated.
-- service_role (backend) bypassa RLS. Defesa em profundidade.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auth_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.auth_sessions       FROM PUBLIC;
REVOKE ALL ON public.auth_refresh_tokens FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.auth_sessions FROM anon';
    EXECUTE 'REVOKE ALL ON public.auth_refresh_tokens FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.auth_sessions FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.auth_refresh_tokens FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_refresh_tokens TO service_role';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) RPC criar_sessao_auth() — cria sessão + 1º refresh token (atômico).
-- Retorna o session_id e o refresh_family_id. O access token (JWT) é assinado
-- pelo backend a partir do session_id retornado.
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
    refresh_family_id, idle_expires_at, absolute_expires_at,
    ip_hash, user_agent, created_by
  ) VALUES (
    p_usuario_id, p_empresa_id, p_client_type, p_device_id, p_device_label,
    p_refresh_family_id, p_idle_expires_at, p_absolute_expires_at,
    p_ip_hash, p_user_agent, p_created_by
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.auth_refresh_tokens (
    session_id, family_id, token_hash, version, expires_at
  ) VALUES (
    v_session_id, p_refresh_family_id, p_refresh_token_hash, 1, p_refresh_expires_at
  )
  RETURNING id INTO v_token_id;

  RETURN QUERY SELECT v_session_id, p_refresh_family_id, v_token_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (D) RPC rotacionar_refresh_token() — rotação single-use + reuse detection.
-- Recebe o HASH do refresh apresentado e os dados do NOVO refresh (gerado e
-- hasheado pelo backend). Contrato de retorno (coluna `resultado`):
--   'ok'              → rotacionado; retorna novo token_id/version + session_id/usuario_id/empresa_id
--   'invalido'        → hash não existe
--   'expirado'        → refresh apresentado expirou
--   'revogado'        → token/sessão já revogados
--   'sessao_invalida' → sessão revogada ou expirada (idle/absoluta)
--   'reuse_detected'  → token JÁ usado reapresentado → FAMÍLIA revogada (P: revoga tudo)
-- Concorrência: SELECT ... FOR UPDATE na linha do token e na sessão serializa
-- duas rotações simultâneas do MESMO token — a 2ª vê used_at != NULL → reuse.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rotacionar_refresh_token(
  p_apresentado_hash    text,
  p_novo_token_hash     text,
  p_novo_expires_at     timestamptz,
  p_novo_idle_expires_at timestamptz,
  p_agora               timestamptz DEFAULT now()
)
RETURNS TABLE (
  resultado        text,
  session_id       uuid,
  usuario_id       uuid,
  empresa_id       uuid,
  client_type      text,
  novo_token_id    uuid,
  nova_version     int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tok   public.auth_refresh_tokens%ROWTYPE;
  v_sess  public.auth_sessions%ROWTYPE;
  v_new_id uuid;
  v_new_ver int;
BEGIN
  -- 1) Localiza e TRAVA a linha do token apresentado.
  SELECT * INTO v_tok
    FROM public.auth_refresh_tokens
   WHERE token_hash = p_apresentado_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- 2) Trava a sessão associada.
  SELECT * INTO v_sess FROM public.auth_sessions WHERE id = v_tok.session_id FOR UPDATE;

  -- 3) REUSE: token já usado (rotacionado) sendo reapresentado → revoga a FAMÍLIA.
  IF v_tok.used_at IS NOT NULL OR v_tok.reuse_detected_at IS NOT NULL THEN
    UPDATE public.auth_refresh_tokens
       SET reuse_detected_at = COALESCE(reuse_detected_at, p_agora),
           revoked_at        = COALESCE(revoked_at, p_agora)
     WHERE family_id = v_tok.family_id;
    UPDATE public.auth_sessions
       SET revoked_at   = COALESCE(revoked_at, p_agora),
           revoke_reason = COALESCE(revoke_reason, 'refresh_reuse_detected'),
           updated_at   = p_agora
     WHERE refresh_family_id = v_tok.family_id;
    RETURN QUERY SELECT 'reuse_detected'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- 4) Token revogado explicitamente.
  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revogado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- 5) Token expirado.
  IF v_tok.expires_at <= p_agora THEN
    RETURN QUERY SELECT 'expirado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- 6) Sessão inválida (revogada ou expirada por idle/absoluta).
  IF v_sess.revoked_at IS NOT NULL
     OR v_sess.idle_expires_at <= p_agora
     OR v_sess.absolute_expires_at <= p_agora THEN
    RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- 7) Rotação: marca o atual como usado e emite o novo (version+1).
  v_new_ver := v_tok.version + 1;
  INSERT INTO public.auth_refresh_tokens (session_id, family_id, token_hash, version, expires_at)
  VALUES (v_sess.id, v_sess.refresh_family_id, p_novo_token_hash, v_new_ver, p_novo_expires_at)
  RETURNING id INTO v_new_id;

  UPDATE public.auth_refresh_tokens
     SET used_at = p_agora, replaced_by = v_new_id
   WHERE id = v_tok.id;

  -- 8) Atualiza atividade e desliza a inatividade (nunca além do teto absoluto).
  UPDATE public.auth_sessions
     SET last_activity_at = p_agora,
         idle_expires_at  = LEAST(p_novo_idle_expires_at, absolute_expires_at),
         updated_at       = p_agora
   WHERE id = v_sess.id;

  RETURN QUERY SELECT 'ok'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, v_new_id, v_new_ver;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (E) RPC limpar_sessoes_expiradas(p_reter_dias) — manutenção.
-- Remove sessões (e, por cascade, seus tokens) já revogadas/expiradas há mais de
-- p_reter_dias. Retorna a quantidade removida. Preserva o histórico recente para
-- auditoria. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
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
     WHERE (revoked_at IS NOT NULL AND revoked_at < v_corte)
        OR (absolute_expires_at < v_corte)
    RETURNING 1
  )
  SELECT count(*) INTO v_removidas FROM del;
  RETURN v_removidas;
END;
$$;

-- EXECUTE só para o backend (service_role). Nega PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,timestamptz) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,timestamptz) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.limpar_sessoes_expiradas(integer) TO service_role';
  END IF;
END $$;

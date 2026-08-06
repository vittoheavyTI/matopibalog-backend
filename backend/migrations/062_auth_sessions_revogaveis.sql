-- 062_auth_sessions_revogaveis.sql
-- Macrofrente SEC-1 — Sessões Revogáveis e Endurecimento da Autenticação.
--
-- ADITIVA e REVERSÍVEL. Não altera o fluxo de login atual, não apaga dados, não
-- faz backfill, não força relogin. Cria a infraestrutura de sessões server-side
-- usada pelos novos logins (modo compatível); tokens legados de 7 dias continuam
-- válidos até o Gate B (modo estrito).
--
-- Entrega:
--   (A) auth_sessions      — identidade/atividade/expiração/revogação da sessão.
--   (B) auth_refresh_tokens — histórico de refresh (hash, versão, uso, reuse).
--   (C) auth_event_audit   — trilha append-only de eventos de segurança de auth
--                            (SEM token/hash/cookie/Authorization; só metadados).
--   (D) criar_sessao_auth()          — cria sessão + 1º refresh, atômico.
--   (E) rotacionar_refresh_token()   — rotação single-use com POLÍTICA de janela:
--         • rotação normal → 'ok';
--         • MESMO refresh reapresentado DENTRO de janela curta após a rotação
--           (colisão concorrente / retry de resposta perdida) → 'refresh_already_rotated'
--           (NÃO revoga família, NÃO emite novo token, audita a colisão);
--         • refresh já usado reapresentado FORA da janela (reuse suspeito) →
--           'reuse_detected' (revoga a FAMÍLIA + sessão, audita), sem afetar outra família.
--   (F) limpar_sessoes_expiradas()   — manutenção (retenção configurável).
--
-- Segurança:
--   * Nenhum token/segredo é armazenado aberto — só HMAC/SHA do token (pepper no caller).
--   * RLS habilitado E forçado; sem policy para anon/authenticated (nega); service_role
--     (backend) tem privilégios; REVOKE explícito de PUBLIC/anon/authenticated.
--   * auth_event_audit é APPEND-ONLY na aplicação: service_role recebe só SELECT+INSERT.
--   * RPCs SECURITY INVOKER, search_path fixo, EXECUTE só service_role.
--   * IP chega JÁ hasheado/mascarado pelo caller (ip_hash), nunca cru.
--
-- Reversão (não destrutiva por padrão): DROP das funções; TABELAS só se nunca
-- receberam dados reais (senão preservar para auditoria).

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

COMMENT ON TABLE public.auth_sessions IS 'SEC-1: sessões server-side revogáveis. Backend-only (service_role). Nunca guarda token aberto.';

CREATE INDEX IF NOT EXISTS idx_auth_sessions_usuario        ON public.auth_sessions (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_empresa        ON public.auth_sessions (empresa_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family         ON public.auth_sessions (refresh_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_ativas         ON public.auth_sessions (usuario_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_absolute_exp   ON public.auth_sessions (absolute_expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) auth_refresh_tokens (histórico p/ rotação single-use + reuse detection)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  family_id         uuid NOT NULL,
  token_hash        text NOT NULL,   -- HMAC/SHA(pepper || refresh_token) — nunca o token aberto
  version           int  NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz NULL,        -- setado na rotação (single-use)
  replaced_by       uuid NULL REFERENCES public.auth_refresh_tokens(id) ON DELETE SET NULL,
  revoked_at        timestamptz NULL,
  reuse_detected_at timestamptz NULL,
  CONSTRAINT auth_refresh_tokens_hash_uniq UNIQUE (token_hash)
);

COMMENT ON TABLE public.auth_refresh_tokens IS 'SEC-1: histórico de refresh tokens (hash). Single-use rotativo; reuse fora da janela revoga a família.';

CREATE INDEX IF NOT EXISTS idx_auth_refresh_session ON public.auth_refresh_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_family  ON public.auth_refresh_tokens (family_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) auth_event_audit — trilha APPEND-ONLY de eventos de segurança de auth.
-- NUNCA armazena token, hash de token, cookie nem Authorization. Só metadados.
-- Sem FK forte (auditoria não pode ser bloqueada/cascateada por eventos de conta).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_event_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event       text NOT NULL,   -- ex.: login_sucesso, sessao_criada, refresh_sucesso,
                               -- refresh_colisao, refresh_reuse, sessao_revogada, logout, ...
  usuario_id  uuid NULL,
  empresa_id  uuid NULL,
  session_id  uuid NULL,
  client_type text NULL,
  origem      text NULL,
  request_id  text NULL,
  resultado   text NULL,       -- ok | negado | erro | refresh_already_rotated | reuse_detected | ...
  motivo      text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auth_event_audit IS 'SEC-1: auditoria append-only de eventos de auth. Sem token/hash/cookie/Authorization.';

CREATE INDEX IF NOT EXISTS idx_auth_event_usuario ON public.auth_event_audit (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auth_event_session ON public.auth_event_audit (session_id);
CREATE INDEX IF NOT EXISTS idx_auth_event_created ON public.auth_event_audit (created_at);
CREATE INDEX IF NOT EXISTS idx_auth_event_event   ON public.auth_event_audit (event);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: habilita e força; sem policy → nega anon/authenticated. service_role bypassa.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auth_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_event_audit    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auth_event_audit    FORCE ROW LEVEL SECURITY;

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
    -- Auditoria APPEND-ONLY: só SELECT + INSERT (sem UPDATE/DELETE).
    EXECUTE 'GRANT SELECT, INSERT ON public.auth_event_audit TO service_role';
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
-- (E) rotacionar_refresh_token() — rotação single-use com POLÍTICA de janela.
-- Contrato de retorno (coluna `resultado`):
--   'ok'                     → rotacionado; novo_token_id/version + dados da sessão.
--   'invalido'               → hash não existe.
--   'expirado'               → refresh apresentado expirou.
--   'revogado'               → token revogado (ex.: família já revogada).
--   'sessao_invalida'        → sessão revogada ou expirada (idle/absoluta).
--   'refresh_already_rotated'→ COLISÃO CONCORRENTE / retry: token usado reapresentado
--                              DENTRO da janela de graça → NÃO revoga, NÃO emite novo,
--                              audita 'refresh_colisao'. (HTTP 409 no backend.)
--   'reuse_detected'         → REUSE suspeito: token usado reapresentado FORA da janela
--                              → revoga a FAMÍLIA + sessão, audita 'refresh_reuse'.
-- Concorrência: FOR UPDATE na linha do token serializa; a 2ª conexão vê used_at já
-- setado (recente) → 'refresh_already_rotated' (família intacta), nunca 2 filhos.
-- p_agora permite relógio controlado nos testes (limites da janela).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rotacionar_refresh_token(
  p_apresentado_hash     text,
  p_novo_token_hash      text,
  p_novo_expires_at      timestamptz,
  p_novo_idle_expires_at timestamptz,
  p_request_id           text DEFAULT NULL,
  p_origin               text DEFAULT NULL,
  p_grace_seconds        integer DEFAULT 10,
  p_agora                timestamptz DEFAULT now()
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
  v_tok    public.auth_refresh_tokens%ROWTYPE;
  v_sess   public.auth_sessions%ROWTYPE;
  v_new_id uuid;
  v_new_ver int;
  v_grace  interval := make_interval(secs => GREATEST(COALESCE(p_grace_seconds, 0), 0));
BEGIN
  SELECT * INTO v_tok FROM public.auth_refresh_tokens WHERE token_hash = p_apresentado_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  SELECT * INTO v_sess FROM public.auth_sessions WHERE id = v_tok.session_id FOR UPDATE;

  -- Token JÁ usado (rotacionado) sendo reapresentado.
  IF v_tok.used_at IS NOT NULL THEN
    -- COLISÃO concorrente / retry: dentro da janela, família ainda íntegra e sessão válida.
    IF v_tok.reuse_detected_at IS NULL
       AND v_sess.revoked_at IS NULL
       AND (p_agora - v_tok.used_at) <= v_grace THEN
      INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, client_type, origem, request_id, resultado, motivo)
        VALUES ('refresh_colisao', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.client_type, p_origin, p_request_id, 'refresh_already_rotated', 'retry/colisao concorrente na janela');
      RETURN QUERY SELECT 'refresh_already_rotated'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
      RETURN;
    END IF;
    -- REUSE suspeito (fora da janela ou família já marcada): revoga a FAMÍLIA.
    UPDATE public.auth_refresh_tokens
       SET reuse_detected_at = COALESCE(reuse_detected_at, p_agora),
           revoked_at        = COALESCE(revoked_at, p_agora)
     WHERE family_id = v_tok.family_id;
    UPDATE public.auth_sessions
       SET revoked_at    = COALESCE(revoked_at, p_agora),
           revoke_reason = COALESCE(revoke_reason, 'refresh_reuse_detected'),
           updated_at    = p_agora
     WHERE refresh_family_id = v_tok.family_id;
    INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, client_type, origem, request_id, resultado, motivo)
      VALUES ('refresh_reuse', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.client_type, p_origin, p_request_id, 'reuse_detected', 'refresh usado reapresentado fora da janela');
    RETURN QUERY SELECT 'reuse_detected'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- Token não usado mas revogado (ex.: família revogada por reuse) → inutilizável.
  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revogado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  IF v_tok.expires_at <= p_agora THEN
    RETURN QUERY SELECT 'expirado'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  IF v_sess.revoked_at IS NOT NULL
     OR v_sess.idle_expires_at <= p_agora
     OR v_sess.absolute_expires_at <= p_agora THEN
    RETURN QUERY SELECT 'sessao_invalida'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, NULL::uuid, NULL::int;
    RETURN;
  END IF;

  -- Rotação: marca o atual como usado e emite o novo (version+1). Um único filho.
  v_new_ver := v_tok.version + 1;
  INSERT INTO public.auth_refresh_tokens (session_id, family_id, token_hash, version, expires_at)
  VALUES (v_sess.id, v_sess.refresh_family_id, p_novo_token_hash, v_new_ver, p_novo_expires_at)
  RETURNING id INTO v_new_id;

  UPDATE public.auth_refresh_tokens SET used_at = p_agora, replaced_by = v_new_id WHERE id = v_tok.id;

  UPDATE public.auth_sessions
     SET last_activity_at = p_agora,
         idle_expires_at  = LEAST(p_novo_idle_expires_at, absolute_expires_at),
         updated_at       = p_agora
   WHERE id = v_sess.id;

  INSERT INTO public.auth_event_audit (event, usuario_id, empresa_id, session_id, client_type, origem, request_id, resultado)
    VALUES ('refresh_sucesso', v_sess.usuario_id, v_sess.empresa_id, v_sess.id, v_sess.client_type, p_origin, p_request_id, 'ok');

  RETURN QUERY SELECT 'ok'::text, v_sess.id, v_sess.usuario_id, v_sess.empresa_id, v_sess.client_type, v_new_id, v_new_ver;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (F) limpar_sessoes_expiradas(p_reter_dias) — manutenção.
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
REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer,timestamptz) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer,timestamptz) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.limpar_sessoes_expiradas(integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.criar_sessao_auth(uuid,uuid,text,text,text,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rotacionar_refresh_token(text,text,timestamptz,timestamptz,text,text,integer,timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.limpar_sessoes_expiradas(integer) TO service_role';
  END IF;
END $$;

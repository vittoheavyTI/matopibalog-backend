-- 064_frete_tracking_credenciais.sql
-- Macrofrente SEC-1 — Credencial Operacional Escopada de Rastreamento (GPS/Torre).
--
-- NUMBERING (coordenação de stacks):
--   * SEC-1 (#414) usa a migration 062 (auth_sessions). Este HEAD termina em 062.
--   * A macrofrente 3A-2 (#416, CONGELADA/ainda não mergeada) já reserva a 063 em
--     branch stacked. Para NÃO criar conflito silencioso de numbering, esta
--     migration usa deliberadamente o número 064 (posterior a ambas). O gap 063 é
--     intencional e seguro: o applier de teste (backend/tests-pg/apply_schema.mjs) e
--     a aplicação em produção (Supabase, arquivo a arquivo) usam LISTA EXPLÍCITA de
--     arquivos — não há runner que exija contiguidade ou quebre com gaps.
--
-- ADITIVA e REVERSÍVEL. Não altera o login, o rastreamento atual, nem qualquer
-- tabela existente. Não faz backfill. Cria a infraestrutura da credencial de
-- rastreamento usada SOMENTE quando a feature flag TRACKING_SCOPED_CREDENTIAL_ENABLED
-- estiver ON (modo compatível; default OFF preserva o comportamento atual).
--
-- MODELO DE SEGURANÇA (resumo — ver docs/sec-1/08-tracking-credential.md):
--   * A credencial é um token OPACO (CSPRNG, alta entropia) — NUNCA gravado em claro.
--     Só o HMAC-SHA-256(pepper, token) (`credential_hash`) vai ao banco.
--   * Escopo mínimo: empresa + motorista (+ device/frete/sessão de contexto). Autoriza
--     APENAS telemetria de localização da própria empresa/motorista. Nunca autentica
--     /auth/me, /admin/*, faturas, fretes gerais, etc. (isso é papel do middleware).
--   * Revogável imediatamente (revoked_at). Expira por expires_at (server-side).
--   * RLS habilitada e forçada; sem policy → nega anon/authenticated. service_role
--     (backend) bypassa. EXECUTE/DML só para o backend.
--
-- Reversão (não destrutiva por padrão; só se nunca receberam dados reais):
--   DROP TABLE IF EXISTS public.frete_tracking_credencial_fretes;
--   DROP TABLE IF EXISTS public.frete_tracking_credenciais;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela: frete_tracking_credenciais
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.frete_tracking_credenciais (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id)  ON DELETE CASCADE,
  motorista_id    uuid NOT NULL REFERENCES public.usuarios(id)  ON DELETE CASCADE,
  -- BINDING CANÔNICO (MULTI-VIAGEM com ESCOPO IMUTÁVEL): a ÂNCORA é SESSÃO SEC-1 + DEVICE.
  -- O CONJUNTO de viagens autorizadas é um SNAPSHOT capturado na emissão e persistido na
  -- tabela de vínculo `frete_tracking_credencial_fretes` (server-side, nunca IDs do
  -- cliente). Isso IMPEDE "ressurreição": uma viagem FUTURA nunca entra no escopo de uma
  -- credencial antiga — só nova emissão SEC-1 autenticada cria novo escopo.
  --   session_id: FK ON DELETE CASCADE — âncora; sessão apagada → credencial some junto.
  -- (Não há coluna frete_id contextual: seria redundante e um convite a autorizar por ela.
  --  A autoridade de escopo é EXCLUSIVAMENTE a tabela de vínculo.)
  session_id      uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  device_id       text NOT NULL,   -- device binding: comparado em cada requisição
  -- HMAC-SHA-256(pepper, 'tracking:'||token) em hex. NUNCA o token aberto. Rotaciona
  -- (CAS in-place) a cada renovação → o hash antigo deixa de existir (single-use real).
  credential_hash text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,   -- validade NOMINAL (telemetria)
  max_expires_at  timestamptz NOT NULL,   -- TETO ABSOLUTO: a renovação nunca ultrapassa
  last_used_at    timestamptz NULL,
  revoked_at      timestamptz NULL,
  revoked_reason  text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frete_tracking_cred_hash_uniq   UNIQUE (credential_hash),
  CONSTRAINT frete_tracking_cred_exp_chk     CHECK (expires_at >= issued_at),
  CONSTRAINT frete_tracking_cred_max_chk     CHECK (max_expires_at >= expires_at),
  CONSTRAINT frete_tracking_cred_devlen_chk  CHECK (char_length(device_id) BETWEEN 1 AND 128),
  CONSTRAINT frete_tracking_cred_reason_chk  CHECK (char_length(coalesce(revoked_reason, '')) <= 200)
);

COMMENT ON TABLE public.frete_tracking_credenciais IS
  'SEC-1: credencial operacional escopada de rastreamento GPS. Backend-only. Guarda só o HMAC do token (nunca o token aberto). Âncora sessao SEC-1 + device; escopo de viagens = SNAPSHOT imutável na tabela de vínculo; telemetria-only, revogável, expira server-side, teto absoluto e rotação single-use.';

CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_motorista ON public.frete_tracking_credenciais (motorista_id);
CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_empresa   ON public.frete_tracking_credenciais (empresa_id);
CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_session   ON public.frete_tracking_credenciais (session_id);
CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_ativas    ON public.frete_tracking_credenciais (motorista_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_expires   ON public.frete_tracking_credenciais (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela de VÍNCULO (escopo IMUTÁVEL): quais fretes uma credencial pode rastrear.
-- Snapshot da emissão. A telemetria faz fan-out SOMENTE para (escopo ∩ ainda-ativos).
-- Uma viagem FUTURA nunca é adicionada aqui por renovação — só por nova emissão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.frete_tracking_credencial_fretes (
  credencial_id uuid NOT NULL REFERENCES public.frete_tracking_credenciais(id) ON DELETE CASCADE,
  frete_id      uuid NOT NULL REFERENCES public.fretes(id)                     ON DELETE CASCADE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frete_tracking_cred_fretes_pk PRIMARY KEY (credencial_id, frete_id)
);

COMMENT ON TABLE public.frete_tracking_credencial_fretes IS
  'SEC-1: escopo IMUTÁVEL (snapshot da emissão) de viagens autorizadas por credencial de rastreamento. Autoridade única do fan-out. Renovação NÃO amplia; viagem futura exige nova emissão.';

CREATE INDEX IF NOT EXISTS idx_frete_tracking_cred_fretes_frete ON public.frete_tracking_credencial_fretes (frete_id);

ALTER TABLE public.frete_tracking_credencial_fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frete_tracking_credencial_fretes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.frete_tracking_credencial_fretes FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.frete_tracking_credencial_fretes FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.frete_tracking_credencial_fretes FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.frete_tracking_credencial_fretes TO service_role';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: habilita e força; sem policy → nega anon/authenticated. service_role bypassa.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.frete_tracking_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frete_tracking_credenciais FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.frete_tracking_credenciais FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.frete_tracking_credenciais FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.frete_tracking_credenciais FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.frete_tracking_credenciais TO service_role';
  END IF;
END $$;

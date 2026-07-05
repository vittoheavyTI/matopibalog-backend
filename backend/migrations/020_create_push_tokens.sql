-- Migration 020: tabela de tokens FCM (push das notificacoes do app)
-- Rodar no Supabase SQL Editor (NAO aplicar automaticamente em producao aqui).
--
-- Escopo:
--   * guarda para quais aparelhos (tokens FCM) um usuario pode receber push;
--   * a FONTE DA VERDADE das notificacoes continua sendo a tabela `notificacoes`
--     (migrations 013/019). Esta tabela so mapeia usuario -> aparelhos;
--   * token invalido/expirado e marcado ativo=false pelo backend (pushService),
--     nunca apagado, para manter historico;
--   * idempotente (pode rodar mais de uma vez sem erro).
--
-- Backend acessa via service_role (BYPASSRLS): a API funciona independente das
-- policies. As policies abaixo protegem um eventual acesso direto com JWT do
-- Supabase (auth.uid()), no mesmo espirito da migration 015.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id  UUID NULL REFERENCES empresas(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'android',
  device_id   TEXT NULL,
  app_version TEXT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NULL
);

-- Um token FCM identifica unicamente um par app+aparelho. UNIQUE permite o
-- upsert (onConflict: 'token') do endpoint POST /push/tokens.
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_key
  ON push_tokens (token);

-- Envio de push: busca tokens ativos de um usuario.
CREATE INDEX IF NOT EXISTS push_tokens_usuario_ativo_idx
  ON push_tokens (usuario_id, ativo);

-- Consultas administrativas por empresa.
CREATE INDEX IF NOT EXISTS push_tokens_empresa_ativo_idx
  ON push_tokens (empresa_id, ativo);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: cada usuario so ve/gerencia os proprios tokens. service_role bypassa.
-- Sem recursao (nao consulta `usuarios`), entao dispensa helper SECURITY DEFINER.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_owner_access ON push_tokens;
CREATE POLICY push_tokens_owner_access ON push_tokens
  FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

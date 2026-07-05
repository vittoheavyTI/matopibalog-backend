-- Migration 019: completar a base de notificacoes internas.
-- Rodar no Supabase SQL Editor (sem rollback automatico). NAO aplicada por codigo.
--
-- A tabela foi criada pela migration 013. Esta evolucao e aditiva e idempotente:
-- adiciona auditoria de leitura, metadata minima, deduplicacao e indices alinhados
-- as consultas do backend. Notificacoes de empresa sao materializadas por usuario
-- pelo service, preservando o status lida/nao lida individual.

ALTER TABLE notificacoes
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario_lida_created_at
  ON notificacoes (usuario_id, lida, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacoes_empresa_created_at
  ON notificacoes (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacoes_tipo_created_at
  ON notificacoes (tipo, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notificacoes_dedupe_key
  ON notificacoes (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- A API do produto usa exclusivamente o backend com service_role. Mantemos RLS
-- como defesa em profundidade para acessos autenticados diretos e separamos
-- SELECT/UPDATE para que a politica de UPDATE tenha USING e WITH CHECK explicitos.
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_own ON notificacoes;
DROP POLICY IF EXISTS notificacoes_select_own ON notificacoes;
DROP POLICY IF EXISTS notificacoes_update_own ON notificacoes;

CREATE POLICY notificacoes_select_own ON notificacoes
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = usuario_id);

CREATE POLICY notificacoes_update_own ON notificacoes
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = usuario_id)
  WITH CHECK ((SELECT auth.uid()) = usuario_id);

REVOKE ALL ON notificacoes FROM anon;
REVOKE INSERT, DELETE, UPDATE ON notificacoes FROM authenticated;
GRANT SELECT ON notificacoes TO authenticated;
GRANT UPDATE (lida, read_at) ON notificacoes TO authenticated;
GRANT ALL ON notificacoes TO service_role;

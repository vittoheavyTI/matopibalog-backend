-- Migration 013: Tabela de notificações internas
-- Rodar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS notificacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id),
  tipo VARCHAR(60) NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  mensagem TEXT NOT NULL,
  referencia_tipo VARCHAR(40),
  referencia_id UUID,
  lida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_empresa ON notificacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida);

-- RLS: cada usuário só vê suas próprias notificações
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificacoes_own ON notificacoes
  FOR ALL USING (auth.uid() = usuario_id);

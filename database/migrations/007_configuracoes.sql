-- Migration 007: Tabela de configurações do sistema
-- Criada em: 2026-05-18
-- NOTA: Tabela nova, não afeta tabelas existentes.

CREATE TABLE IF NOT EXISTS configuracoes (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dados JSONB NOT NULL DEFAULT '{}',
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- Inserir registro único (falha silenciosamente se já existir)
INSERT INTO configuracoes (id, dados) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

-- RLS: apenas admin pode acessar
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin pode tudo em configuracoes" ON configuracoes
  FOR ALL TO authenticated
  USING ((SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin');

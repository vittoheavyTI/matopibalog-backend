-- ============================================================
-- Migração: Adicionar colunas faltantes na tabela usuarios
-- Data: 2026-05-17
-- Executar no Supabase SQL Editor
-- ============================================================

-- Adicionar todas as colunas que podem estar faltando
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB DEFAULT '{"dashboard": true, "motoristas": true, "relatorios": true, "usuarios": false, "configuracoes": false}';

-- Confirmação: listar colunas da tabela usuarios
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'usuarios' 
ORDER BY ordinal_position;

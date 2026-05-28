-- ============================================================
-- Migração: Adicionar colunas faltantes nas tabelas
-- Data: 2026-05-17
-- Executar no Supabase SQL Editor
-- ============================================================

-- Tabela usuarios: adicionar campos faltantes
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB DEFAULT '{"dashboard": true, "motoristas": true, "relatorios": true, "usuarios": false, "configuracoes": false}';

-- Tabela motoristas: adicionar telefone
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS telefone TEXT;

-- Confirmação: listar colunas das tabelas afetadas
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('usuarios', 'motoristas') 
ORDER BY table_name, column_name;

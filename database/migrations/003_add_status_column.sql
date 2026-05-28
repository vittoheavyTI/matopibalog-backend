-- Migração para adicionar coluna status às tabelas de lançamentos
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente';
ALTER TABLE abastecimentos ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente';
ALTER TABLE vales ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente';

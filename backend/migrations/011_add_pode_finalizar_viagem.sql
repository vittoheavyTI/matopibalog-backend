-- Migration 011: Adiciona permissão de finalização de viagem pelo app
-- Rodar no Supabase SQL Editor (não tem rollback automático).
--
-- Motorista vinculado só finaliza viagem se pode_finalizar_viagem = true.
-- Motorista autônomo pode finalizar por padrão (empresa.tipo = 'autonomo').
-- Super-admin e admin empresa sempre podem finalizar.

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS pode_finalizar_viagem BOOLEAN NOT NULL DEFAULT false;

-- (Opcional) ativar para motoristas autônomos existentes:
-- UPDATE motoristas
-- SET pode_finalizar_viagem = true
-- WHERE empresa_id IN (SELECT id FROM empresas WHERE tipo = 'autonomo');

-- Migration 021: idempotência na criação de cobranças (faturas.client_request_id)
-- Rodar no Supabase SQL Editor (manual; NÃO aplicar automaticamente).
--
-- ┌─ CONTEXTO ────────────────────────────────────────────────────────────────┐
-- │ POST /pagamentos/cobrancas não tinha proteção contra duplo submit: dois     │
-- │ cliques criavam DOIS payments no Asaas + DUAS faturas (asaas_id UNIQUE não  │
-- │ protege, pois cada chamada gera um id novo). Espelha a solução já usada em  │
-- │ lançamentos (migration 018_add_client_request_id_lancamentos).             │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- GARANTIAS:
--   * idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS);
--   * NÃO mexe em dados (sem UPDATE/DELETE/INSERT/TRUNCATE);
--   * NÃO altera RLS nem policies;
--   * NÃO remove nem altera colunas/status existentes;
--   * coluna aditiva e NULLABLE — faturas antigas ficam com client_request_id NULL.

-- 1. Coluna de idempotência (chave de deduplicação enviada pelo cliente).
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS client_request_id TEXT;

-- 2. Índice único PARCIAL: garante no máximo uma fatura por client_request_id,
--    mas só quando preenchido. Linhas com NULL (legado) não colidem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS faturas_client_request_id_unique
  ON faturas (client_request_id)
  WHERE client_request_id IS NOT NULL;

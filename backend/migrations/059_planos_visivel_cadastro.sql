-- 059_planos_visivel_cadastro.sql
-- Macrofrente Fechamento Comercial — Bloco B (gestão de planos no super-admin).
--
-- ADITIVA e REVERSÍVEL. Adiciona controle EXPLÍCITO de visibilidade no cadastro
-- público, hoje derivado implicitamente de (ativo && !requer_negociacao).
--
-- NULLABLE de proposito: planos existentes ficam NULL e o listador público cai
-- na regra legada (nenhuma mudanca de visibilidade sem acao do super-admin).
-- Quando o super-admin marca/desmarca, o valor passa a ser autoritativo.
-- Sem backfill.

ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS visivel_cadastro boolean NULL;

-- ============================================================================
-- ROLLBACK (documentado; NAO executar salvo necessidade):
--   ALTER TABLE public.planos DROP COLUMN IF EXISTS visivel_cadastro;
-- ============================================================================

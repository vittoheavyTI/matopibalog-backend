-- 025_add_categoria_planos.sql
-- Adiciona a categoria de destino do plano: empresa, autonomo ou ambos.
--
-- Aditiva e reversivel. Default 'ambos' mantem compatibilidade: sem o backfill,
-- todos os planos existentes seguem visiveis para os dois publicos (nenhuma
-- mudanca de comportamento). O filtro por categoria so passa a valer depois do
-- backfill que classifica cada plano.
--
-- Backfill (rodar APOS o ALTER, com os ids reais de producao):
--   UPDATE planos SET categoria='autonomo' WHERE id='a630839f-44dc-435f-8e50-449abdb444d4'; -- Plano Basico Autonomo
--   UPDATE planos SET categoria='empresa'  WHERE id='00000000-0000-0000-0000-000000000002'; -- Plano Basico
--   UPDATE planos SET categoria='empresa'  WHERE id='00000000-0000-0000-0000-000000000003'; -- Plano Profissional
--   UPDATE planos SET categoria='empresa'  WHERE id='00000000-0000-0000-0000-000000000004'; -- Plano Enterprise
--   UPDATE planos SET categoria='ambos'    WHERE id='00000000-0000-0000-0000-000000000001'; -- Free Teste (inativo)
--
-- Rollback:
--   ALTER TABLE planos DROP COLUMN categoria;

ALTER TABLE planos
  ADD COLUMN categoria text NOT NULL DEFAULT 'ambos'
  CHECK (categoria IN ('empresa','autonomo','ambos'));

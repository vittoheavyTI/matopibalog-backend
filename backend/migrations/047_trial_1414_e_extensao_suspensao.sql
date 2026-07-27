-- 047_trial_1414_e_extensao_suspensao.sql
-- Política de lançamento (decisão do usuário): TRIAL 7 autônomo / 14 empresa +
-- infraestrutura da EXTENSÃO MANUAL de prazo de suspensão (super-admin).
--
-- Parte A (dados): planos.dias_trial — empresas Start/Essencial/Growth/Scale = 14;
--                  autônomos = 7 (idempotente); Enterprise NÃO tocado (negociação).
-- Parte B (schema): colunas ADITIVAS em empresas para a extensão manual + trilha.
--
-- NÃO toca: preço, extras, capacidade, limite, faturas, Asaas. ADD COLUMN IF NOT
-- EXISTS é idempotente e deploy-safe. Transacional.
--
-- IDs REAIS:
--   a630839f-44dc-435f-8e50-449abdb444d4  Autônomo Solo      (7)
--   2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0  Autônomo + Admin   (7)
--   00000000-0000-0000-0000-000000000002  Empresa Start      (7  -> 14)
--   00000000-0000-0000-0000-000000000003  Empresa Essencial  (15 -> 14)
--   76230185-5877-4a4f-8aa1-9fff8bed16c9  Empresa Growth     (15 -> 14)
--   4401c24a-c5f7-4af8-aa15-bb3b59d6df3f  Empresa Scale      (15 -> 14)
--   00000000-0000-0000-0000-000000000004  Enterprise (NÃO tocado)
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização). Transacional.

-- ─────────────────────────────────────────────────────────────────────────────
-- (BASELINE) Rodar ANTES — read-only.
--   -- trial atual dos planos:
--   SELECT id, nome, dias_trial FROM planos
--   WHERE categoria IN ('autonomo','empresa') ORDER BY preco_mensal;
--   -- colunas de extensão já existem? (esperado: 0 linhas antes desta migration)
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='empresas'
--     AND column_name LIKE 'suspensao_prazo_%';
-- Esperado (trial antes): Solo/+Admin/Start = 7; Essencial/Growth/Scale = 15.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Guarda: os planos de empresa alvo precisam existir ───────────────────────
DO $$
DECLARE faltando int;
BEGIN
  SELECT count(*) INTO faltando FROM (VALUES
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('76230185-5877-4a4f-8aa1-9fff8bed16c9'::uuid),
    ('4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'::uuid)
  ) AS alvo(id)
  WHERE NOT EXISTS (SELECT 1 FROM planos p WHERE p.id = alvo.id);
  IF faltando > 0 THEN
    RAISE EXCEPTION 'Catálogo divergente: % plano(s) de empresa não encontrado(s).', faltando;
  END IF;
END $$;

-- ── PARTE A: trial 7 autônomo / 14 empresa ──────────────────────────────────
-- Autônomos (idempotente — já são 7).
UPDATE planos SET dias_trial = 7
WHERE id IN ('a630839f-44dc-435f-8e50-449abdb444d4','2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0');

-- Empresas self-service = 14.
UPDATE planos SET dias_trial = 14
WHERE id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '76230185-5877-4a4f-8aa1-9fff8bed16c9',
  '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'
);
-- Enterprise (…0004) NÃO é tocado: contratação sob negociação, sem trial self-service.

-- ── PARTE B: colunas da extensão manual de prazo (aditivas, idempotentes) ────
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_ate        date;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_motivo     text;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_criado_em  timestamptz;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_criado_por uuid;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_removido_em  timestamptz;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensao_prazo_removido_por uuid;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- (VALIDAÇÃO PÓS-APLICAÇÃO) — read-only.
-- (V1) Trial: autônomos = 7, empresas self-service = 14, Enterprise inalterado.
--   SELECT nome, dias_trial FROM planos WHERE categoria IN ('autonomo','empresa')
--   ORDER BY preco_mensal;
-- (V2) As 6 colunas de extensão existem e são NULLABLE.
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='empresas'
--     AND column_name LIKE 'suspensao_prazo_%' ORDER BY column_name;
-- (V3) Nenhuma empresa recebeu extensão pela migration (esperado: 0 linhas).
--   SELECT id, nome FROM empresas WHERE suspensao_prazo_ate IS NOT NULL;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- (ROLLBACK) — restaura o trial anterior. As colunas podem ser mantidas (aditivas,
-- inócuas) ou removidas. NÃO remover se já houver extensões concedidas em uso.
-- BEGIN;
-- UPDATE planos SET dias_trial = 7  WHERE id = '00000000-0000-0000-0000-000000000002'; -- Start
-- UPDATE planos SET dias_trial = 15 WHERE id = '00000000-0000-0000-0000-000000000003'; -- Essencial
-- UPDATE planos SET dias_trial = 15 WHERE id = '76230185-5877-4a4f-8aa1-9fff8bed16c9'; -- Growth
-- UPDATE planos SET dias_trial = 15 WHERE id = '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'; -- Scale
-- COMMIT;
-- -- (opcional) DROP das colunas:
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_removido_por;
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_removido_em;
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_criado_por;
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_criado_em;
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_motivo;
-- -- ALTER TABLE empresas DROP COLUMN IF EXISTS suspensao_prazo_ate;
-- ─────────────────────────────────────────────────────────────────────────────

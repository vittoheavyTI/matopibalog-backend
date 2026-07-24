-- 044_add_empresas_quantidade_contratada.sql
-- MEGA-FRENTE Cobranca de Extras por Empresa — FASE 1: persistir a QUANTIDADE
-- CONTRATADA por empresa (capacidade contratada), base do valor efetivo
-- (base + extras). So ESTRUTURA; nenhum preco muda ao aplicar.
--
-- O QUE ESTA MIGRATION FAZ
--   * empresas.quantidade_contratada            → capacidade contratada (motoristas/
--                                                 caminhoes). NAO e uso real.
--   * empresas.quantidade_contratada_atualizada_em / _por / _motivo → auditoria.
--   * faturas.capacidade_inclusa_snapshot / quantidade_extra_snapshot /
--     valor_extra_snapshot → congela a composicao dos extras na fatura (o
--     quantidade_snapshot da 030 passa a guardar a quantidade CONTRATADA).
--
-- REGRA CENTRAL (nao reinterpretar): cobranca e por CAPACIDADE CONTRATADA, nao
-- por motoristas ativos. quantidade_contratada e o numero que a empresa comprou.
--
-- BACKFILL FORWARD-SAFE (o ponto critico):
--   quantidade_contratada := capacidade_inclusa do plano (ou limite_motoristas,
--   ou 1). Como extras = max(0, contratada - capacidade_inclusa) x extra, ao
--   igualar contratada = capacidade_inclusa os EXTRAS sao ZERO -> o valor efetivo
--   e IGUAL ao preco_mensal atual -> NENHUMA cobranca muda ao aplicar. Autonomo=1.
--   Enterprise/sob negociacao: recebe capacidade_inclusa como valor informativo,
--   mas requer_negociacao ja impede cobranca automatica (nao inventamos valor).
--
-- GARANTIAS
--   * ADITIVA: so ADD COLUMN + CHECK + FK; nenhuma linha muda de preco;
--   * idempotente (ADD COLUMN IF NOT EXISTS + CHECK/FK sob pg_constraint);
--   * o backfill so PREENCHE quantidade_contratada NULL (nao sobrescreve);
--   * NAO cria cobranca, NAO fala com Asaas, NAO faz DELETE.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorizacao). Transacional.

BEGIN;

-- ── Guarda: exige colunas comerciais (038) ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='planos' AND column_name='capacidade_inclusa') THEN
    RAISE EXCEPTION 'Migration 038 (capacidade_inclusa) precisa estar aplicada ANTES da 044.';
  END IF;
END $$;

-- ── empresas: quantidade contratada + auditoria ─────────────────────────────
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS quantidade_contratada integer NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS quantidade_contratada_atualizada_em timestamptz NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS quantidade_contratada_atualizada_por uuid NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS quantidade_contratada_motivo text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='empresas_quantidade_contratada_nao_negativa_check') THEN
    ALTER TABLE empresas ADD CONSTRAINT empresas_quantidade_contratada_nao_negativa_check
      CHECK (quantidade_contratada IS NULL OR quantidade_contratada >= 0);
  END IF;
  -- Teto self-service: acima de 40 e negociacao (o app orienta; o banco protege).
  -- NAO barra hard (permite 41 para casos de negociacao ja combinados), so
  -- documenta o teto; a decisao self-service/negociacao mora no backend.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='empresas_quantidade_contratada_teto_check') THEN
    ALTER TABLE empresas ADD CONSTRAINT empresas_quantidade_contratada_teto_check
      CHECK (quantidade_contratada IS NULL OR quantidade_contratada <= 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='empresas_quantidade_contratada_por_fkey') THEN
    ALTER TABLE empresas ADD CONSTRAINT empresas_quantidade_contratada_por_fkey
      FOREIGN KEY (quantidade_contratada_atualizada_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── faturas: snapshot dos extras (a 030 ja tem quantidade_snapshot) ─────────
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS capacidade_inclusa_snapshot integer NULL;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS quantidade_extra_snapshot   integer NULL;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS valor_extra_snapshot        numeric(10,2) NULL;

-- ── BACKFILL forward-safe (so onde quantidade_contratada IS NULL) ───────────
-- = capacidade_inclusa do plano; fallback limite_motoristas; fallback 1.
-- Extras ficam ZERO -> valor efetivo = preco_mensal atual -> cobranca inalterada.
UPDATE empresas e
SET quantidade_contratada = COALESCE(p.capacidade_inclusa, p.limite_motoristas, 1),
    quantidade_contratada_atualizada_em = now(),
    quantidade_contratada_motivo = 'backfill_044'
FROM planos p
WHERE e.plano_id = p.id
  AND e.quantidade_contratada IS NULL;

-- Empresas sem plano: deixa NULL (billing-health ja sinaliza empresa_sem_plano).

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDACAO POS-MIGRATION (somente leitura)
--
-- (1) Colunas criadas.
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='empresas' AND column_name LIKE 'quantidade_contratada%';
--
-- (2) Backfill coerente: quantidade_contratada = capacidade_inclusa (extras 0).
--   SELECT e.nome, p.nome AS plano, p.capacidade_inclusa, e.quantidade_contratada
--   FROM empresas e JOIN planos p ON p.id=e.plano_id
--   WHERE e.arquivada_em IS NULL ORDER BY e.nome;
--   -- esperado: quantidade_contratada = capacidade_inclusa em todas.
--
-- (3) GATE FINANCEIRO (nada aqui toca fatura).
--   SELECT count(*) total, count(*) FILTER (WHERE status='pago') pagas,
--          coalesce(sum(valor) FILTER (WHERE status='pago'),0) total_pago,
--          count(*) FILTER (WHERE status IN ('pendente','vencido')) abertas FROM faturas;
--   -- esperado: 20 / 5 / 604,78 / 2.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (seguro; tudo aditivo/nullable)
-- BEGIN;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS valor_extra_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS quantidade_extra_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS capacidade_inclusa_snapshot;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_quantidade_contratada_por_fkey;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_quantidade_contratada_teto_check;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_quantidade_contratada_nao_negativa_check;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS quantidade_contratada_motivo;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS quantidade_contratada_atualizada_por;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS quantidade_contratada_atualizada_em;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS quantidade_contratada;
-- COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────

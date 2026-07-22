-- 032_add_fretes_sanity_checks.sql
-- Auditoria de fretes (PR 3): CHECKs ESTRUTURAIS mínimos de sanidade em `fretes`.
--
-- CONTEXTO:
--   Complementa as travas de aplicação (backend PR #291 / painel PR #292) com
--   invariantes no banco — a última linha de defesa. NÃO define teto comercial
--   (VALOR_FRETE_MAX etc. seguem sendo regra de aplicação, revisável por produto);
--   aqui só garantimos o que é estruturalmente impossível de ser válido:
--   valores monetários/peso não-negativos e KM final > KM inicial.
--
-- GARANTIAS (o que esta migration É e NÃO É):
--   * SOMENTE DDL: ADD CONSTRAINT. ZERO INSERT/UPDATE/DELETE. Sem backfill.
--   * NÃO altera dados de nenhuma linha. Não toca faturas/billing/Asaas/planos.
--   * Idempotente: cada constraint só é criada se ainda não existir (consulta
--     pg_constraint por conname dentro de DO $$).
--   * SEGURA CONTRA LEGADO: as constraints entram como NOT VALID — passam a valer
--     para toda escrita NOVA (insert/update), mas NÃO validam as linhas já
--     existentes no momento do ADD. Assim o apply NUNCA falha por causa de um
--     registro legado fora do invariante. A validação das linhas antigas é um
--     passo posterior, MANUAL e opcional (ver seção VALIDATE), a ser feito só
--     depois de contar violações (queries V3) e, se preciso, corrigir/cancelar.
--
-- NOTA sobre a 019 (019_add_frete_modalidade_odometro.sql):
--   A 019 já adiciona `toneladas > 0` e `valor_tonelada_km > 0` (estritamente
--   positivos). As checagens `>= 0` abaixo são invariantes explícitos e mais
--   frouxos — redundantes SE a 019 estiver aplicada em produção. Como o schema
--   versionado pode divergir do banco real (ver CLAUDE.md), mantemos as quatro
--   de forma idempotente: se a estrita já existir, a frouxa apenas coexiste sem
--   efeito; se a 019 não tiver sido aplicada, garantimos ao menos a não-negatividade.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).
-- Nada aqui é executado automaticamente pelo backend.

DO $$
BEGIN
  -- 1) valor_frete nunca negativo (não havia CHECK para isto até aqui).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_valor_frete_nao_negativo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_valor_frete_nao_negativo_check
      CHECK (valor_frete IS NULL OR valor_frete >= 0) NOT VALID;
  END IF;

  -- 2) valor_tonelada_km nunca negativo (invariante explícito; 019 já exige > 0).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_valor_tonelada_km_nao_negativo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_valor_tonelada_km_nao_negativo_check
      CHECK (valor_tonelada_km IS NULL OR valor_tonelada_km >= 0) NOT VALID;
  END IF;

  -- 3) toneladas nunca negativo (invariante explícito; 019 já exige > 0).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_toneladas_nao_negativo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_toneladas_nao_negativo_check
      CHECK (toneladas IS NULL OR toneladas >= 0) NOT VALID;
  END IF;

  -- 4) KM final > KM inicial QUANDO ambos existem (permite qualquer um nulo,
  --    pois KM é opcional na criação e preenchido na finalização).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_km_final_maior_inicial_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_km_final_maior_inicial_check
      CHECK (km_inicial IS NULL OR km_final IS NULL OR km_final > km_inicial) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO READ-ONLY (rodar SEPARADAMENTE; não altera nada)
--
-- V1 — as quatro constraints existem e o estado de validação (convalidated):
--   SELECT conname, convalidated
--     FROM pg_constraint
--    WHERE conrelid = 'fretes'::regclass
--      AND conname IN (
--        'fretes_valor_frete_nao_negativo_check',
--        'fretes_valor_tonelada_km_nao_negativo_check',
--        'fretes_toneladas_nao_negativo_check',
--        'fretes_km_final_maior_inicial_check'
--      )
--    ORDER BY conname;
--   -- convalidated=false é o esperado logo após o apply (entraram como NOT VALID).
--
-- V2 — nenhuma escrita de dado: esta migration é 100% DDL. Não há INSERT/UPDATE/
--   DELETE. Confirme visualmente que não existe nenhum desses comandos acima.
--
-- V3 — contagem de violações ATUAIS entre as linhas legadas (tudo read-only).
--   Rode ANTES de decidir validar. Se todos derem 0, é seguro VALIDATE.
--   SELECT
--     count(*) FILTER (WHERE valor_frete < 0)                                   AS viol_valor_frete,
--     count(*) FILTER (WHERE valor_tonelada_km < 0)                             AS viol_vtk,
--     count(*) FILTER (WHERE toneladas < 0)                                     AS viol_toneladas,
--     count(*) FILTER (WHERE km_inicial IS NOT NULL AND km_final IS NOT NULL
--                            AND km_final <= km_inicial)                        AS viol_km
--   FROM fretes;
--
-- V4 — faturas/billing NÃO são tocados por esta migration (ela só faz DDL em
--   `fretes`). Sanidade opcional do gate financeiro (read-only, inalterado):
--   SELECT count(*) AS faturas, count(*) FILTER (WHERE status = 'pago') AS pagas
--     FROM faturas;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDATE (OPCIONAL, MANUAL, SÓ SE V3 = 0 EM TUDO). Passa a checar as linhas
-- antigas também. Reversível não é necessário — VALIDATE não altera dados.
--   ALTER TABLE fretes VALIDATE CONSTRAINT fretes_valor_frete_nao_negativo_check;
--   ALTER TABLE fretes VALIDATE CONSTRAINT fretes_valor_tonelada_km_nao_negativo_check;
--   ALTER TABLE fretes VALIDATE CONSTRAINT fretes_toneladas_nao_negativo_check;
--   ALTER TABLE fretes VALIDATE CONSTRAINT fretes_km_final_maior_inicial_check;

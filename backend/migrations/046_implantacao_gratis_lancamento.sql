-- 046_implantacao_gratis_lancamento.sql
-- Implantação GRÁTIS no lançamento (decisão comercial do usuário). Zera
-- `valor_implantacao` dos 4 planos de EMPRESA. UPDATE-ONLY, idempotente,
-- transacional. Mexe SOMENTE em `valor_implantacao`.
--
-- NÃO toca: mensalidade (preco_mensal), extras (preco_motorista_extra),
-- capacidade, limite, modelo, trial, descricao, recursos, categoria, ativo.
-- Não toca faturas já emitidas, Asaas, cobrança, nem cria/apaga plano.
--
-- Escopo: só os planos de EMPRESA (autônomos já têm implantação 0; Enterprise é
-- sob negociação, valor_implantacao NULL — não tocado).
--
-- IDs REAIS (baseline confirmada 2026-07-27):
--   00000000-0000-0000-0000-000000000002  Empresa Start      (299 -> 0)
--   00000000-0000-0000-0000-000000000003  Empresa Essencial  (499 -> 0)
--   76230185-5877-4a4f-8aa1-9fff8bed16c9  Empresa Growth      (799 -> 0)
--   4401c24a-c5f7-4af8-aa15-bb3b59d6df3f  Empresa Scale     (1199 -> 0)
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização). Transacional.
-- Reversível a qualquer momento (rollback abaixo restaura os valores anteriores).

-- ─────────────────────────────────────────────────────────────────────────────
-- (BASELINE) Rodar ANTES — snapshot read-only do que será alterado.
--   SELECT id, nome, valor_implantacao, preco_mensal
--   FROM planos
--   WHERE id IN (
--     '00000000-0000-0000-0000-000000000002',
--     '00000000-0000-0000-0000-000000000003',
--     '76230185-5877-4a4f-8aa1-9fff8bed16c9',
--     '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'
--   )
--   ORDER BY preco_mensal;
-- Esperado (copy anterior): Start 299, Essencial 499, Growth 799, Scale 1199.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Guarda: os 4 planos de empresa precisam existir pelos IDs esperados.
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
    RAISE EXCEPTION 'Catálogo divergente: % plano(s) de empresa não encontrado(s) pelos IDs esperados.', faltando;
  END IF;
END $$;

-- Zera a implantação dos 4 planos de empresa (lançamento).
UPDATE planos SET valor_implantacao = 0
WHERE id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '76230185-5877-4a4f-8aa1-9fff8bed16c9',
  '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'
);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- (VALIDAÇÃO PÓS-APLICAÇÃO) — todas read-only.
--
-- (V1) Os 4 planos de empresa com valor_implantacao = 0 (esperado: 4 linhas, 0).
--   SELECT nome, valor_implantacao FROM planos
--   WHERE id IN ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',
--                '76230185-5877-4a4f-8aa1-9fff8bed16c9','4401c24a-c5f7-4af8-aa15-bb3b59d6df3f')
--   ORDER BY preco_mensal;
--
-- (V2) Mensalidade, extras, capacidade e limite INALTERADOS (esperado: iguais à 041/045).
--   SELECT nome, preco_mensal, preco_motorista_extra, capacidade_inclusa, limite_motoristas
--   FROM planos WHERE categoria = 'empresa' ORDER BY preco_mensal;
--
-- (V3) Autônomos (já 0) e Enterprise (NULL, sob negociação) NÃO tocados.
--   SELECT nome, valor_implantacao FROM planos
--   WHERE categoria = 'autonomo' OR id = '00000000-0000-0000-0000-000000000004';
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- (ROLLBACK) Restaura os valores anteriores de implantação (baseline 2026-07-27).
-- BEGIN;
-- UPDATE planos SET valor_implantacao = 299  WHERE id = '00000000-0000-0000-0000-000000000002';
-- UPDATE planos SET valor_implantacao = 499  WHERE id = '00000000-0000-0000-0000-000000000003';
-- UPDATE planos SET valor_implantacao = 799  WHERE id = '76230185-5877-4a4f-8aa1-9fff8bed16c9';
-- UPDATE planos SET valor_implantacao = 1199 WHERE id = '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f';
-- COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────

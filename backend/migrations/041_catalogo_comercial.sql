-- 041_catalogo_comercial.sql
-- MEGA-FRENTE Billing Comercial Avançado — FASE 2/3: virada do CATÁLOGO real
-- para o modelo comercial. Valores fornecidos pelo usuário (não inventados).
--
-- ┌─── CORREÇÃO (baseline real da FASE 0, 2026-07-24) ───────────────────────┐
-- │ O catálogo JÁ estava parcialmente reestruturado: os planos já foram      │
-- │ renomeados e Growth/Scale/+Admin já existem (IDs reais abaixo). Então    │
-- │ esta migration é UPDATE-ONLY e IDEMPOTENTE — NÃO cria plano (evita       │
-- │ duplicar). Só faltava: 2 correções de preço + popular as colunas         │
-- │ comerciais (038/039) + limite_motoristas=40 nos planos de empresa.       │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- PRÉ-REQUISITO: rodar DEPOIS de 038 e 039 (guarda aborta se faltarem).
--
-- ┌─── DECISÃO A CONFIRMAR NO APPLY (destaque) ──────────────────────────────┐
-- │ limite_motoristas dos planos de EMPRESA = 40 (teto self-service).        │
-- │ É TRAVA DURA (planoLimiteService + trigger). Sem subir, a empresa não    │
-- │ consegue adicionar o motorista extra e o modelo de extras nunca dispara. │
-- │ 41+ é sob negociação. Se preferir "teto por tier", ajuste antes de rodar.│
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- IMPACTO (forward-only — NÃO altera fatura emitida; snapshot 030):
--   * Autônomo Solo 149,99 → 99,90 ...... 15 empresas (próxima recorrência);
--   * Empresa Start 299,91 → 299,90 ..... 10 empresas (ajuste de 1 centavo);
--   * demais preços já no alvo; Growth/Scale/+Admin/Enterprise têm 0 empresas.
-- Sem Asaas, sem cobrança, sem DELETE.
--
-- IDs REAIS (baseline FASE 0):
--   a630839f-44dc-435f-8e50-449abdb444d4  Autônomo Solo
--   2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0  Autônomo + Admin
--   00000000-0000-0000-0000-000000000002  Empresa Start
--   00000000-0000-0000-0000-000000000003  Empresa Essencial
--   76230185-5877-4a4f-8aa1-9fff8bed16c9  Empresa Growth
--   4401c24a-c5f7-4af8-aa15-bb3b59d6df3f  Empresa Scale
--   00000000-0000-0000-0000-000000000004  Enterprise / Sob negociação
--   00000000-0000-0000-0000-000000000001  Free Teste (mantido inativo — não tocado)
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização). Transacional.

BEGIN;

-- ── Guarda 1: exige colunas das migrations 038/039 ──────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planos' AND column_name='capacidade_inclusa')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planos' AND column_name='valor_implantacao')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planos' AND column_name='requer_negociacao') THEN
    RAISE EXCEPTION 'Migrations 038/039 ainda não aplicadas — rode-as ANTES da 041.';
  END IF;
END $$;

-- ── Guarda 2: exige que os 7 planos-alvo existam pelos IDs reais ─────────────
DO $$
DECLARE faltando int;
BEGIN
  SELECT count(*) INTO faltando FROM (VALUES
    ('a630839f-44dc-435f-8e50-449abdb444d4'::uuid),
    ('2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('76230185-5877-4a4f-8aa1-9fff8bed16c9'::uuid),
    ('4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid)
  ) AS alvo(id)
  WHERE NOT EXISTS (SELECT 1 FROM planos p WHERE p.id = alvo.id);
  IF faltando > 0 THEN
    RAISE EXCEPTION 'Catálogo divergente: % plano(s)-alvo não encontrado(s) pelos IDs esperados. Confira a FASE 0.', faltando;
  END IF;
END $$;

-- ── 1. Autônomo Solo (R$ 99,90 · 1 · sem extra · impl 0) ────────────────────
UPDATE planos SET
  nome='Autônomo Solo', categoria='autonomo', modelo_cobranca='fixo',
  preco_mensal=99.90, preco_por_motorista=NULL,
  capacidade_inclusa=1, preco_motorista_extra=NULL,
  limite_motoristas=1, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=0, ativo=true
WHERE id='a630839f-44dc-435f-8e50-449abdb444d4';

-- ── 2. Autônomo + Admin (R$ 149,90 · 1 · impl 0) ────────────────────────────
UPDATE planos SET
  nome='Autônomo + Admin', categoria='autonomo', modelo_cobranca='fixo',
  preco_mensal=149.90, preco_por_motorista=NULL,
  capacidade_inclusa=1, preco_motorista_extra=NULL,
  limite_motoristas=1, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=0, ativo=true
WHERE id='2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0';

-- ── 3. Empresa Start (R$ 299,90 · 5 · extra 100 · impl 299 · limite 40) ─────
UPDATE planos SET
  nome='Empresa Start', categoria='empresa', modelo_cobranca='fixo',
  preco_mensal=299.90, preco_por_motorista=NULL,
  capacidade_inclusa=5, preco_motorista_extra=100.00,
  limite_motoristas=40, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=299.00, ativo=true
WHERE id='00000000-0000-0000-0000-000000000002';

-- ── 4. Empresa Essencial (R$ 499,90 · 10 · extra 90 · impl 499 · limite 40) ─
UPDATE planos SET
  nome='Empresa Essencial', categoria='empresa', modelo_cobranca='fixo',
  preco_mensal=499.90, preco_por_motorista=NULL,
  capacidade_inclusa=10, preco_motorista_extra=90.00,
  limite_motoristas=40, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=499.00, ativo=true
WHERE id='00000000-0000-0000-0000-000000000003';

-- ── 5. Empresa Growth (R$ 799,90 · 20 · extra 80 · impl 799 · limite 40) ────
UPDATE planos SET
  nome='Empresa Growth', categoria='empresa', modelo_cobranca='fixo',
  preco_mensal=799.90, preco_por_motorista=NULL,
  capacidade_inclusa=20, preco_motorista_extra=80.00,
  limite_motoristas=40, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=799.00, ativo=true
WHERE id='76230185-5877-4a4f-8aa1-9fff8bed16c9';

-- ── 6. Empresa Scale (R$ 1.199,90 · 40 · extra 70 · impl 1.199 · limite 40) ─
UPDATE planos SET
  nome='Empresa Scale', categoria='empresa', modelo_cobranca='fixo',
  preco_mensal=1199.90, preco_por_motorista=NULL,
  capacidade_inclusa=40, preco_motorista_extra=70.00,
  limite_motoristas=40, limite_negociacao=NULL, requer_negociacao=false,
  valor_implantacao=1199.00, ativo=true
WHERE id='4401c24a-c5f7-4af8-aa15-bb3b59d6df3f';

-- ── 7. Enterprise → Sob negociação (preço 0 · req_neg · cap 41 · neg 40) ────
--    nome preservado ('Enterprise / Sob negociação'); só os campos comerciais.
UPDATE planos SET
  categoria='empresa', modelo_cobranca='fixo',
  preco_mensal=0, preco_por_motorista=NULL,
  capacidade_inclusa=41, preco_motorista_extra=NULL,
  limite_motoristas=999, limite_negociacao=40, requer_negociacao=true,
  valor_implantacao=NULL, ativo=true
WHERE id='00000000-0000-0000-0000-000000000004';

-- Free Teste (…0001): mantido INATIVO — intencionalmente não tocado.

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o COMMIT — somente leitura)
--   SELECT nome, categoria, preco_mensal, capacidade_inclusa, preco_motorista_extra,
--          limite_motoristas, limite_negociacao, requer_negociacao, valor_implantacao, ativo
--   FROM planos ORDER BY requer_negociacao, preco_mensal;
--   Esperado:
--     Autônomo Solo ..... 99.90   cap 1  extra —   lim 1   impl 0
--     Autônomo + Admin .. 149.90  cap 1  extra —   lim 1   impl 0
--     Empresa Start ..... 299.90  cap 5  extra 100 lim 40  impl 299
--     Empresa Essencial . 499.90  cap 10 extra 90  lim 40  impl 499
--     Empresa Growth .... 799.90  cap 20 extra 80  lim 40  impl 799
--     Empresa Scale ..... 1199.90 cap 40 extra 70  lim 40  impl 1199
--     Enterprise/Sob neg. 0.00    cap 41 extra —   lim 999 neg 40 requer_negociacao=true
--
--   -- GATE FINANCEIRO (deve continuar 20/5/604,78/2 — nada aqui toca fatura):
--   SELECT count(*) total, count(*) FILTER (WHERE status='pago') pagas,
--          coalesce(sum(valor) FILTER (WHERE status='pago'),0) total_pago,
--          count(*) FILTER (WHERE status IN ('pendente','vencido')) abertas FROM faturas;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK PARCIAL (só reverte os 2 preços alterados; o resto é preenchimento
-- de coluna nova, inócuo de manter). Executar manualmente se necessário:
-- BEGIN;
--   UPDATE planos SET preco_mensal=149.99 WHERE id='a630839f-44dc-435f-8e50-449abdb444d4';
--   UPDATE planos SET preco_mensal=299.91 WHERE id='00000000-0000-0000-0000-000000000002';
-- COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────

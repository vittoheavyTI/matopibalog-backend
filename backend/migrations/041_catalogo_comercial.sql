-- 041_catalogo_comercial.sql
-- MEGA-FRENTE Billing Comercial Avançado — FASE 2/3: virada do CATÁLOGO real
-- para o modelo comercial. Renomeia/reprecifica planos existentes, cria os novos
-- (Autônomo + Admin, Empresa Growth, Empresa Scale) e transforma Enterprise em
-- "sob negociação". Decisões comerciais fornecidas pelo usuário (não inventadas).
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ PRÉ-REQUISITO: rodar DEPOIS das migrations 038 e 039 (usa capacidade_    │
-- │ inclusa, preco_motorista_extra, limite_negociacao, requer_negociacao,   │
-- │ valor_implantacao). O bloco-guarda abaixo ABORTA se elas não existirem. │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─── DECISÃO A CONFIRMAR NO APPLY (destaque) ──────────────────────────────┐
-- │ limite_motoristas dos planos de EMPRESA = 40 (teto self-service).        │
-- │ PORQUÊ: limite_motoristas é TRAVA DURA (planoLimiteService + trigger     │
-- │ trg_check_motorista_limit). Se ficar na capacidade inclusa (Start=5…),   │
-- │ a empresa NÃO consegue adicionar o motorista extra e o modelo de extras  │
-- │ nunca dispara. 40 é o teto do self-service; 41+ é sob negociação.        │
-- │ Se preferir "teto por tier" (Start=10/Essencial=20/Growth=40/Scale=40),  │
-- │ AJUSTE os quatro valores abaixo ANTES de rodar.                          │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- FORWARD-ONLY (seguro): alterar preco_mensal NÃO altera fatura já emitida — o
-- valor é congelado no snapshot da fatura (migration 030). O novo preço só vale
-- para a PRÓXIMA recorrência/regularização. Nenhuma fatura paga/aberta muda aqui.
-- Esta migration NÃO cria cobrança, NÃO fala com o Asaas, NÃO faz DELETE.
--
-- IDs (produção, confirmados no baseline da FASE 0):
--   Básico Autônomo  a630839f-44dc-435f-8e50-449abdb444d4  → Autônomo Solo
--   Plano Básico     00000000-0000-0000-0000-000000000002  → Empresa Start
--   Plano Profissional 00000000-0000-0000-0000-000000000003 → Empresa Essencial
--   Plano Enterprise 00000000-0000-0000-0000-000000000004  → Enterprise (sob negociação)
--   Free Teste       00000000-0000-0000-0000-000000000001  → mantido inativo (não tocado)
--   NOVOS (ids fixos p/ idempotência):
--     Autônomo + Admin  a1000000-0000-4000-8000-000000000001
--     Empresa Growth    a1000000-0000-4000-8000-000000000002
--     Empresa Scale     a1000000-0000-4000-8000-000000000003
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização). Transacional.

BEGIN;

-- ── Guarda: exige colunas das migrations 038/039 ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='planos' AND column_name='capacidade_inclusa')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='planos' AND column_name='valor_implantacao')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='planos' AND column_name='requer_negociacao') THEN
    RAISE EXCEPTION 'Migrations 038/039 ainda não aplicadas — rode-as ANTES da 041.';
  END IF;
END $$;

-- ── Guarda de baseline: confirma o preço atual dos 3 planos que serão
--    reprecificados (protege contra rodar em um catálogo diferente do esperado).
--    Snapshot esperado (produção 2026-07-16): Básico 149.90, Autônomo 149.99,
--    Profissional 149.99. Se divergir, ABORTA — investigue antes.
DO $$
DECLARE v_basico numeric; v_aut numeric; v_prof numeric;
BEGIN
  SELECT preco_mensal INTO v_basico FROM planos WHERE id='00000000-0000-0000-0000-000000000002';
  SELECT preco_mensal INTO v_aut    FROM planos WHERE id='a630839f-44dc-435f-8e50-449abdb444d4';
  SELECT preco_mensal INTO v_prof   FROM planos WHERE id='00000000-0000-0000-0000-000000000003';
  IF v_basico IS DISTINCT FROM 149.90 OR v_aut IS DISTINCT FROM 149.99 OR v_prof IS DISTINCT FROM 149.99 THEN
    RAISE EXCEPTION 'Baseline divergente (Básico=% Autônomo=% Profissional=%). Confira a FASE 0 antes de aplicar.', v_basico, v_aut, v_prof;
  END IF;
END $$;

-- ── 1. Básico Autônomo → Autônomo Solo (R$ 99,90) ───────────────────────────
UPDATE planos SET
  nome                  = 'Autônomo Solo',
  descricao             = 'Plano do caminhoneiro autônomo (1 motorista).',
  categoria             = 'autonomo',
  modelo_cobranca       = 'fixo',
  preco_mensal          = 99.90,
  preco_por_motorista   = NULL,
  capacidade_inclusa    = 1,
  preco_motorista_extra = NULL,
  limite_motoristas     = 1,
  limite_negociacao     = NULL,
  requer_negociacao     = false,
  valor_implantacao     = 0,
  ativo                 = true
WHERE id = 'a630839f-44dc-435f-8e50-449abdb444d4';

-- ── 2. Plano Básico → Empresa Start (R$ 299,90 · 5 inclusos · extra R$100) ──
UPDATE planos SET
  nome                  = 'Empresa Start',
  descricao             = 'Até 5 motoristas. Motorista extra R$ 100,00.',
  categoria             = 'empresa',
  modelo_cobranca       = 'fixo',
  preco_mensal          = 299.90,
  preco_por_motorista   = NULL,
  capacidade_inclusa    = 5,
  preco_motorista_extra = 100.00,
  limite_motoristas     = 40,   -- teto self-service (ver DECISÃO no cabeçalho)
  limite_negociacao     = NULL,
  requer_negociacao     = false,
  valor_implantacao     = 299.00,
  ativo                 = true
WHERE id = '00000000-0000-0000-0000-000000000002';

-- ── 3. Plano Profissional → Empresa Essencial (R$ 499,90 · 10 · extra R$90) ─
UPDATE planos SET
  nome                  = 'Empresa Essencial',
  descricao             = 'Até 10 motoristas. Motorista extra R$ 90,00.',
  categoria             = 'empresa',
  modelo_cobranca       = 'fixo',
  preco_mensal          = 499.90,
  preco_por_motorista   = NULL,
  capacidade_inclusa    = 10,
  preco_motorista_extra = 90.00,
  limite_motoristas     = 40,
  limite_negociacao     = NULL,
  requer_negociacao     = false,
  valor_implantacao     = 499.00,
  ativo                 = true
WHERE id = '00000000-0000-0000-0000-000000000003';

-- ── 4. Plano Enterprise → Sob negociação (preço 0, requer_negociacao) ───────
UPDATE planos SET
  nome                  = 'Enterprise (Sob negociação)',
  descricao             = 'Acima de 40 motoristas/caminhões — sob proposta. Fale com o suporte.',
  categoria             = 'empresa',
  modelo_cobranca       = 'fixo',
  preco_mensal          = 0,
  preco_por_motorista   = NULL,
  capacidade_inclusa    = 41,
  preco_motorista_extra = NULL,
  limite_motoristas     = 999,  -- ilimitado (negociado); não self-service
  limite_negociacao     = 40,
  requer_negociacao     = true,
  valor_implantacao     = NULL, -- sob negociação
  ativo                 = true
WHERE id = '00000000-0000-0000-0000-000000000004';

-- ── 5. NOVO — Autônomo + Admin (R$ 149,90 · 1 motorista + 1 admin) ──────────
INSERT INTO planos (id, nome, descricao, categoria, modelo_cobranca, preco_mensal,
  preco_por_motorista, capacidade_inclusa, preco_motorista_extra, limite_motoristas,
  limite_negociacao, requer_negociacao, valor_implantacao, dias_trial, recursos, ativo)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Autônomo + Admin',
  'Autônomo com um usuário administrador (1 motorista).', 'autonomo', 'fixo', 149.90,
  NULL, 1, NULL, 1, NULL, false, 0, 7, '[]'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- ── 6. NOVO — Empresa Growth (R$ 799,90 · 20 · extra R$80 · impl R$799) ─────
INSERT INTO planos (id, nome, descricao, categoria, modelo_cobranca, preco_mensal,
  preco_por_motorista, capacidade_inclusa, preco_motorista_extra, limite_motoristas,
  limite_negociacao, requer_negociacao, valor_implantacao, dias_trial, recursos, ativo)
VALUES ('a1000000-0000-4000-8000-000000000002', 'Empresa Growth',
  'Até 20 motoristas. Motorista extra R$ 80,00.', 'empresa', 'fixo', 799.90,
  NULL, 20, 80.00, 40, NULL, false, 799.00, 7, '[]'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- ── 7. NOVO — Empresa Scale (R$ 1.199,90 · 40 · extra R$70 · impl R$1.199) ──
INSERT INTO planos (id, nome, descricao, categoria, modelo_cobranca, preco_mensal,
  preco_por_motorista, capacidade_inclusa, preco_motorista_extra, limite_motoristas,
  limite_negociacao, requer_negociacao, valor_implantacao, dias_trial, recursos, ativo)
VALUES ('a1000000-0000-4000-8000-000000000003', 'Empresa Scale',
  'Até 40 motoristas. Motorista extra R$ 70,00.', 'empresa', 'fixo', 1199.90,
  NULL, 40, 70.00, 40, NULL, false, 1199.00, 7, '[]'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- Free Teste (00000000-...0001): mantido INATIVO — intencionalmente não tocado.

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o COMMIT — TODAS somente leitura)
--
-- (1) Catálogo final esperado.
--   SELECT nome, categoria, preco_mensal, capacidade_inclusa, preco_motorista_extra,
--          limite_motoristas, limite_negociacao, requer_negociacao, valor_implantacao, ativo
--   FROM planos ORDER BY requer_negociacao, preco_mensal;
--   Esperado:
--     Autônomo Solo ......... autonomo  99.90   inclusa 1  extra —     lim 1   impl 0
--     Autônomo + Admin ...... autonomo  149.90  inclusa 1  extra —     lim 1   impl 0
--     Empresa Start ......... empresa   299.90  inclusa 5  extra 100   lim 40  impl 299
--     Empresa Essencial ..... empresa   499.90  inclusa 10 extra 90    lim 40  impl 499
--     Empresa Growth ........ empresa   799.90  inclusa 20 extra 80    lim 40  impl 799
--     Empresa Scale ......... empresa   1199.90 inclusa 40 extra 70    lim 40  impl 1199
--     Enterprise (Sob neg.).. empresa   0.00    inclusa 41 extra —     lim 999 neg 40  requer_negociacao=true
--     Free Teste ............ (inalterado, inativo)
--
-- (2) GATE FINANCEIRO — faturas emitidas intactas (nada mudou aqui).
--   SELECT count(*) total, count(*) FILTER (WHERE status='pago') pagas,
--          coalesce(sum(valor) FILTER (WHERE status='pago'),0) total_pago,
--          count(*) FILTER (WHERE status IN ('pendente','vencido')) abertas
--   FROM faturas;   -- deve bater com o baseline da FASE 0 (20/5/604,78/2)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter — dentro de uma transação)
-- BEGIN;
--   DELETE FROM planos WHERE id IN (
--     'a1000000-0000-4000-8000-000000000001',
--     'a1000000-0000-4000-8000-000000000002',
--     'a1000000-0000-4000-8000-000000000003');  -- só os NOVOS (sem empresas ainda)
--   UPDATE planos SET nome='Plano Básico Autônomo', preco_mensal=149.99,
--     capacidade_inclusa=NULL, preco_motorista_extra=NULL, limite_motoristas=1,
--     valor_implantacao=NULL WHERE id='a630839f-44dc-435f-8e50-449abdb444d4';
--   UPDATE planos SET nome='Plano Básico', preco_mensal=149.90,
--     capacidade_inclusa=NULL, preco_motorista_extra=NULL, limite_motoristas=1,
--     valor_implantacao=NULL WHERE id='00000000-0000-0000-0000-000000000002';
--   UPDATE planos SET nome='Plano Profissional', preco_mensal=149.99,
--     capacidade_inclusa=NULL, preco_motorista_extra=NULL, limite_motoristas=10,
--     valor_implantacao=NULL WHERE id='00000000-0000-0000-0000-000000000003';
--   UPDATE planos SET nome='Plano Enterprise', preco_mensal=199.90,
--     capacidade_inclusa=NULL, limite_negociacao=NULL, requer_negociacao=false,
--     limite_motoristas=999, valor_implantacao=NULL
--     WHERE id='00000000-0000-0000-0000-000000000004';
-- COMMIT;
-- (Atenção: o DELETE dos novos só é seguro enquanto NENHUMA empresa os usar.)
-- ─────────────────────────────────────────────────────────────────────────────

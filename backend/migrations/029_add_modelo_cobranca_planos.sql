-- 029_add_modelo_cobranca_planos.sql
-- Frente #4 (Billing v2): cobrança por motorista. PR 1 — fundação estrutural.
--
-- O QUE ESTA MIGRATION FAZ:
--   Permite que um plano seja precificado POR MOTORISTA (pacote fechado:
--   preco_por_motorista × limite_motoristas), mantendo o preço FIXO como modelo
--   padrão. Nenhum plano existente muda de preço ou de comportamento.
--
-- REGRA CENTRAL (decisão de produto — não reinterpretar):
--   `preco_mensal` continua sendo o VALOR FINAL COBRADO, sempre.
--     * modelo_cobranca='fixo'          → preco_mensal é digitado pelo super-admin;
--     * modelo_cobranca='por_motorista' → preco_mensal é DERIVADO e persistido pelo
--       backend como preco_por_motorista × limite_motoristas (PR 2/PR 3).
--   É por isso que os consumidores a jusante seguem lendo preco_mensal SEM
--   alteração e recebem o valor certo: assinatura Asaas (asaasSubscriptionService),
--   cobrança de upgrade (upgradeRequestService), anti-downgrade
--   (upgradeDomainService) e ordenação de catálogo. Esta migration NÃO toca em
--   nenhum deles.
--
-- GARANTIAS:
--   * ADITIVA: só ADD COLUMN + CHECK. NÃO altera preco_mensal, limite_motoristas,
--     valor_anual, limite_veiculos, billing_cycle, categoria, nem qualquer LINHA;
--   * idempotente (ADD COLUMN IF NOT EXISTS + CHECK criado sob consulta a
--     pg_constraint, mesmo padrão das migrations 022 e 027);
--   * SEM backfill: o DEFAULT 'fixo' já classifica corretamente 100% do catálogo.
--     Snapshot de produção (2026-07-16): 5 planos, todos genuinamente de preço
--     fixo. Não há nada a corrigir nem a reescrever;
--   * sem RLS nesta frente (planos é catálogo público, servido por /planos/publicos);
--   * sem trigger de atualizado_em (a aplicação seta na escrita, como o resto do schema).
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─────────────────────────────────────────────────────────────────────────────
-- FRONTEIRA ENTRE BANCO E APLICAÇÃO (ler antes de mexer nos CHECKs)
--
-- O BANCO guarda o invariante ESTRUTURAL e PERMANENTE: um plano por_motorista
-- nunca existe sem multiplicador válido (unitário > 0 e quantidade >= 1) — nem
-- que seja escrito por SQL cru, fora da aplicação.
--
-- A APLICAÇÃO (planoPrecoService, PR 2) guarda a POLÍTICA, que muda com o negócio
-- e não deveria exigir migration para ser ajustada:
--   * teto de 200 motoristas em por_motorista;
--   * teto de R$ 500.000,00 no valor final;
--   * proibição da sentinela 999;
--   * rejeição de valores com mais de 2 casas decimais (numeric(10,2) ARREDONDA
--     em silêncio em vez de recusar — a app precisa barrar antes de chegar aqui).
--
-- ATENÇÃO: os CHECKs abaixo NÃO barram limite_motoristas = 999, e isso é
-- deliberado. Hoje o "Plano Enterprise" (00000000-0000-0000-0000-000000000004)
-- usa 999 como sentinela de "ilimitado" — e 999 × unitário seria uma cobrança de
-- ~R$ 99.900,00. Quem barra isso é o planoPrecoService, com mensagem específica.
-- O banco só garante que a quantidade existe e é >= 1.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. modelo_cobranca — como o preço deste plano é formado.
--    DEFAULT 'fixo' + NOT NULL: todo plano existente é classificado corretamente
--    no próprio ALTER, sem UPDATE nenhum.
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS modelo_cobranca text NOT NULL DEFAULT 'fixo';

-- 2. preco_por_motorista — valor UNITÁRIO por motorista.
--    NULL em planos fixos; obrigatório em por_motorista (garantido pelo CHECK de
--    coerência abaixo). numeric(10,2) para alinhar com faturas.valor DECIMAL(10,2).
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS preco_por_motorista numeric(10,2) NULL;

-- 3. CHECK de domínio: só os dois modelos previstos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_modelo_cobranca_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_modelo_cobranca_check
      CHECK (modelo_cobranca IN ('fixo', 'por_motorista'));
  END IF;
END $$;

-- 4. CHECK de coerência: por_motorista SEM multiplicador válido não existe.
--    Os 5 planos atuais são 'fixo' → o primeiro ramo do OR satisfaz todos eles
--    trivialmente, e a constraint é aceita sem reescrever linha alguma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_por_motorista_coerente_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_por_motorista_coerente_check
      CHECK (
        modelo_cobranca = 'fixo'
        OR (
          preco_por_motorista IS NOT NULL
          AND preco_por_motorista > 0
          AND limite_motoristas IS NOT NULL
          AND limite_motoristas >= 1
        )
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o ALTER — TODAS somente leitura)
--
-- (1) Colunas criadas com o default certo.
--     Espera-se:  modelo_cobranca     | text    | NO  | 'fixo'::text
--                 preco_por_motorista | numeric | YES | NULL
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'planos'
--     AND column_name IN ('modelo_cobranca', 'preco_por_motorista');
--
-- (2) Nenhum plano virou por_motorista sozinho.
--     Espera-se EXATAMENTE uma linha:  fixo | 5 | 0
--   SELECT modelo_cobranca,
--          count(*)                    AS planos,
--          count(preco_por_motorista)  AS com_unitario
--   FROM planos GROUP BY modelo_cobranca;
--
-- (3) GATE FINANCEIRO — nenhum preco_mensal pode ter mudado.
--     Confira contra o snapshot pré-migration (produção, 2026-07-16):
--       Free Teste .............. preco 0.00   | limite 2   | ativo=false
--       Plano Básico ............ preco 149.90 | limite 1
--       Plano Básico Autônomo ... preco 149.99 | limite 1
--       Plano Enterprise ........ preco 199.90 | limite 999
--       Plano Profissional ...... preco 149.99 | limite 10
--     Qualquer divergência = PARE e investigue antes de seguir para o PR 2.
--   SELECT nome, preco_mensal, limite_motoristas, modelo_cobranca, preco_por_motorista
--   FROM planos ORDER BY nome;
--
-- (4) As duas constraints existem.
--     Espera-se: planos_modelo_cobranca_check e planos_por_motorista_coerente_check
--     (além da planos_billing_cycle_check, herdada da migration 022).
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'planos'::regclass AND contype = 'c'
--   ORDER BY conname;
--
-- NOTA — por que não há teste negativo aqui:
--   As validações acima provam que os CHECKs EXISTEM, não que eles BLOQUEIAM.
--   A prova de bloqueio fica com o planoPrecoService (PR 2), em teste unitário.
--   Esta migration é DDL ADITIVA e não contém escrita de dado — nem comentada:
--   bloco de UPDATE em arquivo colado à mão no SQL Editor é risco de copy/paste,
--   ainda que envelopado em transação. Se um dia for preciso exercitar a
--   constraint contra o banco, será por script separado e autorizado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter)
--
-- Totalmente seguro ENQUANTO nenhum plano for por_motorista (hoje: nenhum).
-- Depois do PR 3, se já houver plano por_motorista, o DROP descarta o unitário e
-- a quantidade deixa de multiplicar: o preco_mensal derivado permanece congelado
-- no banco e passa a se comportar como preço fixo. Confira o catálogo antes.
--
--   ALTER TABLE planos DROP CONSTRAINT IF EXISTS planos_por_motorista_coerente_check;
--   ALTER TABLE planos DROP CONSTRAINT IF EXISTS planos_modelo_cobranca_check;
--   ALTER TABLE planos DROP COLUMN IF EXISTS preco_por_motorista;
--   ALTER TABLE planos DROP COLUMN IF EXISTS modelo_cobranca;
-- ─────────────────────────────────────────────────────────────────────────────

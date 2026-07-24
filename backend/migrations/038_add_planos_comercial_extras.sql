-- 038_add_planos_comercial_extras.sql
-- MEGA-FRENTE Billing Comercial Avançado — FASE 2: fundação estrutural do modelo
-- comercial "base + capacidade inclusa + motorista/caminhão extra".
--
-- O QUE ESTA MIGRATION FAZ
--   Adiciona à tabela `planos` os campos que descrevem o modelo comercial novo,
--   que nem 'fixo' nem 'por_motorista' expressam (ver
--   backend/services/calculadoraComercialService.js, cabeçalho):
--     * capacidade_inclusa     → quantos motoristas/caminhões a BASE já cobre;
--     * preco_motorista_extra  → unitário do motorista ACIMA da capacidade inclusa
--                                (NULL = plano não admite extra: autônomo/fixo);
--     * limite_negociacao      → teto self-service; acima → sob proposta
--                                (NULL = usa o global de 40 do serviço);
--     * requer_negociacao      → o plano em si é "sob proposta" (41+), sem preço
--                                de tabela e fora do self-service.
--
-- REGRA CENTRAL (não reinterpretar):
--   `preco_mensal` continua sendo o VALOR FINAL da BASE (o que se paga com a
--   quantidade DENTRO da capacidade inclusa). O extra é somado por fora, em
--   centavos inteiros, pelo backend (autoridade) — nunca no banco.
--
-- GARANTIAS
--   * ADITIVA: só ADD COLUMN + CHECK. NÃO altera preco_mensal, modelo_cobranca,
--     limite_motoristas, categoria, preco_por_motorista, nem qualquer LINHA;
--   * idempotente (ADD COLUMN IF NOT EXISTS + CHECK sob consulta a pg_constraint,
--     mesmo padrão das migrations 027/029);
--   * SEM backfill: os defaults NULL/false preservam 100% do comportamento atual.
--     Enquanto capacidade_inclusa é NULL, o serviço cai para limite_motoristas e
--     preco_motorista_extra NULL significa "sem extras" — ou seja, todo plano de
--     hoje segue cobrando exatamente o que cobra;
--   * NÃO aplica preços comerciais: os VALORES (299,90 etc.) NÃO entram aqui.
--     Esta migration só cria a ESTRUTURA. Preencher os campos é uma frente à
--     parte, com autorização (ver RUNBOOK_APLICACAO_PRECOS.md).
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─────────────────────────────────────────────────────────────────────────────
-- FRONTEIRA ENTRE BANCO E APLICAÇÃO (ler antes de mexer nos CHECKs)
--
-- O BANCO guarda o invariante ESTRUTURAL: se um plano declara preço de extra, ele
-- precisa declarar também a capacidade inclusa (sem ela, "extra a partir de quê?").
-- A APLICAÇÃO (calculadoraComercialService) guarda a POLÍTICA (teto global de 40,
-- recusa de mais de 2 casas decimais, desempate de recomendação) — que muda com o
-- negócio e não deveria exigir migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. capacidade_inclusa — motoristas/caminhões cobertos pela base.
--    NULL = "não declarado"; o serviço cai para limite_motoristas (compat legado).
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS capacidade_inclusa integer NULL;

-- 2. preco_motorista_extra — unitário do extra. NULL = plano não admite extra.
--    numeric(10,2) para alinhar com preco_mensal / faturas.valor.
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS preco_motorista_extra numeric(10,2) NULL;

-- 3. limite_negociacao — teto self-service do plano. NULL = usa o global (40).
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS limite_negociacao integer NULL;

-- 4. requer_negociacao — o plano é "sob proposta" (sem preço de tabela).
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS requer_negociacao boolean NOT NULL DEFAULT false;

-- 5. CHECK de coerência: extra declarado exige capacidade inclusa > 0 e unitário > 0.
--    Todos os planos atuais têm preco_motorista_extra IS NULL → o primeiro ramo do
--    OR satisfaz todos trivialmente, e a constraint é aceita sem reescrever linha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_extra_coerente_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_extra_coerente_check
      CHECK (
        preco_motorista_extra IS NULL
        OR (
          preco_motorista_extra > 0
          AND capacidade_inclusa IS NOT NULL
          AND capacidade_inclusa >= 1
        )
      );
  END IF;
END $$;

-- 6. CHECK: capacidade_inclusa e limite_negociacao, quando presentes, são >= 1.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_capacidade_positiva_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_capacidade_positiva_check
      CHECK (
        (capacidade_inclusa IS NULL OR capacidade_inclusa >= 1)
        AND (limite_negociacao IS NULL OR limite_negociacao >= 1)
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o ALTER — TODAS somente leitura)
--
-- (1) Colunas criadas com o default certo.
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'planos'
--     AND column_name IN ('capacidade_inclusa','preco_motorista_extra',
--                         'limite_negociacao','requer_negociacao');
--
-- (2) GATE FINANCEIRO — nenhum preco_mensal pode ter mudado, e nenhum plano
--     ganhou extra sozinho (todos com preco_motorista_extra NULL).
--   SELECT nome, preco_mensal, limite_motoristas, capacidade_inclusa,
--          preco_motorista_extra, requer_negociacao
--   FROM planos ORDER BY nome;
--
-- (3) As duas constraints novas existem.
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'planos'::regclass AND contype = 'c' ORDER BY conname;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter)
--   Seguro enquanto nenhum plano usar os campos novos (hoje: nenhum).
--
--   ALTER TABLE planos DROP CONSTRAINT IF EXISTS planos_capacidade_positiva_check;
--   ALTER TABLE planos DROP CONSTRAINT IF EXISTS planos_extra_coerente_check;
--   ALTER TABLE planos DROP COLUMN IF EXISTS requer_negociacao;
--   ALTER TABLE planos DROP COLUMN IF EXISTS limite_negociacao;
--   ALTER TABLE planos DROP COLUMN IF EXISTS preco_motorista_extra;
--   ALTER TABLE planos DROP COLUMN IF EXISTS capacidade_inclusa;
-- ─────────────────────────────────────────────────────────────────────────────

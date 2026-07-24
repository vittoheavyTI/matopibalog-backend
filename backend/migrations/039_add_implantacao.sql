-- 039_add_implantacao.sql
-- MEGA-FRENTE Billing Comercial Avançado — FASE 4: taxa de IMPLANTAÇÃO/AQUISIÇÃO.
--
-- O QUE ESTA MIGRATION FAZ (só ESTRUTURA — nenhum valor comercial entra aqui)
--   Cria os campos para cobrar uma taxa ÚNICA de implantação, SEPARADA da
--   mensalidade, para EMPRESAS (autônomos são isentos por regra — decidido no
--   backend, ver implantacaoDomainService):
--     * planos.valor_implantacao        → valor da taxa por plano (NULL/0 = sem taxa);
--     * faturas.implantacao_isenta       → marca a implantação como dispensada;
--     * faturas.implantacao_isencao_motivo → por que foi isenta (auditoria);
--     * faturas.implantacao_isento_por    → qual super-admin isentou (auditoria).
--
--   A fatura de implantação é uma fatura comum com origem='implantacao' (a coluna
--   origem já existe, migration 031, e é texto livre — nenhum CHECK a alterar) e
--   periodo_referencia NULL (não é competência mensal). O snapshot do plano
--   (plano_nome_snapshot etc., migration 030) também se aplica.
--
-- IDEMPOTÊNCIA ("não cobrar implantação duas vezes")
--   Garantida pelo client_request_id determinístico 'implantacao:<empresa_id>'
--   (LIFETIME, sem mês) contra o índice único de faturas.client_request_id
--   (migration 021): no máximo UMA fatura de implantação por empresa, para sempre.
--   Cobrança e isenção compartilham a MESMA chave — uma exclui a outra.
--
-- GARANTIAS
--   * ADITIVA: só ADD COLUMN + CHECK + FK. NÃO altera valor, status, origem, nem
--     qualquer LINHA existente;
--   * idempotente (ADD COLUMN IF NOT EXISTS + CHECK/FK sob consulta a pg_constraint);
--   * SEM backfill: defaults NULL/false preservam 100% do comportamento atual —
--     nenhuma implantação passa a ser cobrada por existir esta migration;
--   * NÃO aplica preços: valor_implantacao fica NULL em todos os planos. Preencher
--     é frente à parte, com autorização (RUNBOOK_APLICACAO_PRECOS.md);
--   * NÃO cria cobrança Asaas: aqui é só schema.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─── planos: valor da taxa de implantação ────────────────────────────────────
-- NULL = plano sem taxa de implantação (é o estado de TODOS os planos hoje).
-- numeric(10,2) alinhado a preco_mensal / faturas.valor.
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS valor_implantacao numeric(10,2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_valor_implantacao_nao_negativo_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_valor_implantacao_nao_negativo_check
      CHECK (valor_implantacao IS NULL OR valor_implantacao >= 0);
  END IF;
END $$;

-- ─── faturas: marca e auditoria de ISENÇÃO de implantação ────────────────────
-- Isenção manual do super-admin = fatura origem='implantacao', valor 0,
-- status 'cancelado' (não será cobrada), implantacao_isenta=true. Fica no domínio
-- de status válido ('pendente','pago','vencido','cancelado','estornado') sem
-- inventar 'isento', não infla receita, e bloqueia recobrança (mesma chave).
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS implantacao_isenta boolean NOT NULL DEFAULT false;

ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS implantacao_isencao_motivo text NULL;

ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS implantacao_isento_por uuid NULL;

-- FK segura: apagar o usuário que isentou NÃO apaga nem trava a fatura — só zera
-- a autoria (mesmo padrão de planos.arquivado_por, migration 027).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'faturas_implantacao_isento_por_fkey'
  ) THEN
    ALTER TABLE faturas
      ADD CONSTRAINT faturas_implantacao_isento_por_fkey
      FOREIGN KEY (implantacao_isento_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DML de EXEMPLO (COMENTADO — NÃO aplicar sem autorização; sem valores reais)
--
-- Preenchimento futuro do valor de implantação de um plano de EMPRESA (o número
-- é comercial e NÃO está definido aqui — placeholder deixado como comentário):
--   -- UPDATE planos SET valor_implantacao = <VALOR_COMERCIAL>
--   -- WHERE id = '<PLANO_EMPRESA_ID>' AND categoria = 'empresa';
--
-- Isenção manual de implantação de UMA empresa (o backend monta este INSERT via
-- implantacaoDomainService.montarPayloadImplantacaoIsenta; mostrado aqui só para
-- documentar a forma — NÃO colar no SQL Editor):
--   -- INSERT INTO faturas (empresa_id, valor, tipo_pagamento, status, origem,
--   --   client_request_id, implantacao_isenta, implantacao_isencao_motivo,
--   --   implantacao_isento_por, plano_id, plano_nome_snapshot)
--   -- VALUES ('<EMPRESA_ID>', 0, 'PIX', 'cancelado', 'implantacao',
--   --   'implantacao:<EMPRESA_ID>', true, '<MOTIVO>', '<SUPERADMIN_ID>',
--   --   '<PLANO_ID>', '<PLANO_NOME>');
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o ALTER — TODAS somente leitura)
--
-- (1) Colunas criadas com o default certo.
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public'
--     AND ((table_name='planos'  AND column_name='valor_implantacao')
--       OR (table_name='faturas' AND column_name IN
--           ('implantacao_isenta','implantacao_isencao_motivo','implantacao_isento_por')));
--
-- (2) GATE FINANCEIRO — nenhum plano ganhou taxa de implantação sozinho.
--     Espera-se: TODOS com valor_implantacao NULL.
--   SELECT nome, valor_implantacao FROM planos ORDER BY nome;
--
-- (3) Nenhuma fatura virou isenta de implantação sozinha.
--     Espera-se: 0.
--   SELECT count(*) FROM faturas WHERE implantacao_isenta = true;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter — seguro enquanto nenhuma
-- implantação existir: hoje, nenhuma)
--   ALTER TABLE faturas DROP CONSTRAINT IF EXISTS faturas_implantacao_isento_por_fkey;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS implantacao_isento_por;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS implantacao_isencao_motivo;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS implantacao_isenta;
--   ALTER TABLE planos  DROP CONSTRAINT IF EXISTS planos_valor_implantacao_nao_negativo_check;
--   ALTER TABLE planos  DROP COLUMN IF EXISTS valor_implantacao;
-- ─────────────────────────────────────────────────────────────────────────────

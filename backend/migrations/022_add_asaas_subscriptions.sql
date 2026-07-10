-- Migration 022: Assinatura Asaas (piloto sandbox — BLOCO 3).
-- Rodar no Supabase SQL Editor (sem rollback automático). NÃO aplicada por código.
--
-- Colunas em empresas para rastrear a assinatura recorrente da conta.
--   * asaas_subscription_id: id da subscription no Asaas (único quando preenchido).
--   * billing_status: estado local da assinatura (NÃO confundir com empresas.status de acesso).
--   * next_due_date: próximo vencimento da assinatura (para exibição no painel).
--   * billing_last_error: último erro sanitizado (sem PII, sem segredo, curto).
--   * billing_updated_at: quando billing_status/next_due_date mudaram pela última vez.
--
-- Em planos:
--   * billing_cycle DEFAULT 'MONTHLY' + CHECK (MONTHLY|WEEKLY|YEARLY).
--
-- Em faturas:
--   * asaas_subscription_id: vincula fatura avulsa à assinatura (BLOCO 4).
--
-- Compatibilidade:
--   * Todas as colunas NULLABLE / DEFAULT — nada a preencher em linhas antigas.
--   * Índice único PARCIAL em asaas_subscription_id — NULLs não colidem.
--   * CHECK em billing_status restringe só escritas novas.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
-- + DO $$ para CHECK constraints. Permite reaplicar sem erro.

-- 1. empresas.asaas_subscription_id
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT;

-- 2. empresas.billing_status
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS billing_status TEXT;

-- 3. empresas.next_due_date
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS next_due_date DATE;

-- 4. empresas.billing_last_error
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS billing_last_error TEXT;

-- 5. empresas.billing_updated_at
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMPTZ;

-- 6. Índice único parcial em empresas.asaas_subscription_id
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresas_asaas_subscription_id
  ON empresas (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

-- 7. CHECK de billing_status (idempotente via DO/exception)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_billing_status_check'
  ) THEN
    ALTER TABLE empresas
      ADD CONSTRAINT empresas_billing_status_check
      CHECK (billing_status IS NULL OR billing_status IN (
        'nao_configurado',
        'sem_plano',
        'isento',
        'pendente_cliente',
        'pendente_assinatura',
        'ativo',
        'erro',
        'inativo'
      ));
  END IF;
END $$;

-- 8. planos.billing_cycle DEFAULT 'MONTHLY'
ALTER TABLE planos
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY';

-- 9. CHECK dos ciclos em planos (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planos_billing_cycle_check'
  ) THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_billing_cycle_check
      CHECK (billing_cycle IN ('MONTHLY', 'WEEKLY', 'YEARLY'));
  END IF;
END $$;

-- 10. faturas.asaas_subscription_id (para BLOCO 4: importar cobranças da assinatura)
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT;
-- Migration 023: Sincronização de faturas da assinatura Asaas (BLOCO 4).
-- Rodar no Supabase SQL Editor (manual; NÃO aplicada por código).
--
-- ADITIVA: só adiciona colunas/índices, não altera/remove nada existente.
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- Campos adicionados em faturas:
--   * bank_slip_url:      URL do boleto gerado pelo Asaas (payments.bankSlipUrl).
--   * asaas_raw_status:   status BRUTO do Asaas (PENDING, OVERDUE, RECEIVED…)
--                          preservado para diagnóstico sem depender do mapeamento
--                          local.
--   * last_synced_at:     quando esta fatura foi sincronizada pela última vez.
--   * asaas_description:  descrição da cobrança no Asaas.
--
-- Índice composto em (empresa_id, due_date DESC NULLS LAST) para consultas
-- eficientes de "próxima fatura" por empresa.

-- 1. bank_slip_url
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS bank_slip_url TEXT;

-- 2. asaas_raw_status
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS asaas_raw_status TEXT;

-- 3. last_synced_at
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 4. asaas_description
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS asaas_description TEXT;

-- 5. Índice composto empresa_id + due_date para busca da próxima fatura
CREATE INDEX IF NOT EXISTS idx_faturas_empresa_due_date
  ON faturas (empresa_id, due_date DESC NULLS LAST);

-- 6. Índice em asaas_subscription_id para consultas de sincronização
CREATE INDEX IF NOT EXISTS idx_faturas_asaas_subscription_id
  ON faturas (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

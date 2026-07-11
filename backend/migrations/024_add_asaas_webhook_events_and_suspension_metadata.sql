-- Migration 024: auditoria/idempotencia do webhook Asaas e metadados de suspensao.
-- Rodar no Supabase SQL Editor somente apos autorizacao explicita.
-- Este arquivo e aditivo e idempotente. Nao aplicar automaticamente neste bloco.
--
-- Objetivos:
--   1. Diferenciar suspensao financeira, administrativa, seguranca e legado desconhecido.
--   2. Registrar eventos recebidos do Asaas por event_id unico, sem payload bruto.
--   3. Preparar processamento idempotente/retry em bloco posterior.
--
-- Garantias:
--   * Sem DROP/TRUNCATE/DELETE.
--   * Sem alteracao destrutiva de tipo.
--   * Sem payload JSON bruto, QR/Pix, documento, e-mail, telefone, cartao ou token.
--   * Foreign keys de auditoria usam ON DELETE SET NULL para preservar eventos.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. Metadados de suspensao em empresas
-- ============================================================================

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS suspension_source TEXT;

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS suspended_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'empresas'::regclass
      AND conname = 'empresas_suspension_reason_check'
  ) THEN
    ALTER TABLE empresas
      ADD CONSTRAINT empresas_suspension_reason_check
      CHECK (
        suspension_reason IS NULL
        OR suspension_reason IN (
          'financial',
          'administrative',
          'security',
          'legacy_unknown'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'empresas'::regclass
      AND conname = 'empresas_suspension_source_check'
  ) THEN
    ALTER TABLE empresas
      ADD CONSTRAINT empresas_suspension_source_check
      CHECK (
        suspension_source IS NULL
        OR suspension_source IN (
          'automatic',
          'manual',
          'legacy'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'empresas'::regclass
      AND conname = 'empresas_suspended_by_fkey'
  ) THEN
    ALTER TABLE empresas
      ADD CONSTRAINT empresas_suspended_by_fkey
      FOREIGN KEY (suspended_by)
      REFERENCES usuarios(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_empresas_suspension_reason
  ON empresas (suspension_reason)
  WHERE suspension_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_empresas_suspension_source
  ON empresas (suspension_source)
  WHERE suspension_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_empresas_suspended_by
  ON empresas (suspended_by)
  WHERE suspended_by IS NOT NULL;

-- Backfill seguro:
-- suspensoes antigas nao podem ser tratadas como financeiras sem evidencia.
-- Nao preenche suspended_at porque nao ha data historica confiavel de suspensao.
UPDATE empresas
SET
  suspension_reason = 'legacy_unknown',
  suspension_source = 'legacy'
WHERE status = 'suspenso'
  AND suspension_reason IS NULL
  AND suspension_source IS NULL;

COMMENT ON COLUMN empresas.suspension_reason IS
  'Motivo da suspensao: financial, administrative, security ou legacy_unknown.';

COMMENT ON COLUMN empresas.suspension_source IS
  'Origem da suspensao: automatic, manual ou legacy.';

COMMENT ON COLUMN empresas.suspended_at IS
  'Data/hora da suspensao quando conhecida. Suspensoes legadas sem data confiavel permanecem NULL.';

COMMENT ON COLUMN empresas.suspended_by IS
  'Usuario interno que aplicou suspensao manual, quando houver. Nullable e ON DELETE SET NULL.';

-- ============================================================================
-- 2. Eventos recebidos do webhook Asaas
-- ============================================================================

CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  asaas_payment_id TEXT,
  empresa_id UUID,
  fatura_id UUID,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asaas_webhook_events_event_id
  ON asaas_webhook_events (event_id);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_asaas_payment_id
  ON asaas_webhook_events (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_empresa_id
  ON asaas_webhook_events (empresa_id)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_fatura_id
  ON asaas_webhook_events (fatura_id)
  WHERE fatura_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_status_retry
  ON asaas_webhook_events (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_received_at
  ON asaas_webhook_events (received_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_status_check'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_status_check
      CHECK (status IN (
        'received',
        'processing',
        'processed',
        'ignored',
        'failed'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_attempts_check'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_attempts_check
      CHECK (attempts >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_event_id_not_blank_check'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_event_id_not_blank_check
      CHECK (length(btrim(event_id)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_event_type_not_blank_check'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_event_type_not_blank_check
      CHECK (length(btrim(event_type)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_empresa_id_fkey'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_empresa_id_fkey
      FOREIGN KEY (empresa_id)
      REFERENCES empresas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'asaas_webhook_events'::regclass
      AND conname = 'asaas_webhook_events_fatura_id_fkey'
  ) THEN
    ALTER TABLE asaas_webhook_events
      ADD CONSTRAINT asaas_webhook_events_fatura_id_fkey
      FOREIGN KEY (fatura_id)
      REFERENCES faturas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_asaas_webhook_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'asaas_webhook_events'::regclass
      AND tgname = 'trg_asaas_webhook_events_updated_at'
  ) THEN
    CREATE TRIGGER trg_asaas_webhook_events_updated_at
      BEFORE UPDATE ON asaas_webhook_events
      FOR EACH ROW
      EXECUTE FUNCTION public.set_asaas_webhook_events_updated_at();
  END IF;
END $$;

ALTER TABLE asaas_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'asaas_webhook_events'
      AND policyname = 'asaas_webhook_events_deny_all'
  ) THEN
    CREATE POLICY asaas_webhook_events_deny_all ON asaas_webhook_events
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

REVOKE ALL ON TABLE public.asaas_webhook_events FROM anon, authenticated;

COMMENT ON TABLE asaas_webhook_events IS
  'Registro interno de eventos do webhook Asaas para auditoria, idempotencia e retry. Nao armazena payload bruto.';

COMMENT ON COLUMN asaas_webhook_events.event_id IS
  'Identificador unico externo do evento Asaas; chave de idempotencia.';

COMMENT ON COLUMN asaas_webhook_events.event_type IS
  'Tipo do evento recebido do Asaas, por exemplo PAYMENT_RECEIVED.';

COMMENT ON COLUMN asaas_webhook_events.asaas_payment_id IS
  'Identificador da cobranca no Asaas, quando presente no evento.';

COMMENT ON COLUMN asaas_webhook_events.empresa_id IS
  'Empresa resolvida internamente a partir da fatura; nunca confiar em tenant vindo do payload externo.';

COMMENT ON COLUMN asaas_webhook_events.fatura_id IS
  'Fatura local resolvida internamente por asaas_payment_id.';

COMMENT ON COLUMN asaas_webhook_events.payload_hash IS
  'Hash criptografico textual do payload canonico/sanitizado. O payload bruto nao deve ser armazenado.';

COMMENT ON COLUMN asaas_webhook_events.status IS
  'Estado de processamento: received, processing, processed, ignored ou failed.';

COMMENT ON COLUMN asaas_webhook_events.attempts IS
  'Quantidade de tentativas de processamento. Deve ser maior ou igual a zero.';

COMMENT ON COLUMN asaas_webhook_events.last_error IS
  'Ultimo erro sanitizado. Nao armazenar secrets, payload integral, PII, QR/Pix ou dados de pagamento.';

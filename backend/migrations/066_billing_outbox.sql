-- 066_billing_outbox.sql
-- Macrofrente 3A-2 — Outbox de billing (automação confiável).
--
-- ADITIVA e idempotente. Converte "mudança comercial" em um evento pendente,
-- processado por um worker que chama ensureBillingState. Garante idempotência
-- MULTI-PROCESSO por dois mecanismos persistentes:
--   1) dedupe_key UNIQUE  → enfileirar o MESMO evento N vezes cria 1 linha só
--      (INSERT ... ON CONFLICT DO NOTHING);
--   2) claim por compare-and-swap (UPDATE ... WHERE status='pending' RETURNING)
--      → apenas 1 worker processa cada evento, mesmo com várias réplicas.
--
-- Nº 066: o 062 e o 064 pertencem ao SEC-1; o 065 esta reservado ao #417.
-- NÃO aplicar em banco compartilhado aqui; testar em Postgres efêmero (pgtest/CI).

CREATE TABLE IF NOT EXISTS public.billing_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  event_type     text NOT NULL,                 -- contratacao_apta|contrato_assinado|trial_iniciado|trial_finalizado|plano_alterado|addon_alterado|cancelamento|webhook|reconciliacao
  -- Chave de deduplicação: o produtor decide a granularidade (ex.: empresa+tipo+
  -- competência). Enfileirar o mesmo evento repetidamente NÃO cria duplicatas.
  dedupe_key     text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','dead')),
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts   integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  next_retry_at  timestamptz NULL,
  processing_started_at timestamptz NULL,
  processed_at   timestamptz NULL,
  last_error     text NULL,                      -- sanitizado (sem segredos/PII)
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Idempotência de ENFILEIRAMENTO: 1 linha por dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_outbox_dedupe
  ON public.billing_outbox (dedupe_key);

-- Varredura do worker: pega pendentes/prontos para retry, mais antigos primeiro.
CREATE INDEX IF NOT EXISTS idx_billing_outbox_pendentes
  ON public.billing_outbox (status, next_retry_at NULLS FIRST, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_billing_outbox_empresa
  ON public.billing_outbox (empresa_id, created_at DESC);

-- RLS habilitada sem policies (acesso só via backend service_role — mesmo padrão
-- do asaas_webhook_events e das tabelas de billing).
ALTER TABLE public.billing_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_outbox FROM PUBLIC;
REVOKE ALL ON TABLE public.billing_outbox FROM anon;
REVOKE ALL ON TABLE public.billing_outbox FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_outbox TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.billing_outbox FROM service_role;

COMMENT ON TABLE public.billing_outbox IS
  '3A-2: fila outbox de billing. dedupe_key UNIQUE (idempotência de enfileiramento) + claim CAS (idempotência de processamento multi-processo).';

-- Colunas de CONVERGÊNCIA em empresas (aditivas/idempotentes): o valor mensal
-- contratado na assinatura (para detectar plano alterado) e a flag de cancelamento
-- da assinatura (para convergência idempotente de cancelamento).
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS billing_valor_mensal numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS assinatura_cancelada boolean NOT NULL DEFAULT false;

-- ============================================================================
-- ROLLBACK (documentado; NÃO executar salvo necessidade):
--   DROP TABLE IF EXISTS public.billing_outbox;
-- ============================================================================

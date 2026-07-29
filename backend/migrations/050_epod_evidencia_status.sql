-- Migration 050: status INDIVIDUAL por evidência de ePOD + status geral derivado.
-- Rodar no Supabase SQL Editor (NAO aplicar automaticamente aqui). Idempotente,
-- aditiva, compatível com ePODs/evidências existentes (default 'pendente').
--
-- Contexto: a validação deixa de ser do ePOD inteiro e passa a ser POR EVIDÊNCIA
-- (aprovada/rejeitada). O status geral do frete_epod vira DERIVADO no backend:
--   registrado (0 evid. ou pendente sem aprovada) · parcial (≥1 aprovada e ainda
--   há pendente/rejeitada) · validado (≥1 evid. e todas aprovadas) · rejeitado
--   (todas rejeitadas / admin rejeitou a comprovação).
-- Por isso o CHECK de frete_epod.status é ampliado para incluir 'parcial'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) BASELINE (read-only) — rodar ANTES para conferir o estado atual
-- ─────────────────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_name = 'frete_epod_evidencias' order by ordinal_position;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'frete_epod'::regclass and contype = 'c';
-- select status, count(*) from frete_epod group by status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Evidências: status próprio + auditoria de aprovação/rejeição
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS validado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS validado_em     TIMESTAMPTZ;
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS rejeitado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS rejeitado_em    TIMESTAMPTZ;
ALTER TABLE frete_epod_evidencias ADD COLUMN IF NOT EXISTS motivo_rejeicao TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frete_epod_evid_status_check') THEN
    ALTER TABLE frete_epod_evidencias
      ADD CONSTRAINT frete_epod_evid_status_check CHECK (status IN ('pendente','aprovada','rejeitada'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frete_epod_evid_status_idx ON frete_epod_evidencias (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) frete_epod.status: ampliar o domínio para incluir 'parcial'
--    (o CHECK inline da migration 048 tem nome auto-gerado — localiza e troca)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'frete_epod'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE frete_epod DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE frete_epod
    ADD CONSTRAINT frete_epod_status_check
    CHECK (status IN ('registrado','parcial','validado','rejeitado'));
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) VALIDAÇÃO PÓS-MIGRATION (deve rodar sem erro; confira as colunas/constraints)
-- ─────────────────────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable from information_schema.columns
--   where table_name='frete_epod_evidencias'
--     and column_name in ('status','validado_por','validado_em','rejeitado_por','rejeitado_em','motivo_rejeicao');
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid in ('frete_epod'::regclass,'frete_epod_evidencias'::regclass) and contype='c';
-- select status, count(*) from frete_epod_evidencias group by status;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (referência; não executar junto)
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE frete_epod DROP CONSTRAINT IF EXISTS frete_epod_status_check;
-- ALTER TABLE frete_epod ADD CONSTRAINT frete_epod_status_check CHECK (status IN ('registrado','validado','rejeitado'));
-- ALTER TABLE frete_epod_evidencias DROP CONSTRAINT IF EXISTS frete_epod_evid_status_check;
-- ALTER TABLE frete_epod_evidencias
--   DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS validado_por, DROP COLUMN IF EXISTS validado_em,
--   DROP COLUMN IF EXISTS rejeitado_por, DROP COLUMN IF EXISTS rejeitado_em, DROP COLUMN IF EXISTS motivo_rejeicao;

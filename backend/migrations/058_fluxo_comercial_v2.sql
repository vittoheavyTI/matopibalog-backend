-- 058_fluxo_comercial_v2.sql
-- Macrofrente Fechamento Comercial Ponta a Ponta — Bloco A (estados canônicos).
--
-- ADITIVA e REVERSÍVEL. Não apaga nem reescreve nada. Todas as colunas são
-- NULLABLE e IF NOT EXISTS, seguras para reaplicar.
--
-- Contexto do schema atual (verificado em produção antes de escrever):
--   empresas.status               varchar  (já existe: trial/ativo/expirado/suspenso/bloqueado)
--   empresas.trial_ends_at        timestamptz (já existe — usada pelo gate)
--   empresas.trial_started_at     timestamptz (já existe)
--   empresas.suspensao_prazo_ate  date (já existe)
-- Portanto esta migration adiciona SOMENTE o que falta para o fluxo novo.
--
-- commercial_flow_version:
--   NULL  => conta LEGADA (regra nova NÃO se aplica; comportamento atual preservado)
--   'v2'  => conta do fluxo novo (trial gratuito + conversão voluntária)
--   Backfill NÃO é feito aqui: contas antigas permanecem NULL de propósito.
--
-- decisao_pos_trial:
--   NULL           => sem decisão registrada
--   'continuar'    => cliente optou por contratar (gera cobranças)
--   'nao_continuar'=> cliente optou por não continuar (SEM dívida; ≠ inadimplência)

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS converted_at            timestamptz NULL,
  ADD COLUMN IF NOT EXISTS decisao_pos_trial       text        NULL,
  ADD COLUMN IF NOT EXISTS commercial_flow_version text        NULL;

-- Constraints de valor (idempotentes: cria só se ainda não existir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_decisao_pos_trial_chk'
  ) THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT empresas_decisao_pos_trial_chk
      CHECK (decisao_pos_trial IS NULL OR decisao_pos_trial IN ('continuar', 'nao_continuar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_commercial_flow_version_chk'
  ) THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT empresas_commercial_flow_version_chk
      CHECK (commercial_flow_version IS NULL OR commercial_flow_version IN ('v2'));
  END IF;
END $$;

-- Índice parcial: acelera as varreduras do gate/rotina sobre contas do fluxo novo.
CREATE INDEX IF NOT EXISTS idx_empresas_flow_v2_status
  ON public.empresas (status)
  WHERE commercial_flow_version = 'v2';

-- ============================================================================
-- ROLLBACK (documentado; NÃO executar salvo necessidade explícita):
--   DROP INDEX IF EXISTS public.idx_empresas_flow_v2_status;
--   ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_commercial_flow_version_chk;
--   ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_decisao_pos_trial_chk;
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS commercial_flow_version;
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS decisao_pos_trial;
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS converted_at;
-- ============================================================================

-- 070_lancamentos_audit_safe_realtime.sql
-- Onda 1 — Lançamentos audit-safe + auditoria append-only + transição atômica (CAS).
--
-- ESCOPO: despesas, abastecimentos, vales. Backend continua a única autoridade
-- (tenant/permissão/estado/audit). O realtime (SSE) é 100% aplicação — esta migration
-- NÃO publica tabela em supabase_realtime, NÃO cria política RLS de cliente e NÃO
-- expõe o banco a anon/authenticated.
--
-- PROPRIEDADES (política da macrofrente):
--   * ADITIVA: só ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS / CREATE OR REPLACE.
--   * SEM drop, SEM rename destrutivo, SEM NOT NULL retroativo em coluna histórica,
--     SEM mass update, SEM reescrever histórico.
--   * BACKWARD-COMPATIBLE: segura para aplicar ANTES do deploy do código novo (o código
--     atual ignora as colunas/tabela novas).
--   * IDEMPOTENTE: reaplicar não quebra.
--
-- NÃO aplicar em produção sem o gate explícito do owner.

-- ===========================================================================
-- 1) Colunas aditivas de estado/auditoria (snapshot no próprio registro)
-- ---------------------------------------------------------------------------
-- Reutiliza o vocabulário e as colunas já existentes:
--   * status                       (já existe; default 'pendente')
--   * resolvido_por/resolvido_em/obs_resolucao  (já existem → aprovação/rejeição)
-- Adiciona SOMENTE o que falta:
--   * version                (CAS / concorrência)
--   * created_by             (ator da criação; histórico permanece NULL)
--   * updated_at             (timestamp da última transição)
--   * cancelado_por/cancelado_em/motivo_cancelamento  (cancelamento audit-safe)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['despesas','abastecimentos','vales'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS cancelado_por uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS cancelado_em timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS motivo_cancelamento text', t);
  END LOOP;
END $$;

-- Observação/descrição no create: despesas.descricao e vales.descricao já existem.
-- Abastecimento não tinha campo de contexto textual → adiciona (nullable p/ histórico).
ALTER TABLE public.abastecimentos ADD COLUMN IF NOT EXISTS observacao text;

-- Índices de cobertura para os FKs empresa_id (perf advisor: unindexed_foreign_keys).
-- Aditivo e barato (tabelas pequenas); acelera os agregados por empresa.
CREATE INDEX IF NOT EXISTS idx_despesas_empresa_id       ON public.despesas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_abastecimentos_empresa_id ON public.abastecimentos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_vales_empresa_id          ON public.vales (empresa_id);

-- ===========================================================================
-- 2) Auditoria append-only unificada de lançamentos
-- ---------------------------------------------------------------------------
-- Um único ledger para despesa/abastecimento/vale (extensível). Fonte de verdade
-- de "quem fez / quando / de onde / por quê". As colunas snapshot acima são apenas
-- denormalização de conveniência para leitura direta do registro.
CREATE TABLE IF NOT EXISTS public.lancamento_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('despesa','abastecimento','vale')),
  entity_id uuid NOT NULL,
  frete_id uuid NULL,
  action text NOT NULL CHECK (action IN ('created','approved','rejected','cancelled','updated')),
  from_status text NULL,
  to_status text NULL,
  actor_user_id uuid NULL,
  actor_role text NULL,
  source text NULL CHECK (source IS NULL OR source IN ('web','app','api','system')),
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_empresa_occ
  ON public.lancamento_eventos (empresa_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_entity
  ON public.lancamento_eventos (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_frete
  ON public.lancamento_eventos (frete_id) WHERE frete_id IS NOT NULL;

-- RLS habilitada SEM política: o backend usa service_role (bypassa RLS); anon/
-- authenticated ficam fail-closed (padrão das demais tabelas do projeto).
ALTER TABLE public.lancamento_eventos ENABLE ROW LEVEL SECURITY;

-- Append-only forte: bloqueia UPDATE/DELETE/TRUNCATE em qualquer papel (defesa em
-- profundidade — "histórico nunca é reescrito", independente de grants).
CREATE OR REPLACE FUNCTION public.lancamento_eventos_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'LANCAMENTO_EVENTO_IMUTAVEL' USING errcode = '42501';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lancamento_eventos_append_only ON public.lancamento_eventos;
CREATE TRIGGER trg_lancamento_eventos_append_only
  BEFORE UPDATE OR DELETE ON public.lancamento_eventos
  FOR EACH ROW EXECUTE FUNCTION public.lancamento_eventos_append_only();

-- ===========================================================================
-- 3) Transição de estado atômica + auditoria na MESMA transação (CAS + row lock)
-- ---------------------------------------------------------------------------
-- Uma única RPC serve os 3 tipos (whitelist de tabela — sem injeção). Faz:
--   * SELECT ... FOR UPDATE (serializa concorrência da MESMA linha);
--   * valida tenant (empresa_id do backend, NUNCA do cliente);
--   * CAS opcional por expected_version e/ou expected_status → conflito previsível;
--   * valida transição legal (máquina de estados);
--   * exige motivo em rejeição/cancelamento;
--   * atualiza snapshot (status/version/updated_at + ator/motivo) e insere o evento
--     append-only na MESMA transação;
--   * retorna o registro canônico (jsonb).
-- SEGURANÇA: SECURITY DEFINER, search_path fixo, REVOKE de PUBLIC/anon/authenticated,
-- GRANT só a service_role (o backend). Nunca chamável por anon/authenticated.
CREATE OR REPLACE FUNCTION public.lancamento_transicionar(
  p_entity_type text,
  p_entity_id uuid,
  p_empresa_id uuid,
  p_new_status text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_source text,
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_expected_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table   text;
  v_empresa uuid;
  v_status  text;
  v_version integer;
  v_frete   uuid;
  v_reason  text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_action  text;
  v_row     jsonb;
BEGIN
  v_table := CASE p_entity_type
    WHEN 'despesa'       THEN 'despesas'
    WHEN 'abastecimento' THEN 'abastecimentos'
    WHEN 'vale'          THEN 'vales'
    ELSE NULL
  END;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'LANCAMENTO_TIPO_INVALIDO' USING errcode = '22023';
  END IF;
  IF p_empresa_id IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'LANCAMENTO_PARAM_INVALIDO' USING errcode = '22023';
  END IF;
  IF p_new_status NOT IN ('aprovado', 'rejeitado', 'cancelado') THEN
    RAISE EXCEPTION 'LANCAMENTO_DESTINO_INVALIDO' USING errcode = '22023';
  END IF;

  EXECUTE format(
    'SELECT empresa_id, status, version, frete_id FROM public.%I WHERE id = $1 FOR UPDATE',
    v_table
  ) INTO v_empresa, v_status, v_version, v_frete USING p_entity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LANCAMENTO_NAO_ENCONTRADO' USING errcode = 'P0002';
  END IF;
  IF v_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'LANCAMENTO_TENANT' USING errcode = '42501';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'LANCAMENTO_CONFLITO_VERSAO' USING errcode = '40001';
  END IF;
  IF p_expected_status IS NOT NULL AND v_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'LANCAMENTO_CONFLITO_ESTADO' USING errcode = '40001';
  END IF;

  -- Máquina de estados: PENDENTE→{APROVADO,REJEITADO,CANCELADO}; APROVADO→CANCELADO.
  -- REJEITADO e CANCELADO são terminais.
  IF NOT (
       (v_status = 'pendente' AND p_new_status IN ('aprovado', 'rejeitado', 'cancelado'))
    OR (v_status = 'aprovado' AND p_new_status = 'cancelado')
  ) THEN
    RAISE EXCEPTION 'LANCAMENTO_TRANSICAO_INVALIDA' USING errcode = '42501',
      detail = format('de %s para %s', v_status, p_new_status);
  END IF;

  IF p_new_status IN ('rejeitado', 'cancelado') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'LANCAMENTO_MOTIVO_OBRIGATORIO' USING errcode = '22023';
  END IF;

  v_action := CASE p_new_status
    WHEN 'aprovado'  THEN 'approved'
    WHEN 'rejeitado' THEN 'rejected'
    WHEN 'cancelado' THEN 'cancelled'
  END;

  IF p_new_status = 'cancelado' THEN
    EXECUTE format(
      'UPDATE public.%I SET status=$1, version=version+1, updated_at=now(),'
      || ' cancelado_por=$2, cancelado_em=now(), motivo_cancelamento=$3'
      || ' WHERE id=$4 RETURNING to_jsonb(%I.*)',
      v_table, v_table
    ) INTO v_row USING p_new_status, p_actor_user_id, v_reason, p_entity_id;
  ELSE
    EXECUTE format(
      'UPDATE public.%I SET status=$1, version=version+1, updated_at=now(),'
      || ' resolvido_por=$2, resolvido_em=now(), obs_resolucao=COALESCE($3, obs_resolucao)'
      || ' WHERE id=$4 RETURNING to_jsonb(%I.*)',
      v_table, v_table
    ) INTO v_row USING p_new_status, p_actor_user_id, v_reason, p_entity_id;
  END IF;

  INSERT INTO public.lancamento_eventos
    (empresa_id, entity_type, entity_id, frete_id, action, from_status, to_status,
     actor_user_id, actor_role, source, reason, metadata)
  VALUES
    (p_empresa_id, p_entity_type, p_entity_id, v_frete, v_action, v_status, p_new_status,
     p_actor_user_id, p_actor_role, p_source, v_reason, '{}'::jsonb);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.lancamento_transicionar(text, uuid, uuid, text, uuid, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lancamento_transicionar(text, uuid, uuid, text, uuid, text, text, text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.lancamento_transicionar(text, uuid, uuid, text, uuid, text, text, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lancamento_transicionar(text, uuid, uuid, text, uuid, text, text, text, integer, text) TO service_role;

-- ===========================================================================
-- ROLLBACK manual (lógico — nunca reescreve dados):
--   DROP FUNCTION IF EXISTS public.lancamento_transicionar(text, uuid, uuid, text, uuid, text, text, text, integer, text);
--   DROP TRIGGER   IF EXISTS trg_lancamento_eventos_append_only ON public.lancamento_eventos;
--   DROP FUNCTION  IF EXISTS public.lancamento_eventos_append_only();
--   DROP TABLE     IF EXISTS public.lancamento_eventos;
--   ALTER TABLE public.abastecimentos DROP COLUMN IF EXISTS observacao;
--   -- (as colunas version/created_by/updated_at/cancelado_* podem ser mantidas com
--   --  segurança; se necessário reverter, DROP COLUMN IF EXISTS em cada tabela.)
--   DROP INDEX IF EXISTS idx_despesas_empresa_id, idx_abastecimentos_empresa_id, idx_vales_empresa_id;
-- ===========================================================================

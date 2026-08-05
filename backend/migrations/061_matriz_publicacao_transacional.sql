-- 061_matriz_publicacao_transacional.sql
-- PR 2C-D — Estabilização Administrativa Consolidada.
--
-- ADITIVA e REVERSÍVEL. Não apaga dados, não reescreve histórico, não publica a
-- matriz automaticamente, não faz backfill. Entrega:
--   (A) Enriquecimento ADITIVO da trilha de auditoria (origem/request_id; o resto
--       viaja estruturado em `detalhe` jsonb). Evento legado (ator_id NULL,
--       origem NULL) permanece intocado, identificado como histórico legado.
--   (B) Função transacional publicar_matriz_funcionalidades(): valida tudo, trava
--       os planos afetados, compara versão esperada (concorrência otimista →
--       conflito), aplica só as CÉLULAS realmente alteradas, incrementa a versão
--       UMA vez por plano alterado, grava auditoria na MESMA transação e é
--       IDEMPOTENTE (republicação idêntica não escreve, não versiona, não audita).
--   (C) Índices de busca operacional de clientes (nome/CNPJ/e-mail) para o super-
--       admin — sem os quais a busca faz seq scan.
--
-- Segurança da RPC: SECURITY INVOKER (roda como o chamador — o backend usa
-- service_role, que ignora RLS). search_path fixado. EXECUTE revogado de
-- PUBLIC/anon/authenticated (defesa em profundidade). A autorização HTTP
-- (verifyToken + isAdmin + isSuperAdmin no router) continua sendo a autoridade.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) Auditoria: colunas aditivas (nullable → legado permanece válido)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.funcionalidade_auditoria
  ADD COLUMN IF NOT EXISTS origem     text NULL,   -- ex.: 'painel_admin' (NULL = evento legado)
  ADD COLUMN IF NOT EXISTS request_id text NULL;   -- correlação de requisição (não é dado pessoal)

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) Busca de clientes (empresas) — índices aditivos
--   pg_trgm para busca parcial por nome; btree normalizado para e-mail/CNPJ.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_empresas_nome_trgm       ON public.empresas USING gin (lower(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_empresas_email_lower      ON public.empresas (lower(email_contato));
CREATE INDEX IF NOT EXISTS idx_empresas_cnpj_digits      ON public.empresas (regexp_replace(coalesce(cnpj_cpf, cnpj), '\D', '', 'g'));

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) Função transacional de publicação da matriz
-- ─────────────────────────────────────────────────────────────────────────────
-- Códigos de erro de domínio (SQLSTATE) → mapeados pelo backend:
--   P0001 = payload inválido            → HTTP 422
--   P0002 = plano/funcionalidade ausente→ HTTP 404
--   P0003 = conflito de versão          → HTTP 409  (MESSAGE: conflito_versao:<plano>:<esperada>:<atual>)
CREATE OR REPLACE FUNCTION public.publicar_matriz_funcionalidades(
  p_itens             jsonb,
  p_versoes_esperadas jsonb DEFAULT '{}'::jsonb,
  p_ator              uuid  DEFAULT NULL,
  p_origem            text  DEFAULT 'painel_admin',
  p_request_id        text  DEFAULT NULL,
  p_motivo            text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_disp_validas text[] := ARRAY['incluida','opcional_paga','indisponivel','em_breve','sob_negociacao'];
  v_planos       uuid[];
  v_item         jsonb;
  v_plano        uuid;
  v_func         uuid;
  v_disp         text;
  v_current_ver  int;
  v_expected     int;
  v_changed      uuid[] := ARRAY[]::uuid[];
  v_celulas      int := 0;
  v_diff         jsonb := '[]'::jsonb;
  v_versoes_ant  jsonb := '{}'::jsonb;
  v_versoes_novas jsonb := '{}'::jsonb;
  v_ex           record;
  -- valores desejados normalizados
  d_disp         text;
  d_limite       int;
  d_preco        int;
  d_card         boolean;
  d_destaque     boolean;
  d_texto        text;
  d_ordem        int;
  v_mudou        boolean;
  v_before       jsonb;
  v_after        jsonb;
  v_audit_id     uuid;
BEGIN
  -- 0) forma do payload
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'matriz_vazia' USING ERRCODE = 'P0001';
  END IF;
  IF p_versoes_esperadas IS NULL THEN p_versoes_esperadas := '{}'::jsonb; END IF;

  -- 1) planos afetados (distintos) + validação de forma dos itens
  SELECT array_agg(DISTINCT (it->>'plano_id')::uuid ORDER BY (it->>'plano_id')::uuid)
    INTO v_planos
    FROM jsonb_array_elements(p_itens) it;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) AS value LOOP
    IF (v_item->>'plano_id') IS NULL OR (v_item->>'funcionalidade_id') IS NULL THEN
      RAISE EXCEPTION 'item_incompleto' USING ERRCODE = 'P0001';
    END IF;
    v_disp := COALESCE(v_item->>'disponibilidade', 'indisponivel');
    IF NOT (v_disp = ANY (v_disp_validas)) THEN
      RAISE EXCEPTION 'disponibilidade_invalida:%', v_disp USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 1a) rejeitar célula (plano_id + funcionalidade_id) DUPLICADA no payload (ambiguidade)
  IF (SELECT count(*) FROM jsonb_array_elements(p_itens) it)
     <> (SELECT count(DISTINCT ((it->>'plano_id') || ':' || (it->>'funcionalidade_id')))
           FROM jsonb_array_elements(p_itens) it) THEN
    RAISE EXCEPTION 'celula_duplicada' USING ERRCODE = 'P0001';
  END IF;

  -- 2) trava determinística dos planos afetados (serializa publicações concorrentes)
  PERFORM 1 FROM public.planos WHERE id = ANY (v_planos) ORDER BY id FOR UPDATE;

  -- 2a) existência de todos os planos
  IF (SELECT count(*) FROM public.planos WHERE id = ANY (v_planos)) <> array_length(v_planos, 1) THEN
    RAISE EXCEPTION 'plano_inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- 2b) existência de todas as funcionalidades referenciadas
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_itens) it
      LEFT JOIN public.funcionalidades f ON f.id = (it->>'funcionalidade_id')::uuid
     WHERE f.id IS NULL
  ) THEN
    RAISE EXCEPTION 'funcionalidade_inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- 3) concorrência otimista OBRIGATÓRIA: TODO plano afetado exige versão esperada.
  FOREACH v_plano IN ARRAY v_planos LOOP
    SELECT matriz_funcionalidades_versao INTO v_current_ver FROM public.planos WHERE id = v_plano;
    v_versoes_ant := v_versoes_ant || jsonb_build_object(v_plano::text, v_current_ver);
    IF NOT (p_versoes_esperadas ? v_plano::text)
       OR NULLIF(p_versoes_esperadas->>v_plano::text, '') IS NULL THEN
      RAISE EXCEPTION 'versao_esperada_ausente:%', v_plano USING ERRCODE = 'P0001';
    END IF;
    v_expected := (p_versoes_esperadas->>v_plano::text)::int;
    IF v_expected <> v_current_ver THEN
      RAISE EXCEPTION 'conflito_versao:%:%:%', v_plano, v_expected, v_current_ver USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  -- 4) aplicar apenas as células realmente alteradas
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) AS value LOOP
    v_plano    := (v_item->>'plano_id')::uuid;
    v_func     := (v_item->>'funcionalidade_id')::uuid;
    d_disp     := COALESCE(v_item->>'disponibilidade', 'indisponivel');
    d_limite   := NULLIF(v_item->>'limite_incluso', '')::int;
    d_preco    := NULLIF(v_item->>'preco_especifico_centavos', '')::int;
    d_card     := COALESCE((v_item->>'exibir_no_card')::boolean, true);
    d_destaque := COALESCE((v_item->>'destaque')::boolean, false);
    d_texto    := NULLIF(v_item->>'texto_publico', '');
    d_ordem    := COALESCE(NULLIF(v_item->>'ordem_exibicao', '')::int, 0);

    SELECT * INTO v_ex FROM public.plano_funcionalidades
      WHERE plano_id = v_plano AND funcionalidade_id = v_func;

    IF NOT FOUND THEN
      INSERT INTO public.plano_funcionalidades
        (plano_id, funcionalidade_id, disponibilidade, limite_incluso, preco_especifico_centavos,
         exibir_no_card, destaque, texto_publico, ordem_exibicao, atualizado_em)
      VALUES
        (v_plano, v_func, d_disp, d_limite, d_preco, d_card, d_destaque, d_texto, d_ordem, now());
      v_mudou  := true;
      v_before := 'null'::jsonb;
    ELSE
      v_mudou := (v_ex.disponibilidade IS DISTINCT FROM d_disp)
              OR (v_ex.limite_incluso IS DISTINCT FROM d_limite)
              OR (v_ex.preco_especifico_centavos IS DISTINCT FROM d_preco)
              OR (v_ex.exibir_no_card IS DISTINCT FROM d_card)
              OR (v_ex.destaque IS DISTINCT FROM d_destaque)
              OR (v_ex.texto_publico IS DISTINCT FROM d_texto)
              OR (v_ex.ordem_exibicao IS DISTINCT FROM d_ordem);
      IF v_mudou THEN
        UPDATE public.plano_funcionalidades
           SET disponibilidade = d_disp, limite_incluso = d_limite,
               preco_especifico_centavos = d_preco, exibir_no_card = d_card,
               destaque = d_destaque, texto_publico = d_texto, ordem_exibicao = d_ordem,
               atualizado_em = now()
         WHERE id = v_ex.id;
        v_before := jsonb_build_object(
          'disponibilidade', v_ex.disponibilidade, 'limite_incluso', v_ex.limite_incluso,
          'preco_especifico_centavos', v_ex.preco_especifico_centavos, 'exibir_no_card', v_ex.exibir_no_card,
          'destaque', v_ex.destaque, 'texto_publico', v_ex.texto_publico, 'ordem_exibicao', v_ex.ordem_exibicao);
      END IF;
    END IF;

    IF v_mudou THEN
      v_celulas := v_celulas + 1;
      IF NOT (v_plano = ANY (v_changed)) THEN v_changed := v_changed || v_plano; END IF;
      v_after := jsonb_build_object(
        'disponibilidade', d_disp, 'limite_incluso', d_limite, 'preco_especifico_centavos', d_preco,
        'exibir_no_card', d_card, 'destaque', d_destaque, 'texto_publico', d_texto, 'ordem_exibicao', d_ordem);
      v_diff := v_diff || jsonb_build_object(
        'plano_id', v_plano, 'funcionalidade_id', v_func, 'antes', v_before, 'depois', v_after);
    END IF;
  END LOOP;

  -- 5) sem mudança real → idempotente: nada escrito, sem bump, sem auditoria
  IF v_celulas = 0 THEN
    RETURN jsonb_build_object(
      'alterado', false, 'idempotente', true, 'planos_afetados', '[]'::jsonb,
      'celulas_alteradas', 0, 'versao_anterior', v_versoes_ant, 'versao_nova', v_versoes_ant,
      'timestamp', now());
  END IF;

  -- 6) incrementa a versão UMA vez por plano efetivamente alterado
  FOREACH v_plano IN ARRAY v_changed LOOP
    UPDATE public.planos
       SET matriz_funcionalidades_versao = matriz_funcionalidades_versao + 1
     WHERE id = v_plano
     RETURNING matriz_funcionalidades_versao INTO v_current_ver;
    v_versoes_novas := v_versoes_novas || jsonb_build_object(v_plano::text, v_current_ver);
  END LOOP;

  -- 7) auditoria na MESMA transação
  INSERT INTO public.funcionalidade_auditoria
    (entidade, acao, detalhe, ator_id, origem, request_id)
  VALUES
    ('plano_funcionalidade', 'publicar',
     jsonb_build_object(
       'celulas_alteradas', v_celulas,
       'planos', to_jsonb(v_changed),
       'versao_anterior', v_versoes_ant,
       'versao_nova', v_versoes_novas,
       'diff', v_diff,
       'motivo', p_motivo),
     p_ator, p_origem, p_request_id)
  RETURNING id INTO v_audit_id;

  -- 8) resultado estruturado
  RETURN jsonb_build_object(
    'alterado', true, 'idempotente', false,
    'planos_afetados', to_jsonb(v_changed),
    'celulas_alteradas', v_celulas,
    'versao_anterior', v_versoes_ant,
    'versao_nova', v_versoes_novas,
    'auditoria_id', v_audit_id,
    'timestamp', now());
END;
$$;

-- Defesa em profundidade: revoga de todos e concede APENAS ao papel técnico
-- (service_role) — que é o papel real usado pelo backend (config/supabase.js usa
-- SUPABASE_SERVICE_KEY). A autorização HTTP (verifyToken+isAdmin+isSuperAdmin)
-- continua sendo a autoridade primária.
REVOKE ALL ON FUNCTION public.publicar_matriz_funcionalidades(jsonb, jsonb, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publicar_matriz_funcionalidades(jsonb, jsonb, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.publicar_matriz_funcionalidades(jsonb, jsonb, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publicar_matriz_funcionalidades(jsonb, jsonb, uuid, text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, documentado):
--   DROP FUNCTION IF EXISTS public.publicar_matriz_funcionalidades(jsonb, jsonb, uuid, text, text, text);
--   DROP INDEX IF EXISTS public.idx_empresas_nome_trgm;
--   DROP INDEX IF EXISTS public.idx_empresas_email_lower;
--   DROP INDEX IF EXISTS public.idx_empresas_cnpj_digits;
--   ALTER TABLE public.funcionalidade_auditoria DROP COLUMN IF EXISTS origem;
--   ALTER TABLE public.funcionalidade_auditoria DROP COLUMN IF EXISTS request_id;
--   -- (extensão pg_trgm pode permanecer; é inócua)
-- ─────────────────────────────────────────────────────────────────────────────

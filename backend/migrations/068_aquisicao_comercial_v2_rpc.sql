-- 068_aquisicao_comercial_v2_rpc.sql
-- Integridade final do PR #421: aquisicao explicita v2 atomica e concorrencia-safe.
-- Aditiva/idempotente. Nao executa Asaas, nao cria fatura e nao altera contas
-- existentes fora da transacao iniciada explicitamente pelo backend.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'propostas_comerciais_origem_check'
      AND conrelid = 'public.propostas_comerciais'::regclass
  ) THEN
    ALTER TABLE public.propostas_comerciais
      DROP CONSTRAINT propostas_comerciais_origem_check;
  END IF;

  ALTER TABLE public.propostas_comerciais
    ADD CONSTRAINT propostas_comerciais_origem_check
    CHECK (origem IN (
      'cadastro_publico',
      'painel_admin',
      'upload_manual',
      'mock',
      'aquisicao_explicita',
      'pos_trial_continuar'
    ));
END $$;

CREATE OR REPLACE FUNCTION public.iniciar_aquisicao_comercial_v2(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_plano_id uuid,
  p_origem text,
  p_snapshot jsonb,
  p_cliente_nome text,
  p_cliente_email_hash text,
  p_pos_trial boolean DEFAULT false
)
RETURNS TABLE (
  resultado text,
  idempotente boolean,
  proposta_id uuid,
  contrato_id uuid,
  contrato_status text,
  origem text,
  billing_event jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_equiv record;
  v_div record;
  v_old record;
  v_proposta_id uuid;
  v_contrato_id uuid;
  v_content_hash text;
  v_matopiba_assinado_em timestamptz := now();
  v_matopiba_hash text;
  v_event_id uuid;
  v_dedupe_key text;
BEGIN
  IF p_empresa_id IS NULL OR p_plano_id IS NULL OR p_snapshot IS NULL THEN
    RAISE EXCEPTION 'aquisicao_v2_payload_invalido';
  END IF;
  IF p_origem NOT IN ('aquisicao_explicita', 'pos_trial_continuar') THEN
    RAISE EXCEPTION 'aquisicao_v2_origem_invalida';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('aquisicao_comercial_v2'), hashtext(p_empresa_id::text));

  SELECT p.id AS proposta_id, c.id AS contrato_id, c.status AS contrato_status, p.origem
    INTO v_equiv
  FROM public.propostas_comerciais p
  LEFT JOIN LATERAL (
    SELECT id, status
    FROM public.contratos_comerciais
    WHERE proposta_id = p.id
    ORDER BY criado_em DESC
    LIMIT 1
  ) c ON true
  WHERE p.empresa_id = p_empresa_id
    AND p.origem IN ('aquisicao_explicita', 'pos_trial_continuar')
    AND p.status IN ('rascunho', 'enviada', 'aceita')
    AND (c.id IS NULL OR c.status NOT IN ('cancelado', 'substituido'))
    AND COALESCE(p.snapshot->>'plano_id', '') = COALESCE(p_snapshot->>'plano_id', p_plano_id::text)
    AND COALESCE(p.snapshot->>'quantidade_contratada', '') = COALESCE(p_snapshot->>'quantidade_contratada', '')
    AND COALESCE(p.snapshot->>'valor_mensal', '') = COALESCE(p_snapshot->>'valor_mensal', '')
  ORDER BY p.criado_em DESC
  LIMIT 1;

  IF v_equiv.proposta_id IS NOT NULL THEN
    IF p_pos_trial THEN
      UPDATE public.empresas
      SET decisao_pos_trial = 'continuar'
      WHERE id = p_empresa_id;

      IF v_equiv.contrato_status IN ('plenamente_assinado', 'assinado', 'aceito_manualmente') THEN
        v_dedupe_key := p_empresa_id::text || ':contratacao_apta:' || v_equiv.contrato_id::text;
        INSERT INTO public.billing_outbox (empresa_id, event_type, dedupe_key, status, attempts, payload)
        VALUES (
          p_empresa_id,
          'contratacao_apta',
          v_dedupe_key,
          'pending',
          0,
          jsonb_build_object(
            'contrato_id', v_equiv.contrato_id,
            'proposta_id', v_equiv.proposta_id,
            'origem', 'pos_trial_continue_rearm'
          )
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id INTO v_event_id;
      END IF;
    END IF;

    resultado := 'reutilizada';
    idempotente := true;
    proposta_id := v_equiv.proposta_id;
    contrato_id := v_equiv.contrato_id;
    contrato_status := v_equiv.contrato_status;
    origem := v_equiv.origem;
    billing_event := CASE
      WHEN v_event_id IS NOT NULL THEN jsonb_build_object('code', 'inserted', 'event_id', v_event_id)
      WHEN p_pos_trial AND v_equiv.contrato_status IN ('plenamente_assinado', 'assinado', 'aceito_manualmente') THEN jsonb_build_object('code', 'duplicate')
      ELSE NULL
    END;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT p.id AS proposta_id, c.id AS contrato_id, c.status AS contrato_status, p.origem
    INTO v_div
  FROM public.propostas_comerciais p
  LEFT JOIN LATERAL (
    SELECT id, status
    FROM public.contratos_comerciais
    WHERE proposta_id = p.id
    ORDER BY criado_em DESC
    LIMIT 1
  ) c ON true
  WHERE p.empresa_id = p_empresa_id
    AND p.origem IN ('aquisicao_explicita', 'pos_trial_continuar')
    AND p.status IN ('rascunho', 'enviada', 'aceita')
    AND (c.id IS NULL OR c.status NOT IN ('cancelado', 'substituido'))
  ORDER BY p.criado_em DESC
  LIMIT 1;

  IF v_div.proposta_id IS NOT NULL THEN
    resultado := 'conflito_aquisicao_ativa';
    idempotente := false;
    proposta_id := v_div.proposta_id;
    contrato_id := v_div.contrato_id;
    contrato_status := v_div.contrato_status;
    origem := v_div.origem;
    billing_event := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR v_old IN
    SELECT p.id AS proposta_id, c.id AS contrato_id, p.origem
    FROM public.propostas_comerciais p
    JOIN public.contratos_comerciais c ON c.proposta_id = p.id
    WHERE p.empresa_id = p_empresa_id
      AND p.origem = 'cadastro_publico'
      AND p.status IN ('rascunho', 'enviada', 'aceita')
      AND c.status IN ('aguardando_assinatura', 'pronto_assinatura', 'aguardando_assinatura_cliente', 'aguardando_assinatura_matopiba')
  LOOP
    UPDATE public.contratos_comerciais
    SET status = 'substituido', atualizado_em = now()
    WHERE id = v_old.contrato_id
      AND empresa_id = p_empresa_id;

    INSERT INTO public.contrato_eventos (contrato_id, empresa_id, tipo, detalhe, criado_por)
    VALUES (
      v_old.contrato_id,
      p_empresa_id,
      'contrato_substituido_por_aquisicao_explicita',
      jsonb_build_object(
        'proposta_id', v_old.proposta_id,
        'origem_anterior', v_old.origem,
        'politica', 'contrato_automatico_cadastro_nao_prova_intencao_compra'
      ),
      p_usuario_id
    );
  END LOOP;

  INSERT INTO public.propostas_comerciais (
    empresa_id, plano_id, status, origem, snapshot,
    valor_mensal, valor_implantacao, total_inicial, trial_dias,
    implantacao_override_motivo, criado_por, aceito_por, aceito_em
  )
  VALUES (
    p_empresa_id,
    p_plano_id,
    'enviada',
    p_origem,
    p_snapshot,
    COALESCE((p_snapshot->>'valor_mensal')::numeric, 0),
    COALESCE((p_snapshot->>'valor_implantacao')::numeric, 0),
    COALESCE((p_snapshot->>'total_inicial')::numeric, 0),
    COALESCE((p_snapshot->>'trial_dias')::integer, 0),
    NULLIF(p_snapshot->>'implantacao_override_motivo', ''),
    p_usuario_id,
    NULL,
    NULL
  )
  RETURNING id INTO v_proposta_id;

  v_content_hash := encode(digest(
    p_empresa_id::text || ':' || v_proposta_id::text || ':' || p_snapshot::text,
    'sha256'
  ), 'hex');

  INSERT INTO public.contratos_comerciais (
    proposta_id, empresa_id, status, obrigatorio,
    template_version, provider, content_hash, metadata, aceito_por, aceito_em
  )
  VALUES (
    v_proposta_id,
    p_empresa_id,
    'aguardando_assinatura',
    true,
    COALESCE(p_snapshot->>'template_version', 'comercial-v1-tecnico'),
    'manual',
    v_content_hash,
    jsonb_build_object(
      'aviso_juridico', 'conteudo_tecnico_pendente_revisao_juridica',
      'implantacao_gratis', COALESCE((p_snapshot->>'implantacao_gratis')::boolean, false),
      'modelo_vigente', 'ausente_fallback_texto_tecnico',
      'trial_started_at', p_snapshot->>'trial_started_at',
      'trial_ends_at', p_snapshot->>'trial_ends_at',
      'trial_status', p_snapshot->>'trial_status'
    ),
    NULL,
    NULL
  )
  RETURNING id INTO v_contrato_id;

  INSERT INTO public.contrato_signatarios (
    contrato_id, empresa_id, nome, papel, email_hash, status, assinado_em
  )
  VALUES (
    v_contrato_id,
    p_empresa_id,
    COALESCE(NULLIF(p_cliente_nome, ''), 'Responsavel'),
    'cliente',
    p_cliente_email_hash,
    'pendente',
    NULL
  );

  v_matopiba_hash := encode(digest(
    v_contrato_id::text || ':matopiba:' || v_content_hash || ':' || v_matopiba_assinado_em::text,
    'sha256'
  ), 'hex');

  INSERT INTO public.contrato_signatarios (
    contrato_id, empresa_id, nome, papel, email_hash, status, assinado_em,
    metodo_assinatura, assinatura_hash, document_hash_assinado, consent_text_version, consent_text
  )
  VALUES (
    v_contrato_id,
    p_empresa_id,
    'Matopiba Log',
    'matopiba',
    NULL,
    'assinado',
    v_matopiba_assinado_em,
    'manual',
    v_matopiba_hash,
    v_content_hash,
    'emissao-institucional-v1',
    'Contrato emitido e pre-assinado institucionalmente pela Matopiba Log no lancamento inicial, sem provedor pago de assinatura.'
  );

  INSERT INTO public.contrato_eventos (contrato_id, empresa_id, tipo, detalhe, criado_por)
  VALUES (
    v_contrato_id,
    p_empresa_id,
    'aquisicao_comercial_iniciada',
    jsonb_build_object(
      'origem', p_origem,
      'implantacao', CASE WHEN COALESCE((p_snapshot->>'implantacao_gratis')::boolean, false) THEN 'gratis' ELSE 'positiva' END,
      'fatura_implantacao', CASE WHEN COALESCE((p_snapshot->>'implantacao_gratis')::boolean, false) THEN 'nao_criada' ELSE 'aguarda_acao_financeira' END
    ),
    p_usuario_id
  );

  INSERT INTO public.contrato_eventos (contrato_id, empresa_id, tipo, detalhe, criado_por)
  VALUES (
    v_contrato_id,
    p_empresa_id,
    'assinatura_matopiba_institucional',
    jsonb_build_object(
      'emissao', 'institucional',
      'metodo', 'manual',
      'representante', 'Matopiba Log',
      'observacao', 'pre_assinatura_institucional_sem_otp',
      'assinado_em', v_matopiba_assinado_em
    ),
    p_usuario_id
  );

  IF p_pos_trial THEN
    UPDATE public.empresas
    SET decisao_pos_trial = 'continuar'
    WHERE id = p_empresa_id;
  END IF;

  resultado := 'criada';
  idempotente := false;
  proposta_id := v_proposta_id;
  contrato_id := v_contrato_id;
  contrato_status := 'aguardando_assinatura';
  origem := p_origem;
  billing_event := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.iniciar_aquisicao_comercial_v2(uuid, uuid, uuid, text, jsonb, text, text, boolean) IS
  'Cria ou reutiliza aquisicao comercial v2 com lock transacional por empresa. Nao chama Asaas; apenas pode enfileirar contratacao_apta quando pos-trial reutiliza contrato ja assinado.';

REVOKE ALL ON FUNCTION public.iniciar_aquisicao_comercial_v2(uuid, uuid, uuid, text, jsonb, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iniciar_aquisicao_comercial_v2(uuid, uuid, uuid, text, jsonb, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.iniciar_aquisicao_comercial_v2(uuid, uuid, uuid, text, jsonb, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_aquisicao_comercial_v2(uuid, uuid, uuid, text, jsonb, text, text, boolean) TO service_role;

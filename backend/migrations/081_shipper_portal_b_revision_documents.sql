-- Migration 081: Portal do Embarcador V1 (PORTAL-B) - revisao auditavel,
-- documentos da solicitacao, compartilhamento explicito e ativacao de convite.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_SHIPPER_PORTAL_B.
--
-- POR QUE ESTA MIGRATION EXISTE (a auditoria do PORTAL-B, §108: reusar antes de
-- criar schema). Duas lacunas nao tinham como ser resolvidas so com codigo:
--
--   1. HISTORICO DE SUBMISSAO. A 080 guarda UM `submitted_snapshot` por
--      solicitacao. Se o embarcador corrige e reenvia, esse campo seria
--      sobrescrito -- e a evidencia exata que a transportadora avaliou quando
--      pediu ajustes deixaria de existir. §34/§35 proibem destruir evidencia de
--      decisao. Solucao: versoes append-only, com a decisao carimbada NA versao
--      que foi avaliada.
--
--   2. VISIBILIDADE EXTERNA DE DOCUMENTO. Nao existe, em lugar nenhum do
--      schema, uma autoridade que diga "este documento pode ser visto pelo
--      embarcador". `frete_documentos` e interno (cte/mdfe/nfe/outro) e
--      `frete_epod_evidencias` e prova operacional. Expor por heuristica (tipo,
--      nome do arquivo, status) seria adivinhar (§57/§64). Solucao: uma relacao
--      de compartilhamento EXPLICITA e revogavel.
--
-- O que NAO foi criado por ja existir (reuso):
--   * mapa de status de execucao -> `services/campaign/freightExecutionStatus.js`
--     ja e a autoridade congelada, com UNKNOWN seguro. Nao ha estado novo.
--   * proveniencia da operacao -> request.campaign_id -> campaign_trip_freights
--     -> fretes. A cadeia ja fecha sem heuristica (§50/§51).
--   * storage privado + signed URL -> ja usados por documentos/ePOD.
--   * identidade/senha -> Supabase Auth, como no login interno.
--
-- Nao cria nenhuma linha de negocio. BUSINESS_DML=0.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. shipper_transport_request_submissions -- historico append-only
-- ============================================================================
-- Cada envio do embarcador vira uma VERSAO imutavel. A decisao da transportadora
-- e carimbada na versao que ela realmente viu -- e isso responde a pergunta que
-- so o historico responde: "o aceite se refere a qual versao?" (§118).
--
-- Append-only na pratica: nenhuma RPC atualiza `snapshot`; a unica coluna que
-- muda depois da criacao e a decisao, e so uma vez (de NULL para o veredito).

CREATE TABLE IF NOT EXISTS public.shipper_transport_request_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.shipper_transport_requests(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by UUID NOT NULL REFERENCES public.shipper_portal_users(id) ON DELETE RESTRICT,
  decision TEXT NULL CHECK (decision IN ('ACCEPTED','REJECTED','CHANGES_REQUESTED')),
  decision_reason TEXT NULL,
  decided_at TIMESTAMPTZ NULL,
  decided_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Decisao registrada exige quando: um veredito sem instante nao e auditavel.
  CHECK (decision IS NULL OR decided_at IS NOT NULL)
);

-- Uma versao N por solicitacao. E o que impede dois reenvios concorrentes de
-- criarem duas "v2" -- quem perde a corrida falha e reexecuta lendo a v2 real.
CREATE UNIQUE INDEX IF NOT EXISTS shipper_request_submissions_version_key
  ON public.shipper_transport_request_submissions (request_id, version);
CREATE INDEX IF NOT EXISTS shipper_request_submissions_request_idx
  ON public.shipper_transport_request_submissions (request_id, version DESC);
CREATE INDEX IF NOT EXISTS shipper_request_submissions_empresa_idx
  ON public.shipper_transport_request_submissions (empresa_id, submitted_at DESC);

-- Fronteira no banco: a submissao pertence a MESMA solicitacao/tenant.
DO $$ BEGIN
  ALTER TABLE public.shipper_transport_request_submissions
    ADD CONSTRAINT shipper_submissions_request_empresa_fk
    FOREIGN KEY (request_id, empresa_id)
    REFERENCES public.shipper_transport_requests (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.shipper_transport_request_submissions
    ADD CONSTRAINT shipper_submissions_request_org_fk
    FOREIGN KEY (request_id, shipper_org_id)
    REFERENCES public.shipper_transport_requests (id, shipper_org_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Quem enviou pertence ao embarcador da solicitacao.
DO $$ BEGIN
  ALTER TABLE public.shipper_transport_request_submissions
    ADD CONSTRAINT shipper_submissions_author_org_fk
    FOREIGN KEY (submitted_by, shipper_org_id)
    REFERENCES public.shipper_portal_users (id, shipper_org_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ponteiro para a versao corrente. Deriva-se do MAX(version), mas materializar
-- torna a leitura da caixa de entrada barata e o carimbo de decisao inequivoco.
ALTER TABLE public.shipper_transport_requests
  ADD COLUMN IF NOT EXISTS current_submission_version INTEGER NOT NULL DEFAULT 0
    CHECK (current_submission_version >= 0),
  ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0
    CHECK (revision_count >= 0);

-- ============================================================================
-- 2. shipper_request_documents -- documentos ENVIADOS PELO embarcador
-- ============================================================================
-- Direcao explicita (§61): SHIPPER -> CARRIER. Nao confundir com
-- motorista -> empresa (frete_epod_evidencias) nem empresa -> motorista
-- (frete_documentos). Sao populacoes e autoridades diferentes.
--
-- O vinculo e com a SOLICITACAO (§62) -- nao com metadado textual. Documento sem
-- dono estrutural e documento que ninguem consegue autorizar depois.

CREATE TABLE IF NOT EXISTS public.shipper_request_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.shipper_transport_requests(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  nome_documento TEXT NOT NULL,
  descricao TEXT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NULL,
  tamanho_bytes BIGINT NULL CHECK (tamanho_bytes IS NULL OR tamanho_bytes > 0),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
  client_request_id TEXT NULL,
  enviado_por UUID NOT NULL REFERENCES public.shipper_portal_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelado_em TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'cancelado' OR cancelado_em IS NOT NULL)
);

-- Idempotencia de upload, no mesmo idioma da 073.
CREATE UNIQUE INDEX IF NOT EXISTS shipper_request_documents_client_request_key
  ON public.shipper_request_documents (request_id, enviado_por, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipper_request_documents_storage_key
  ON public.shipper_request_documents (storage_path);
CREATE INDEX IF NOT EXISTS shipper_request_documents_request_idx
  ON public.shipper_request_documents (request_id, status, created_at DESC);

DO $$ BEGIN
  ALTER TABLE public.shipper_request_documents
    ADD CONSTRAINT shipper_request_documents_request_empresa_fk
    FOREIGN KEY (request_id, empresa_id)
    REFERENCES public.shipper_transport_requests (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.shipper_request_documents
    ADD CONSTRAINT shipper_request_documents_author_org_fk
    FOREIGN KEY (enviado_por, shipper_org_id)
    REFERENCES public.shipper_portal_users (id, shipper_org_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 3. shipper_document_shares -- A AUTORIDADE DE VISIBILIDADE EXTERNA
-- ============================================================================
-- Nada interno vaza por padrao (§57/§63). Um documento da transportadora ou uma
-- evidencia de ePOD so existe para o embarcador se alguem autorizado criou uma
-- linha AQUI. Revogar aqui corta o acesso e, junto com a checagem de fronteira
-- feita antes de assinar URL, corta tambem os signed URLs futuros (§105).
--
-- Por que source_kind + duas FKs opcionais em vez de uma tabela por origem: o
-- objeto compartilhado tem naturezas diferentes (documento de frete x evidencia
-- de ePOD) mas a AUTORIDADE e uma so. Duplicar a autoridade em duas tabelas
-- seria duplicar o lugar onde um bug de vazamento pode nascer.

CREATE TABLE IF NOT EXISTS public.shipper_document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  relationship_id UUID NOT NULL REFERENCES public.shipper_carrier_relationships(id) ON DELETE CASCADE,
  request_id UUID NULL REFERENCES public.shipper_transport_requests(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('FRETE_DOCUMENTO','EPOD_EVIDENCIA')),
  frete_documento_id UUID NULL REFERENCES public.frete_documentos(id) ON DELETE CASCADE,
  epod_evidencia_id UUID NULL REFERENCES public.frete_epod_evidencias(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  shared_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exatamente UMA origem preenchida, coerente com source_kind. Sem isso
  -- existiria uma linha de compartilhamento que nao aponta para nada -- ou que
  -- aponta para dois objetos e deixa ambiguo o que o embarcador abre.
  CHECK (
    (source_kind = 'FRETE_DOCUMENTO' AND frete_documento_id IS NOT NULL AND epod_evidencia_id IS NULL)
    OR
    (source_kind = 'EPOD_EVIDENCIA' AND epod_evidencia_id IS NOT NULL AND frete_documento_id IS NULL)
  ),
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);

-- Um objeto e compartilhado no maximo uma vez por relacionamento enquanto ativo.
-- Recompartilhar depois de revogar cria uma linha nova (historico preservado).
CREATE UNIQUE INDEX IF NOT EXISTS shipper_document_shares_doc_active_key
  ON public.shipper_document_shares (relationship_id, frete_documento_id)
  WHERE status = 'ACTIVE' AND frete_documento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipper_document_shares_epod_active_key
  ON public.shipper_document_shares (relationship_id, epod_evidencia_id)
  WHERE status = 'ACTIVE' AND epod_evidencia_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipper_document_shares_scope_idx
  ON public.shipper_document_shares (shipper_org_id, relationship_id, status, shared_at DESC);
CREATE INDEX IF NOT EXISTS shipper_document_shares_request_idx
  ON public.shipper_document_shares (request_id, status);

-- Fronteira: o compartilhamento pertence ao trio (relacionamento, embarcador,
-- transportadora). Compartilhar para "o embarcador errado" e impossivel no banco.
DO $$ BEGIN
  ALTER TABLE public.shipper_document_shares
    ADD CONSTRAINT shipper_shares_relationship_boundary_fk
    FOREIGN KEY (relationship_id, shipper_org_id, empresa_id)
    REFERENCES public.shipper_carrier_relationships (id, shipper_org_id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.shipper_document_shares
    ADD CONSTRAINT shipper_shares_request_empresa_fk
    FOREIGN KEY (request_id, empresa_id)
    REFERENCES public.shipper_transport_requests (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 4. RLS + grants -- backend-mediado, igual a 080
-- ============================================================================
ALTER TABLE public.shipper_transport_request_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_request_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_document_shares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shipper_transport_request_submissions FROM anon, authenticated;
REVOKE ALL ON public.shipper_request_documents FROM anon, authenticated;
REVOKE ALL ON public.shipper_document_shares FROM anon, authenticated;

GRANT ALL ON public.shipper_transport_request_submissions TO service_role;
GRANT ALL ON public.shipper_request_documents TO service_role;
GRANT ALL ON public.shipper_document_shares TO service_role;

-- ============================================================================
-- 5. shipper_request_create_and_submit -- agora tambem grava a versao 1
-- ============================================================================
-- Substitui a versao da 080. A unica mudanca de comportamento: alem de gravar o
-- snapshot na solicitacao, registra a submissao v1 no historico, na MESMA
-- transacao. Sem isso, a v1 de uma solicitacao criada antes do primeiro reenvio
-- nao existiria no historico e o "v1 preservado" seria mentira.

CREATE OR REPLACE FUNCTION public.shipper_request_create_and_submit(
  p_shipper_org_id uuid,
  p_relationship_id uuid,
  p_portal_user_id uuid,
  p_reference_code text,
  p_cargo_name text,
  p_destination_name text,
  p_quantity_unit text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_notes text,
  p_origins jsonb,
  p_client_request_id text
) RETURNS public.shipper_transport_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rel record;
  v_request public.shipper_transport_requests;
  v_origin jsonb;
  v_snapshot jsonb;
  v_total numeric := 0;
  v_ordem int := 0;
  v_unit text;
BEGIN
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.shipper_transport_requests
      WHERE shipper_org_id = p_shipper_org_id
        AND created_by = p_portal_user_id
        AND client_request_id = p_client_request_id;
    IF FOUND THEN RETURN v_request; END IF;
  END IF;

  SELECT * INTO v_rel FROM public.shipper_carrier_relationships
    WHERE id = p_relationship_id AND shipper_org_id = p_shipper_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rel.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'relationship_not_active' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shipper_portal_users
    WHERE id = p_portal_user_id AND shipper_org_id = p_shipper_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'portal_user_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF p_origins IS NULL OR jsonb_array_length(p_origins) < 1 THEN
    RAISE EXCEPTION 'origins_required' USING ERRCODE = '22023';
  END IF;

  v_unit := COALESCE(NULLIF(p_quantity_unit, ''), 'ton');
  IF v_unit NOT IN ('kg','ton','tonelada') THEN
    RAISE EXCEPTION 'invalid_quantity_unit' USING ERRCODE = '22023';
  END IF;

  FOR v_origin IN SELECT * FROM jsonb_array_elements(p_origins)
  LOOP
    IF v_origin->>'quantity_unit' IS NOT NULL
       AND v_origin->>'quantity_unit' <> v_unit THEN
      RAISE EXCEPTION 'origin_unit_mismatch' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((v_origin->>'quantidade')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'origin_quantity_must_be_positive' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.shipper_transport_requests (
      empresa_id, shipper_org_id, relationship_id, reference_code, status,
      cargo_name, destination_name, quantity_unit, window_start, window_end,
      notes, created_by, client_request_id
    ) VALUES (
      v_rel.empresa_id, p_shipper_org_id, p_relationship_id, p_reference_code, 'DRAFT',
      p_cargo_name, p_destination_name, v_unit, p_window_start, p_window_end,
      p_notes, p_portal_user_id, p_client_request_id
    ) RETURNING * INTO v_request;
  EXCEPTION WHEN unique_violation THEN
    IF p_client_request_id IS NOT NULL THEN
      SELECT * INTO v_request FROM public.shipper_transport_requests
        WHERE shipper_org_id = p_shipper_org_id
          AND created_by = p_portal_user_id
          AND client_request_id = p_client_request_id;
      IF FOUND THEN RETURN v_request; END IF;
    END IF;
    RAISE;
  END;

  FOR v_origin IN SELECT * FROM jsonb_array_elements(p_origins)
  LOOP
    INSERT INTO public.shipper_transport_request_origins
      (request_id, empresa_id, nome, quantidade, quantity_unit, ordem)
    VALUES (
      v_request.id, v_rel.empresa_id,
      v_origin->>'nome',
      (v_origin->>'quantidade')::numeric,
      v_unit,
      v_ordem
    );
    v_total := v_total + (v_origin->>'quantidade')::numeric;
    v_ordem := v_ordem + 1;
  END LOOP;

  SELECT jsonb_build_object(
    'reference_code', v_request.reference_code,
    'cargo_name', v_request.cargo_name,
    'destination_name', v_request.destination_name,
    'quantity_unit', v_request.quantity_unit,
    'window_start', v_request.window_start,
    'window_end', v_request.window_end,
    'notes', v_request.notes,
    'origins', COALESCE(jsonb_agg(jsonb_build_object(
        'nome', o.nome, 'quantidade', o.quantidade,
        'quantity_unit', o.quantity_unit, 'ordem', o.ordem
      ) ORDER BY o.ordem), '[]'::jsonb),
    'total_quantidade', v_total,
    'snapshot_at', now()
  ) INTO v_snapshot
  FROM public.shipper_transport_request_origins o
  WHERE o.request_id = v_request.id;

  UPDATE public.shipper_transport_requests
    SET status = 'SUBMITTED', submitted_at = now(), submitted_snapshot = v_snapshot,
        current_submission_version = 1, updated_at = now()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

  -- Versao 1 do historico, na mesma transacao (PORTAL-B).
  INSERT INTO public.shipper_transport_request_submissions
    (request_id, empresa_id, shipper_org_id, version, snapshot, submitted_by)
  VALUES
    (v_request.id, v_rel.empresa_id, p_shipper_org_id, 1, v_snapshot, p_portal_user_id);

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 6. shipper_request_revise_and_resubmit -- correcao do embarcador (§33/§37)
-- ============================================================================
-- O reenvio e a operacao mais disputada do dominio: concorre com o aceite, a
-- rejeicao, o cancelamento e com outro reenvio. Todas essas operacoes travam a
-- MESMA linha de solicitacao com FOR UPDATE, entao existe exatamente uma ordem
-- serial de desfechos -- nunca duas historias paralelas.
--
-- O snapshot anterior NAO e tocado: ele continua na versao antiga, com a decisao
-- que a transportadora tomou sobre ele carimbada ao lado (§34/§38).

CREATE OR REPLACE FUNCTION public.shipper_request_revise_and_resubmit(
  p_shipper_org_id uuid,
  p_request_id uuid,
  p_portal_user_id uuid,
  p_cargo_name text,
  p_destination_name text,
  p_quantity_unit text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_notes text,
  p_origins jsonb,
  p_expected_version integer
) RETURNS public.shipper_transport_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.shipper_transport_requests;
  v_origin jsonb;
  v_snapshot jsonb;
  v_total numeric := 0;
  v_ordem int := 0;
  v_unit text;
  v_next_version integer;
BEGIN
  SELECT * INTO v_request FROM public.shipper_transport_requests
    WHERE id = p_request_id AND shipper_org_id = p_shipper_org_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shipper_portal_users
    WHERE id = p_portal_user_id AND shipper_org_id = p_shipper_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'portal_user_not_in_org' USING ERRCODE = '42501';
  END IF;

  -- So faz sentido corrigir o que a transportadora devolveu pedindo ajuste.
  -- Aceita/rejeitada/cancelada sao desfechos ja tomados: reenviar por cima
  -- reescreveria uma decisao de negocio (§37).
  IF v_request.status <> 'CHANGES_REQUESTED' THEN
    RAISE EXCEPTION 'request_not_revisable: %', v_request.status USING ERRCODE = '55000';
  END IF;

  -- O relacionamento precisa continuar ativo: revogado nao reenvia (§24).
  IF NOT EXISTS (
    SELECT 1 FROM public.shipper_carrier_relationships
    WHERE id = v_request.relationship_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'relationship_not_active' USING ERRCODE = '55000';
  END IF;

  -- Controle de versao otimista: se o portal estava vendo a v2 e alguem ja
  -- criou a v3, o reenvio falha em vez de sobrescrever silenciosamente.
  IF p_expected_version IS NOT NULL
     AND p_expected_version <> v_request.current_submission_version THEN
    RAISE EXCEPTION 'request_version_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_origins IS NULL OR jsonb_array_length(p_origins) < 1 THEN
    RAISE EXCEPTION 'origins_required' USING ERRCODE = '22023';
  END IF;

  v_unit := COALESCE(NULLIF(p_quantity_unit, ''), v_request.quantity_unit);
  IF v_unit NOT IN ('kg','ton','tonelada') THEN
    RAISE EXCEPTION 'invalid_quantity_unit' USING ERRCODE = '22023';
  END IF;

  FOR v_origin IN SELECT * FROM jsonb_array_elements(p_origins)
  LOOP
    IF v_origin->>'quantity_unit' IS NOT NULL
       AND v_origin->>'quantity_unit' <> v_unit THEN
      RAISE EXCEPTION 'origin_unit_mismatch' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((v_origin->>'quantidade')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'origin_quantity_must_be_positive' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- As origens da solicitacao passam a refletir a correcao. O que foi enviado
  -- antes continua integralmente preservado no snapshot da versao anterior --
  -- e e de la que a auditoria le, nunca daqui.
  DELETE FROM public.shipper_transport_request_origins WHERE request_id = v_request.id;

  FOR v_origin IN SELECT * FROM jsonb_array_elements(p_origins)
  LOOP
    INSERT INTO public.shipper_transport_request_origins
      (request_id, empresa_id, nome, quantidade, quantity_unit, ordem)
    VALUES (
      v_request.id, v_request.empresa_id,
      v_origin->>'nome',
      (v_origin->>'quantidade')::numeric,
      v_unit,
      v_ordem
    );
    v_total := v_total + (v_origin->>'quantidade')::numeric;
    v_ordem := v_ordem + 1;
  END LOOP;

  v_next_version := v_request.current_submission_version + 1;

  UPDATE public.shipper_transport_requests
    SET cargo_name = COALESCE(NULLIF(p_cargo_name, ''), cargo_name),
        destination_name = COALESCE(NULLIF(p_destination_name, ''), destination_name),
        quantity_unit = v_unit,
        window_start = p_window_start,
        window_end = p_window_end,
        notes = p_notes,
        status = 'SUBMITTED',
        submitted_at = now(),
        decided_at = NULL,
        decided_by = NULL,
        decision_reason = NULL,
        current_submission_version = v_next_version,
        revision_count = revision_count + 1,
        updated_at = now()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

  SELECT jsonb_build_object(
    'reference_code', v_request.reference_code,
    'cargo_name', v_request.cargo_name,
    'destination_name', v_request.destination_name,
    'quantity_unit', v_request.quantity_unit,
    'window_start', v_request.window_start,
    'window_end', v_request.window_end,
    'notes', v_request.notes,
    'origins', COALESCE(jsonb_agg(jsonb_build_object(
        'nome', o.nome, 'quantidade', o.quantidade,
        'quantity_unit', o.quantity_unit, 'ordem', o.ordem
      ) ORDER BY o.ordem), '[]'::jsonb),
    'total_quantidade', v_total,
    'snapshot_at', now()
  ) INTO v_snapshot
  FROM public.shipper_transport_request_origins o
  WHERE o.request_id = v_request.id;

  UPDATE public.shipper_transport_requests
    SET submitted_snapshot = v_snapshot WHERE id = v_request.id
    RETURNING * INTO v_request;

  -- Nova versao no historico. O indice unico (request_id, version) e a rede:
  -- dois reenvios simultaneos nao produzem duas v2.
  INSERT INTO public.shipper_transport_request_submissions
    (request_id, empresa_id, shipper_org_id, version, snapshot, submitted_by)
  VALUES
    (v_request.id, v_request.empresa_id, p_shipper_org_id, v_next_version, v_snapshot, p_portal_user_id);

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 7. shipper_request_accept -- carimba a decisao NA versao avaliada
-- ============================================================================
-- Mesma semantica atomica da 080 (FOR UPDATE, idempotencia, relacionamento
-- ativo). O que muda: alem de aceitar, marca QUAL versao foi aceita. Sem isso,
-- "aceito" ficaria pendurado na solicitacao e o historico nao diria a qual
-- submissao o aceite se refere.

CREATE OR REPLACE FUNCTION public.shipper_request_accept(
  p_empresa_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_accepted_snapshot jsonb
) RETURNS public.shipper_transport_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.shipper_transport_requests;
BEGIN
  SELECT * INTO v_request FROM public.shipper_transport_requests
    WHERE id = p_request_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'ACCEPTED' THEN
    RETURN v_request;
  END IF;
  IF v_request.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'request_not_acceptable: %', v_request.status USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shipper_carrier_relationships
    WHERE id = v_request.relationship_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'relationship_not_active' USING ERRCODE = '55000';
  END IF;

  UPDATE public.shipper_transport_requests
    SET status = 'ACCEPTED',
        decided_at = now(),
        decided_by = p_actor_id,
        accepted_snapshot = COALESCE(p_accepted_snapshot, v_request.submitted_snapshot),
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;

  UPDATE public.shipper_transport_request_submissions
    SET decision = 'ACCEPTED', decided_at = now(), decided_by = p_actor_id
    WHERE request_id = p_request_id
      AND version = v_request.current_submission_version
      AND decision IS NULL;

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 8. shipper_request_decide -- rejeitar / pedir ajustes, atomicamente
-- ============================================================================
-- Antes isso era um UPDATE condicional na aplicacao. Funcionava contra outra
-- rejeicao, mas concorria com o aceite e com o cancelamento sem travar a linha:
-- duas transacoes podiam ler 'SUBMITTED' e seguir caminhos diferentes. Aqui
-- disputa o MESMO FOR UPDATE das demais decisoes (§104).

CREATE OR REPLACE FUNCTION public.shipper_request_decide(
  p_empresa_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_new_status text,
  p_reason text
) RETURNS public.shipper_transport_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.shipper_transport_requests;
BEGIN
  IF p_new_status NOT IN ('REJECTED','CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'decision_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request FROM public.shipper_transport_requests
    WHERE id = p_request_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'request_not_acceptable: %', v_request.status USING ERRCODE = '55000';
  END IF;

  UPDATE public.shipper_transport_requests
    SET status = p_new_status,
        decided_at = now(),
        decided_by = p_actor_id,
        decision_reason = p_reason,
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;

  UPDATE public.shipper_transport_request_submissions
    SET decision = p_new_status, decision_reason = p_reason,
        decided_at = now(), decided_by = p_actor_id
    WHERE request_id = p_request_id
      AND version = v_request.current_submission_version
      AND decision IS NULL;

  RETURN v_request;
END;
$$;

-- ============================================================================
-- 9. shipper_invitation_activate -- ativacao atomica do convite (§19/§21/§22)
-- ============================================================================
-- A identidade (senha) e do Supabase Auth. Esta funcao NAO cria senha: ela
-- recebe o id de auth ja resolvido e faz, de forma atomica, tudo o que e
-- responsabilidade do dominio -- validar o convite, criar/vincular o usuario de
-- portal no embarcador certo e marcar o convite como aceito.
--
-- Convergencia de falha parcial (§21): se a identidade de auth foi criada mas
-- esta funcao nao chegou a rodar, nada de dominio existe; uma nova tentativa com
-- o mesmo convite reencontra a mesma identidade por e-mail e completa aqui. Se
-- esta funcao rodou, ela e idempotente por token: repetir devolve o mesmo
-- usuario, nunca um segundo.

CREATE OR REPLACE FUNCTION public.shipper_invitation_activate(
  p_token_hash text,
  p_auth_user_id uuid,
  p_email text,
  p_nome text
) RETURNS public.shipper_portal_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.shipper_portal_invitations;
  v_user public.shipper_portal_users;
BEGIN
  IF p_token_hash IS NULL OR btrim(p_token_hash) = '' THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_identity_required' USING ERRCODE = '22023';
  END IF;

  -- Trava o convite: duas ativacoes simultaneas do mesmo token serializam aqui.
  SELECT * INTO v_invite FROM public.shipper_portal_invitations
    WHERE token_hash = p_token_hash
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Replay: ja aceito por ESTA mesma identidade devolve o mesmo usuario.
  IF v_invite.status = 'ACCEPTED' THEN
    IF v_invite.accepted_by = p_auth_user_id THEN
      SELECT * INTO v_user FROM public.shipper_portal_users WHERE id = v_invite.accepted_by;
      RETURN v_user;
    END IF;
    -- Aceito por outra pessoa: o convite e de uso unico (§22).
    RAISE EXCEPTION 'invitation_already_used' USING ERRCODE = '55000';
  END IF;

  IF v_invite.status <> 'PENDING' THEN
    RAISE EXCEPTION 'invitation_not_pending: %', v_invite.status USING ERRCODE = '55000';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '55000';
  END IF;

  -- Convite so vale enquanto o relacionamento estiver ativo (§19).
  IF NOT EXISTS (
    SELECT 1 FROM public.shipper_carrier_relationships
    WHERE id = v_invite.relationship_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'relationship_not_active' USING ERRCODE = '55000';
  END IF;

  -- Identidade ja conhecida no portal? Ela precisa pertencer ao MESMO
  -- embarcador do convite -- caso contrario seria ativacao cross-org (§19).
  SELECT * INTO v_user FROM public.shipper_portal_users WHERE id = p_auth_user_id;
  IF FOUND THEN
    IF v_user.shipper_org_id <> v_invite.shipper_org_id THEN
      RAISE EXCEPTION 'portal_user_other_org' USING ERRCODE = '42501';
    END IF;
    IF v_user.status <> 'active' THEN
      RAISE EXCEPTION 'portal_user_disabled' USING ERRCODE = '42501';
    END IF;
  ELSE
    INSERT INTO public.shipper_portal_users (id, shipper_org_id, email, nome, status)
    VALUES (
      p_auth_user_id,
      v_invite.shipper_org_id,
      COALESCE(NULLIF(p_email, ''), v_invite.email),
      COALESCE(NULLIF(p_nome, ''), NULLIF(v_invite.nome_convidado, ''), v_invite.email),
      'active'
    )
    RETURNING * INTO v_user;
  END IF;

  UPDATE public.shipper_portal_invitations
    SET status = 'ACCEPTED', accepted_at = now(), accepted_by = v_user.id
    WHERE id = v_invite.id;

  RETURN v_user;
END;
$$;

-- ============================================================================
-- 10. Grants das funcoes -- service_role apenas, como na 080
-- ============================================================================
REVOKE ALL ON FUNCTION public.shipper_request_create_and_submit(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_create_and_submit(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.shipper_request_revise_and_resubmit(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_revise_and_resubmit(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,jsonb,integer) TO service_role;

REVOKE ALL ON FUNCTION public.shipper_request_accept(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_accept(uuid,uuid,uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.shipper_request_decide(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_decide(uuid,uuid,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.shipper_invitation_activate(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_invitation_activate(text,uuid,text,text) TO service_role;

-- ============================================================================
-- 11. Backfill do historico para solicitacoes ja enviadas (technical DML)
-- ============================================================================
-- Em producao PORTAL-A fechou com ZERO solicitacao, entao na pratica isto nao
-- move nada. Existe porque a migration precisa ser correta em qualquer base:
-- uma solicitacao ja enviada sem versao 1 tornaria o historico incompleto no
-- primeiro reenvio.

INSERT INTO public.shipper_transport_request_submissions
  (request_id, empresa_id, shipper_org_id, version, snapshot, submitted_at, submitted_by,
   decision, decision_reason, decided_at, decided_by)
SELECT r.id, r.empresa_id, r.shipper_org_id, 1, r.submitted_snapshot,
       COALESCE(r.submitted_at, r.created_at), r.created_by,
       CASE r.status
         WHEN 'ACCEPTED' THEN 'ACCEPTED'
         WHEN 'REJECTED' THEN 'REJECTED'
         WHEN 'CHANGES_REQUESTED' THEN 'CHANGES_REQUESTED'
         ELSE NULL
       END,
       CASE WHEN r.status IN ('ACCEPTED','REJECTED','CHANGES_REQUESTED') THEN r.decision_reason ELSE NULL END,
       CASE WHEN r.status IN ('ACCEPTED','REJECTED','CHANGES_REQUESTED')
            THEN COALESCE(r.decided_at, r.updated_at) ELSE NULL END,
       CASE WHEN r.status IN ('ACCEPTED','REJECTED','CHANGES_REQUESTED') THEN r.decided_by ELSE NULL END
FROM public.shipper_transport_requests r
WHERE r.submitted_snapshot IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.shipper_transport_request_submissions s WHERE s.request_id = r.id
  );

UPDATE public.shipper_transport_requests r
  SET current_submission_version = 1
  WHERE r.submitted_snapshot IS NOT NULL AND r.current_submission_version = 0;

-- ============================================================================
-- 12. Permissao de compartilhamento de documento (technical DML)
-- ============================================================================
-- Compartilhar documento com o embarcador expoe dado da operacao para fora da
-- transportadora. Nao herda de `requests.review` (decidir sobre uma solicitacao
-- e outra coisa) e mantem a politica congelada no owner review do PORTAL-A:
-- `operador` nao recebe nada por padrao (§42).
--
--   administrador  -> shipper_portal.documents.share
--   gerente_frota  -> shipper_portal.documents.share
--   operador       -> nada
--   demais         -> nada

CREATE OR REPLACE FUNCTION public.ensure_shipper_portal_b_permissions_for_empresa(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl record;
  v_keys text[];
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id obrigatorio' USING ERRCODE = '23514';
  END IF;

  FOR v_tpl IN
    SELECT id, stable_key FROM public.permission_templates WHERE empresa_id = p_empresa_id
  LOOP
    v_keys := CASE v_tpl.stable_key
      WHEN 'administrador' THEN ARRAY['shipper_portal.documents.share']
      WHEN 'gerente_frota' THEN ARRAY['shipper_portal.documents.share']
      ELSE ARRAY[]::text[]
    END;

    INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
    SELECT v_tpl.id, key, true FROM unnest(v_keys) AS key
    ON CONFLICT (template_id, permission_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_shipper_portal_b_permissions_for_empresa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_shipper_portal_b_permissions_for_empresa(uuid) TO service_role;

DO $$
DECLARE
  v_emp uuid;
BEGIN
  FOR v_emp IN SELECT id FROM public.empresas LOOP
    PERFORM public.ensure_shipper_portal_b_permissions_for_empresa(v_emp);
  END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK manual (logico, nao executado automaticamente):
--   DROP FUNCTION IF EXISTS public.ensure_shipper_portal_b_permissions_for_empresa(uuid);
--   DROP FUNCTION IF EXISTS public.shipper_invitation_activate(text,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.shipper_request_decide(uuid,uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.shipper_request_revise_and_resubmit(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,jsonb,integer);
--   DROP TABLE IF EXISTS public.shipper_document_shares;
--   DROP TABLE IF EXISTS public.shipper_request_documents;
--   DROP TABLE IF EXISTS public.shipper_transport_request_submissions;
--   ALTER TABLE public.shipper_transport_requests
--     DROP COLUMN IF EXISTS current_submission_version,
--     DROP COLUMN IF EXISTS revision_count;
--   (shipper_request_accept e shipper_request_create_and_submit voltariam ao
--    corpo da 080; permission_template_permissions do backfill NAO sao revertidas.)

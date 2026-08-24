-- Migration 080: Portal do Embarcador V1 (PORTAL-A) - fronteira de identidade externa
-- + solicitacao de transporte + handoff para o Operation Orchestrator.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_SHIPPER_PORTAL.
--
-- DECISAO DE FRONTEIRA (a mais importante desta migration):
--   O embarcador NAO e um usuario interno da transportadora. A auditoria confirmou
--   que middlewares/tenant.js deriva req.empresa_id direto de usuarios.empresa_id --
--   ou seja, criar o embarcador como linha em `usuarios` com empresa_id da
--   transportadora lhe daria, automaticamente, o tenant interno inteiro em qualquer
--   rota que use aquele middleware. Por isso a identidade externa vive em tabelas
--   PROPRIAS (shipper_portal_users), SEM coluna empresa_id, e o acesso a dados de
--   uma transportadora especifica passa obrigatoriamente por um RELACIONAMENTO
--   explicito e revogavel (shipper_carrier_relationships).
--
-- AUTENTICACAO (reuso, nao invencao -- §18): a senha continua sendo autoridade do
-- Supabase Auth (auth.users), exatamente como o login interno. shipper_portal_users.id
-- referencia a mesma identidade de auth. O que muda e o CONTEXTO: estar em auth.users
-- nao concede nada; o que concede e o relacionamento ativo. Uma mesma pessoa pode ser
-- usuario interno de uma transportadora E usuario de portal de um embarcador -- sao
-- contextos distintos, nunca somados (§23).
--
-- SUPERFICIE DE ESCRITA: 100% backend-mediada (§91). Nenhuma destas tabelas recebe
-- GRANT para anon/authenticated -- nem SELECT. O browser (interno ou externo) nunca
-- fala com o Data API para este dominio. RLS fica habilitado como defesa em
-- profundidade, com default-deny para qualquer papel que nao seja service_role.
--
-- Nao cria nenhuma linha de negocio. PRODUCTION_BUSINESS_WRITES=0.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. shipper_organizations -- a organizacao embarcadora (dona da carga)
-- ============================================================================
-- Entidade PROPRIA, deliberadamente SEM empresa_id: um embarcador existe por si,
-- e pode se relacionar com N transportadoras (§22). Amarrar o embarcador a uma
-- unica transportadora no schema impediria esse futuro sem ganho nenhum hoje.

CREATE TABLE IF NOT EXISTS public.shipper_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  documento TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipper_organizations_nome_idx
  ON public.shipper_organizations (lower(nome));

-- ============================================================================
-- 2. shipper_carrier_relationships -- A FRONTEIRA
-- ============================================================================
-- Esta tabela e a autoridade unica que responde "este embarcador pode ver algo
-- desta transportadora?". Revogar aqui corta o acesso nas requisicoes seguintes
-- sem apagar identidade nenhuma (§21/§83).

CREATE TABLE IF NOT EXISTS public.shipper_carrier_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ NULL,
  revocation_reason TEXT NULL,
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);

-- Um unico relacionamento por par (embarcador, transportadora).
CREATE UNIQUE INDEX IF NOT EXISTS shipper_carrier_relationships_pair_key
  ON public.shipper_carrier_relationships (shipper_org_id, empresa_id);
-- Chave composta usada pelas FKs de fronteira abaixo: garante no BANCO que uma
-- solicitacao nunca aponte para um relacionamento de outro embarcador/tenant (§89).
CREATE UNIQUE INDEX IF NOT EXISTS shipper_carrier_relationships_id_pair_key
  ON public.shipper_carrier_relationships (id, shipper_org_id, empresa_id);
CREATE INDEX IF NOT EXISTS shipper_carrier_relationships_empresa_idx
  ON public.shipper_carrier_relationships (empresa_id, status, created_at DESC);

-- ============================================================================
-- 3. shipper_portal_users -- identidade externa (SEM empresa_id, de proposito)
-- ============================================================================
-- id referencia a MESMA identidade do Supabase Auth usada pelo login interno
-- (auth.users.id), reaproveitando senha/reset/confirmacao sem inventar nada (§18).
-- Nao ha FK para auth.users aqui pelo mesmo motivo que public.usuarios tambem nao
-- tem: o schema auth e gerenciado pelo Supabase e nao versionado nesta cadeia.

CREATE TABLE IF NOT EXISTS public.shipper_portal_users (
  id UUID PRIMARY KEY,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipper_portal_users_email_key
  ON public.shipper_portal_users (lower(email));
-- Chave composta: FKs abaixo provam no banco que o autor de uma solicitacao
-- pertence ao embarcador daquela solicitacao.
CREATE UNIQUE INDEX IF NOT EXISTS shipper_portal_users_id_org_key
  ON public.shipper_portal_users (id, shipper_org_id);
CREATE INDEX IF NOT EXISTS shipper_portal_users_org_idx
  ON public.shipper_portal_users (shipper_org_id, status);

-- ============================================================================
-- 4. shipper_portal_invitations -- onboarding por convite da transportadora
-- ============================================================================
-- Token guardado apenas como HASH (§82), nunca em claro -- mesmo idioma das
-- credenciais de rastreamento (SEC-1 / 064).

CREATE TABLE IF NOT EXISTS public.shipper_portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  relationship_id UUID NOT NULL REFERENCES public.shipper_carrier_relationships(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nome_convidado TEXT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  accepted_by UUID NULL REFERENCES public.shipper_portal_users(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'ACCEPTED' OR accepted_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS shipper_portal_invitations_token_key
  ON public.shipper_portal_invitations (token_hash);
-- No maximo 1 convite PENDENTE por (relacionamento, e-mail): reconvidar substitui
-- o anterior explicitamente, nunca acumula tokens validos em paralelo.
CREATE UNIQUE INDEX IF NOT EXISTS shipper_portal_invitations_pending_key
  ON public.shipper_portal_invitations (relationship_id, lower(email))
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS shipper_portal_invitations_empresa_idx
  ON public.shipper_portal_invitations (empresa_id, status, created_at DESC);

DO $$ BEGIN
  ALTER TABLE public.shipper_portal_invitations
    ADD CONSTRAINT shipper_invitations_relationship_boundary_fk
    FOREIGN KEY (relationship_id, shipper_org_id, empresa_id)
    REFERENCES public.shipper_carrier_relationships (id, shipper_org_id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 5. shipper_transport_requests -- a solicitacao de transporte
-- ============================================================================
-- NAO e um Frete e NAO e uma Campaign: e a declaracao de necessidade do
-- embarcador (§24). Vira Campaign somente quando a transportadora aceita, via
-- Operation Orchestrator (§36/§99).
--
-- IMUTABILIDADE (§31/§88): submitted_snapshot congela exatamente o que foi
-- enviado; accepted_snapshot congela o que a transportadora aceitou. Editar o
-- cadastro do embarcador depois NUNCA reescreve a operacao historica.

CREATE TABLE IF NOT EXISTS public.shipper_transport_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  shipper_org_id UUID NOT NULL REFERENCES public.shipper_organizations(id) ON DELETE RESTRICT,
  relationship_id UUID NOT NULL REFERENCES public.shipper_carrier_relationships(id) ON DELETE RESTRICT,
  reference_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','ACCEPTED','REJECTED','CANCELLED')),
  cargo_name TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  quantity_unit TEXT NOT NULL DEFAULT 'ton' CHECK (quantity_unit IN ('kg','ton','tonelada')),
  window_start TIMESTAMPTZ NULL,
  window_end TIMESTAMPTZ NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES public.shipper_portal_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ NULL,
  submitted_snapshot JSONB NULL,
  decided_at TIMESTAMPTZ NULL,
  decided_by UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  decision_reason TEXT NULL,
  accepted_snapshot JSONB NULL,
  campaign_id UUID NULL REFERENCES public.operation_campaigns(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  client_request_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start),
  CHECK (status <> 'SUBMITTED' OR submitted_snapshot IS NOT NULL),
  CHECK (status <> 'ACCEPTED' OR accepted_snapshot IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS shipper_transport_requests_reference_key
  ON public.shipper_transport_requests (empresa_id, lower(reference_code));
CREATE UNIQUE INDEX IF NOT EXISTS shipper_transport_requests_id_empresa_key
  ON public.shipper_transport_requests (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS shipper_transport_requests_id_org_key
  ON public.shipper_transport_requests (id, shipper_org_id);
-- Idempotencia de criacao pelo portal (§115).
CREATE UNIQUE INDEX IF NOT EXISTS shipper_transport_requests_client_request_key
  ON public.shipper_transport_requests (shipper_org_id, created_by, client_request_id)
  WHERE client_request_id IS NOT NULL;
-- INVARIANTE (§38/§90): uma Campaign nunca pode ser reivindicada por duas
-- solicitacoes. Somado a transicao atomica de status na RPC de aceite, garante
-- que dois operadores aceitando ao mesmo tempo nao geram Campanhas duplicadas.
CREATE UNIQUE INDEX IF NOT EXISTS shipper_transport_requests_campaign_key
  ON public.shipper_transport_requests (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipper_transport_requests_inbox_idx
  ON public.shipper_transport_requests (empresa_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS shipper_transport_requests_org_idx
  ON public.shipper_transport_requests (shipper_org_id, status, created_at DESC);

DO $$ BEGIN
  ALTER TABLE public.shipper_transport_requests
    ADD CONSTRAINT shipper_requests_relationship_boundary_fk
    FOREIGN KEY (relationship_id, shipper_org_id, empresa_id)
    REFERENCES public.shipper_carrier_relationships (id, shipper_org_id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O autor da solicitacao precisa pertencer ao MESMO embarcador da solicitacao.
DO $$ BEGIN
  ALTER TABLE public.shipper_transport_requests
    ADD CONSTRAINT shipper_requests_author_org_fk
    FOREIGN KEY (created_by, shipper_org_id)
    REFERENCES public.shipper_portal_users (id, shipper_org_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A Campanha vinculada precisa pertencer a MESMA transportadora da solicitacao.
DO $$ BEGIN
  ALTER TABLE public.shipper_transport_requests
    ADD CONSTRAINT shipper_requests_campaign_empresa_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id)
    ON DELETE SET NULL (campaign_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 6. shipper_transport_request_origins -- multi-origem (§26)
-- ============================================================================
-- Mesma filosofia do Campaign-D: cada origem carrega a propria quantidade; o
-- total e sempre DERIVADO, nunca redigitado.

CREATE TABLE IF NOT EXISTS public.shipper_transport_request_origins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.shipper_transport_requests(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  quantidade NUMERIC(14,3) NOT NULL CHECK (quantidade >= 0),
  quantity_unit TEXT NOT NULL DEFAULT 'ton' CHECK (quantity_unit IN ('kg','ton','tonelada')),
  ordem INTEGER NOT NULL DEFAULT 0 CHECK (ordem >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipper_request_origins_nome_key
  ON public.shipper_transport_request_origins (request_id, lower(nome));
CREATE INDEX IF NOT EXISTS shipper_request_origins_request_idx
  ON public.shipper_transport_request_origins (request_id, ordem);

DO $$ BEGIN
  ALTER TABLE public.shipper_transport_request_origins
    ADD CONSTRAINT shipper_request_origins_request_empresa_fk
    FOREIGN KEY (request_id, empresa_id)
    REFERENCES public.shipper_transport_requests (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 7. RLS + grants -- backend-mediado, zero superficie de Data API (§91/§92)
-- ============================================================================
-- Diferente das tabelas internas (que dao SELECT a authenticated), o dominio do
-- portal NAO recebe grant algum para anon/authenticated. Motivo: aqui convivem
-- duas populacoes distintas (operadores internos e embarcadores externos) e uma
-- policy generica de tenant seria insuficiente para separar embarcadores dentro
-- da MESMA transportadora (§50). Toda leitura/escrita passa pelo backend, que
-- resolve a fronteira explicitamente. RLS fica ligado como defesa em profundidade:
-- sem policy para authenticated, o default e negar.

ALTER TABLE public.shipper_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_carrier_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_transport_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipper_transport_request_origins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shipper_organizations FROM anon, authenticated;
REVOKE ALL ON public.shipper_carrier_relationships FROM anon, authenticated;
REVOKE ALL ON public.shipper_portal_users FROM anon, authenticated;
REVOKE ALL ON public.shipper_portal_invitations FROM anon, authenticated;
REVOKE ALL ON public.shipper_transport_requests FROM anon, authenticated;
REVOKE ALL ON public.shipper_transport_request_origins FROM anon, authenticated;

GRANT ALL ON public.shipper_organizations TO service_role;
GRANT ALL ON public.shipper_carrier_relationships TO service_role;
GRANT ALL ON public.shipper_portal_users TO service_role;
GRANT ALL ON public.shipper_portal_invitations TO service_role;
GRANT ALL ON public.shipper_transport_requests TO service_role;
GRANT ALL ON public.shipper_transport_request_origins TO service_role;

-- ============================================================================
-- 8. shipper_request_accept -- transicao atomica de aceite (§38/§114)
-- ============================================================================
-- Dois operadores da transportadora clicando "Aceitar" ao mesmo tempo: o
-- SELECT ... FOR UPDATE serializa; quem chega depois ve o status ja mutado e
-- falha deterministicamente. O vinculo com a Campaign acontece numa segunda
-- fase (mesmo modelo ja provado no Dispatch V1) e e protegido pelo indice unico
-- shipper_transport_requests_campaign_key.

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

  -- Idempotencia: replay do proprio aceite devolve o mesmo resultado.
  IF v_request.status = 'ACCEPTED' THEN
    RETURN v_request;
  END IF;
  IF v_request.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'request_not_acceptable: %', v_request.status USING ERRCODE = '55000';
  END IF;

  -- O relacionamento precisa estar ATIVO no momento do aceite: um embarcador
  -- revogado nao pode ter solicitacao convertida em operacao (§21).
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
  RETURN v_request;
END;
$$;

-- ============================================================================
-- 9. shipper_request_link_campaign -- fase 2 idempotente (§37)
-- ============================================================================
-- Liga a solicitacao aceita a Campanha criada pelo Operation Orchestrator. Se ja
-- houver vinculo, devolve o existente sem recriar; se outra Campanha ja tiver
-- sido vinculada, falha explicitamente em vez de sobrescrever historia.

CREATE OR REPLACE FUNCTION public.shipper_request_link_campaign(
  p_empresa_id uuid,
  p_request_id uuid,
  p_campaign_id uuid
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
  IF v_request.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'request_not_accepted: %', v_request.status USING ERRCODE = '55000';
  END IF;

  IF v_request.campaign_id IS NOT NULL THEN
    IF v_request.campaign_id = p_campaign_id THEN
      RETURN v_request; -- replay identico
    END IF;
    RAISE EXCEPTION 'request_already_linked_to_another_campaign' USING ERRCODE = '55000';
  END IF;

  UPDATE public.shipper_transport_requests
    SET campaign_id = p_campaign_id, updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;
  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.shipper_request_accept(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_accept(uuid,uuid,uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.shipper_request_link_campaign(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipper_request_link_campaign(uuid,uuid,uuid) TO service_role;

-- ============================================================================
-- 10. Permissoes de gestao do portal pela transportadora (technical DML)
-- ============================================================================
-- Quem, DENTRO da transportadora, pode convidar embarcadores e decidir
-- solicitacoes. Mesmo idioma da 076/079. Nao concede nada ao embarcador -- o
-- acesso externo nunca vem de permission template, vem do relacionamento.

CREATE OR REPLACE FUNCTION public.ensure_shipper_portal_template_permissions_for_empresa(p_empresa_id uuid)
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
      WHEN 'administrador' THEN ARRAY['shipper_portal.manage','shipper_portal.requests.review']
      WHEN 'gerente_frota' THEN ARRAY['shipper_portal.requests.review']
      WHEN 'operador' THEN ARRAY['shipper_portal.requests.review']
      ELSE ARRAY[]::text[]
    END;

    INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
    SELECT v_tpl.id, key, true FROM unnest(v_keys) AS key
    ON CONFLICT (template_id, permission_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_shipper_portal_template_permissions_for_empresa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_shipper_portal_template_permissions_for_empresa(uuid) TO service_role;

DO $$
DECLARE
  v_emp uuid;
BEGIN
  FOR v_emp IN SELECT id FROM public.empresas LOOP
    PERFORM public.ensure_shipper_portal_template_permissions_for_empresa(v_emp);
  END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK manual (logico, nao executado automaticamente):
--   DROP FUNCTION IF EXISTS public.ensure_shipper_portal_template_permissions_for_empresa(uuid);
--   DROP FUNCTION IF EXISTS public.shipper_request_link_campaign(uuid,uuid,uuid);
--   DROP FUNCTION IF EXISTS public.shipper_request_accept(uuid,uuid,uuid,jsonb);
--   DROP TABLE IF EXISTS public.shipper_transport_request_origins;
--   DROP TABLE IF EXISTS public.shipper_transport_requests;
--   DROP TABLE IF EXISTS public.shipper_portal_invitations;
--   DROP TABLE IF EXISTS public.shipper_portal_users;
--   DROP TABLE IF EXISTS public.shipper_carrier_relationships;
--   DROP TABLE IF EXISTS public.shipper_organizations;
--   (permission_template_permissions do backfill NAO sao revertidas automaticamente.)

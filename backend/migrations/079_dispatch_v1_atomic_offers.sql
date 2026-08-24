-- Migration 079: Dispatch V1 - atomic offer lifecycle (direct assignment + offer/accept).
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_DISPATCH_079.
--
-- Escopo aditivo:
--   * dispatch_rounds / dispatch_offers: modela "necessidade operacional (planned trip
--     NAO materializado) -> candidatos convidados -> exatamente um vencedor";
--   * RPCs SECURITY DEFINER (service_role-only) para a decisao atomica do vencedor
--     (dispatch_round_create em modo DIRECT resolve na hora; dispatch_offer_accept
--     decide o vencedor em modo OFFER), cancelamento e recusa;
--   * backfill idempotente de permission_template_permissions para 'campaign.dispatch'
--     (managers) e 'campaign.dispatch_respond' (motorista), mesma forma da 076.
--
-- Decisao arquitetural (ver AUDIT em CAMPAIGN_DISPATCH_V1.md): fretes.motorista_id e
-- NOT NULL e freightCreationService exige motorista ATIVO antes do insert -- nao existe
-- "frete materializado sem motorista" hoje. Por isso Dispatch V1 opera sobre a
-- NECESSIDADE PRE-MATERIALIZACAO (campaign_planned_trips ainda sem candidate_driver_id),
-- e a ACEITACAO (vencedor decidido) converge para o mesmo materializeOne() do
-- Campaign-B (freightCreationService + freight_vehicle_assignments), reaproveitado sem
-- duplicar logica de criacao de frete (nao ha tabela paralela de "assignment" aqui).
--
-- Nao materializa fretes dentro desta migration, nao roda dispatch em producao e nao
-- cria nenhuma linha de negocio (technical/schema only). PRODUCTION_BUSINESS_WRITES=0.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. dispatch_rounds
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id UUID NOT NULL REFERENCES public.campaign_plan_versions(id) ON DELETE RESTRICT,
  planned_trip_id UUID NOT NULL REFERENCES public.campaign_planned_trips(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('DIRECT','OFFER')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ASSIGNED','EXPIRED','CANCELLED','CLOSED_NO_ACCEPTANCE')),
  expires_at TIMESTAMPTZ NULL,
  -- Preco/modalidade exigidos pela materializacao (freightCreationService). Congelados no
  -- momento da criacao do round: quem decide o dispatch ja precisa saber o preco, o mesmo
  -- contrato que "Materializar fretes" ja exige hoje (nao e uma decisao comercial nova).
  materialization_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  winner_offer_id UUID NULL,
  created_by UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ NULL,
  closed_reason TEXT NULL,
  request_id TEXT NULL,
  correlation_id TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_rounds_id_empresa_key
  ON public.dispatch_rounds (id, empresa_id);
-- Invariante (S20): no maximo UMA rodada ativa por viagem planejada.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_rounds_active_trip_key
  ON public.dispatch_rounds (planned_trip_id)
  WHERE status = 'OPEN';
-- Idempotencia de criacao (S31).
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_rounds_request_key
  ON public.dispatch_rounds (empresa_id, created_by, request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dispatch_rounds_campaign_idx
  ON public.dispatch_rounds (empresa_id, campaign_id, plan_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatch_rounds_trip_idx
  ON public.dispatch_rounds (planned_trip_id, status);

DO $$ BEGIN
  ALTER TABLE public.dispatch_rounds
    ADD CONSTRAINT dispatch_rounds_trip_plan_campaign_fk
    FOREIGN KEY (planned_trip_id, plan_version_id, campaign_id, empresa_id)
    REFERENCES public.campaign_planned_trips (id, plan_version_id, campaign_id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.dispatch_rounds
    ADD CONSTRAINT dispatch_rounds_plan_campaign_fk
    FOREIGN KEY (plan_version_id, campaign_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, campaign_id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.dispatch_rounds
    ADD CONSTRAINT dispatch_rounds_created_by_empresa_fk
    FOREIGN KEY (created_by, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. dispatch_offers (destinatarios de uma rodada)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES public.dispatch_rounds(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  asset_id UUID NULL REFERENCES public.fleet_assets(id) ON DELETE RESTRICT,
  composition_id UUID NULL REFERENCES public.vehicle_compositions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','LOST','CANCELLED')),
  decline_reason TEXT NULL,
  responded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((asset_id IS NULL) <> (composition_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offers_id_empresa_key
  ON public.dispatch_offers (id, empresa_id);
-- Um destinatario por rodada (sem convite duplicado ao mesmo motorista).
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offers_round_driver_key
  ON public.dispatch_offers (round_id, driver_id);
-- Invariante (S23): no maximo UM ACCEPTED por rodada. Rede de seguranca no nivel de
-- indice, alem da serializacao transacional feita pelas RPCs abaixo.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offers_accepted_per_round_key
  ON public.dispatch_offers (round_id)
  WHERE status = 'ACCEPTED';
CREATE INDEX IF NOT EXISTS dispatch_offers_driver_idx
  ON public.dispatch_offers (empresa_id, driver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatch_offers_round_idx
  ON public.dispatch_offers (round_id, status);

DO $$ BEGIN
  ALTER TABLE public.dispatch_offers
    ADD CONSTRAINT dispatch_offers_round_empresa_fk
    FOREIGN KEY (round_id, empresa_id)
    REFERENCES public.dispatch_rounds (id, empresa_id)
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.dispatch_offers
    ADD CONSTRAINT dispatch_offers_driver_empresa_fk
    FOREIGN KEY (driver_id, empresa_id)
    REFERENCES public.usuarios (id, empresa_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.dispatch_rounds
    ADD CONSTRAINT dispatch_rounds_winner_offer_fk
    FOREIGN KEY (winner_offer_id)
    REFERENCES public.dispatch_offers (id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 3. RLS + grants (least privilege - S69/S70)
-- ============================================================================
-- A superficie de escrita real e exclusivamente as RPCs abaixo (SECURITY DEFINER,
-- service_role-only). O browser NUNCA fala com o Supabase Data API diretamente nesta
-- app (backend Express e a unica autoridade); mesmo assim, 'authenticated' recebe
-- apenas SELECT aqui (mais restrito que o padrao de campaign_trip_freights, que dava
-- CRUD completo) para que um INSERT/UPDATE direto via Data API nunca possa burlar a
-- decisao atomica do vencedor.

ALTER TABLE public.dispatch_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_rounds_tenant_access ON public.dispatch_rounds;
CREATE POLICY dispatch_rounds_tenant_access ON public.dispatch_rounds
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_offers_tenant_access ON public.dispatch_offers;
CREATE POLICY dispatch_offers_tenant_access ON public.dispatch_offers
  FOR ALL TO authenticated
  USING (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()))
  WITH CHECK (rls_is_super_admin() OR (rls_is_company_admin() AND empresa_id = rls_empresa_id()));

REVOKE ALL ON public.dispatch_rounds FROM anon;
REVOKE ALL ON public.dispatch_rounds FROM authenticated;
GRANT SELECT ON public.dispatch_rounds TO authenticated;
GRANT ALL ON public.dispatch_rounds TO service_role;

REVOKE ALL ON public.dispatch_offers FROM anon;
REVOKE ALL ON public.dispatch_offers FROM authenticated;
GRANT SELECT ON public.dispatch_offers TO authenticated;
GRANT ALL ON public.dispatch_offers TO service_role;

-- ============================================================================
-- 4. dispatch_claim_planned_trip - reclamo atomico interno (S14/S15/S26)
-- ============================================================================
-- Chamada SOMENTE por dispatch_round_create (modo DIRECT) e dispatch_offer_accept.
-- Nao exposta diretamente ao backend (sem GRANT a service_role) -- e um passo interno
-- compartilhado, nao uma rota publica. pg_advisory_xact_lock por planned_trip_id
-- serializa QUALQUER caminho concorrente (DIRECT-vs-DIRECT, OFFER-vs-OFFER,
-- DIRECT-vs-OFFER) que tente decidir o executor da MESMA viagem planejada.

CREATE OR REPLACE FUNCTION public.dispatch_claim_planned_trip(
  p_empresa_id uuid,
  p_planned_trip_id uuid,
  p_driver_id uuid,
  p_asset_id uuid,
  p_composition_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('dispatch_trip:' || p_planned_trip_id::text));

  SELECT * INTO v_trip FROM public.campaign_planned_trips
    WHERE id = p_planned_trip_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'planned_trip_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_trip.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'planned_trip_not_dispatchable: %', v_trip.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_trip_freights WHERE planned_trip_id = p_planned_trip_id) THEN
    RAISE EXCEPTION 'planned_trip_already_materialized' USING ERRCODE = '55000';
  END IF;

  IF (p_asset_id IS NULL) = (p_composition_id IS NULL) THEN
    RAISE EXCEPTION 'exactly_one_resource_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_driver_id AND empresa_id = p_empresa_id AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'driver_not_eligible' USING ERRCODE = '55000';
  END IF;

  IF p_asset_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.fleet_assets
      WHERE id = p_asset_id AND empresa_id = p_empresa_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'resource_not_eligible' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_compositions
      WHERE id = p_composition_id AND empresa_id = p_empresa_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'resource_not_eligible' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Revalida o vinculo temporal motorista<->recurso (mesma autoridade do
  -- dispatchEligibilityService/materializeOne: driver_vehicle_assignments ativo).
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_vehicle_assignments
    WHERE empresa_id = p_empresa_id AND driver_id = p_driver_id
      AND assignment_status = 'active' AND valid_until IS NULL
      AND ((p_asset_id IS NOT NULL AND asset_id = p_asset_id)
        OR (p_composition_id IS NOT NULL AND composition_id = p_composition_id))
  ) THEN
    RAISE EXCEPTION 'stale_driver_resource_assignment' USING ERRCODE = '55000';
  END IF;

  UPDATE public.campaign_planned_trips
    SET candidate_driver_id = p_driver_id,
        candidate_asset_id = p_asset_id,
        candidate_composition_id = p_composition_id
    WHERE id = p_planned_trip_id;
END;
$$;

-- ============================================================================
-- 5. dispatch_round_create - cria a rodada (DIRECT resolve na hora; OFFER fica OPEN)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_round_create(
  p_empresa_id uuid,
  p_campaign_id uuid,
  p_plan_version_id uuid,
  p_planned_trip_id uuid,
  p_mode text,
  p_recipients jsonb,
  p_expires_at timestamptz,
  p_materialization_options jsonb,
  p_created_by uuid,
  p_request_id text,
  p_correlation_id text
) RETURNS public.dispatch_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round public.dispatch_rounds;
  v_existing public.dispatch_rounds;
  v_recipient jsonb;
  v_count int;
  v_offer_id uuid;
  v_driver_id uuid;
  v_asset_id uuid;
  v_composition_id uuid;
BEGIN
  IF p_mode NOT IN ('DIRECT','OFFER') THEN
    RAISE EXCEPTION 'invalid_mode: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'created_by_required' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia (S31): replay identico -> mesma rodada, sem recriar.
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.dispatch_rounds
      WHERE empresa_id = p_empresa_id AND created_by = p_created_by AND request_id = p_request_id;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dispatch_trip:' || p_planned_trip_id::text));

  -- Self-heal: expira preguicosamente uma rodada OPEN vencida da mesma viagem antes de
  -- checar o invariante "1 rodada ativa por viagem" (S20/S25 - sem cron para isso).
  UPDATE public.dispatch_rounds
    SET status = 'EXPIRED', closed_at = now(), closed_reason = 'expired_lazy'
    WHERE planned_trip_id = p_planned_trip_id AND empresa_id = p_empresa_id
      AND status = 'OPEN' AND expires_at IS NOT NULL AND expires_at <= now();
  UPDATE public.dispatch_offers o
    SET status = 'EXPIRED', responded_at = now()
    FROM public.dispatch_rounds r
    WHERE o.round_id = r.id AND r.planned_trip_id = p_planned_trip_id AND r.empresa_id = p_empresa_id
      AND r.status = 'EXPIRED' AND o.status = 'PENDING';

  IF EXISTS (
    SELECT 1 FROM public.dispatch_rounds
    WHERE planned_trip_id = p_planned_trip_id AND empresa_id = p_empresa_id AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'planned_trip_has_active_round' USING ERRCODE = '55000';
  END IF;

  -- candidate_* NULL exige explicitamente que a viagem ainda NAO tenha sido reclamada
  -- (nem por um dispatch anterior, nem pelo mecanismo antigo de candidato do planner).
  -- Sem isto, o status da viagem permanece 'PLANNED' mesmo apos um round virar
  -- ASSIGNED (candidate_* setado, materializacao ainda pendente na fase 2 assincrona
  -- do backend) -- e uma segunda rodada poderia ser criada na janela entre o accept e
  -- a materializacao. Este check fecha exatamente essa janela.
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_planned_trips
    WHERE id = p_planned_trip_id AND empresa_id = p_empresa_id AND campaign_id = p_campaign_id
      AND plan_version_id = p_plan_version_id AND status = 'PLANNED'
      AND candidate_driver_id IS NULL AND candidate_asset_id IS NULL AND candidate_composition_id IS NULL
  ) THEN
    RAISE EXCEPTION 'planned_trip_not_dispatchable' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_trip_freights WHERE planned_trip_id = p_planned_trip_id) THEN
    RAISE EXCEPTION 'planned_trip_already_materialized' USING ERRCODE = '55000';
  END IF;

  v_count := jsonb_array_length(COALESCE(p_recipients, '[]'::jsonb));
  IF v_count < 1 THEN
    RAISE EXCEPTION 'recipients_required' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'DIRECT' AND v_count <> 1 THEN
    RAISE EXCEPTION 'direct_assignment_requires_exactly_one_recipient' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'OFFER' AND p_expires_at IS NULL THEN
    RAISE EXCEPTION 'offer_round_requires_expiration' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.dispatch_rounds (
    empresa_id, campaign_id, plan_version_id, planned_trip_id, mode, status,
    expires_at, materialization_options, created_by, request_id, correlation_id
  ) VALUES (
    p_empresa_id, p_campaign_id, p_plan_version_id, p_planned_trip_id, p_mode,
    'OPEN', p_expires_at, COALESCE(p_materialization_options, '{}'::jsonb),
    p_created_by, p_request_id, p_correlation_id
  ) RETURNING * INTO v_round;

  FOR v_recipient IN SELECT * FROM jsonb_array_elements(p_recipients)
  LOOP
    INSERT INTO public.dispatch_offers (empresa_id, round_id, driver_id, asset_id, composition_id, status)
    VALUES (
      p_empresa_id, v_round.id,
      (v_recipient->>'driver_id')::uuid,
      NULLIF(v_recipient->>'asset_id','')::uuid,
      NULLIF(v_recipient->>'composition_id','')::uuid,
      'PENDING'
    )
    ON CONFLICT (round_id, driver_id) DO NOTHING;
  END LOOP;

  IF p_mode = 'DIRECT' THEN
    SELECT id, driver_id, asset_id, composition_id INTO v_offer_id, v_driver_id, v_asset_id, v_composition_id
      FROM public.dispatch_offers WHERE round_id = v_round.id LIMIT 1;

    PERFORM public.dispatch_claim_planned_trip(
      p_empresa_id, p_planned_trip_id, v_driver_id, v_asset_id, v_composition_id
    );

    UPDATE public.dispatch_offers SET status = 'ACCEPTED', responded_at = now() WHERE id = v_offer_id;
    UPDATE public.dispatch_rounds
      SET status = 'ASSIGNED', closed_at = now(), closed_reason = 'direct_assignment', winner_offer_id = v_offer_id
      WHERE id = v_round.id
      RETURNING * INTO v_round;
  END IF;

  RETURN v_round;
END;
$$;

-- ============================================================================
-- 6. dispatch_offer_accept - decisao atomica do vencedor (modo OFFER)
-- ============================================================================
-- S13/S14/S34: quando N motoristas recebem a MESMA rodada, no maximo UM pode virar
-- vencedor mesmo sob accepts simultaneos. `SELECT ... FOR UPDATE` na linha da rodada
-- serializa qualquer accept/cancel concorrente da MESMA rodada (quem chega depois ve o
-- estado ja mutado e falha deterministicamente); dispatch_claim_planned_trip adiciona
-- uma segunda camada (advisory lock por viagem) para o caso direct-assign-vs-offer.

CREATE OR REPLACE FUNCTION public.dispatch_offer_accept(
  p_empresa_id uuid,
  p_offer_id uuid,
  p_driver_id uuid,
  p_request_id text,
  p_correlation_id text
) RETURNS public.dispatch_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer record;
  v_round record;
BEGIN
  SELECT * INTO v_offer FROM public.dispatch_offers
    WHERE id = p_offer_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.driver_id <> p_driver_id THEN
    RAISE EXCEPTION 'offer_not_owned_by_driver' USING ERRCODE = '42501';
  END IF;

  -- Idempotencia (S32): replay do proprio vencedor -> mesmo resultado, sem re-executar.
  IF v_offer.status = 'ACCEPTED' THEN
    RETURN v_offer;
  END IF;

  SELECT * INTO v_round FROM public.dispatch_rounds
    WHERE id = v_offer.round_id AND empresa_id = p_empresa_id
    FOR UPDATE;

  -- Releitura pos-lock: outro accept/cancel pode ter mutado enquanto esperavamos o lock.
  SELECT * INTO v_offer FROM public.dispatch_offers WHERE id = p_offer_id;
  IF v_offer.status = 'ACCEPTED' THEN
    RETURN v_offer;
  END IF;
  IF v_offer.status <> 'PENDING' THEN
    RAISE EXCEPTION 'offer_no_longer_available: %', v_offer.status USING ERRCODE = '55000';
  END IF;
  IF v_round.status <> 'OPEN' THEN
    RAISE EXCEPTION 'round_not_open: %', v_round.status USING ERRCODE = '55000';
  END IF;
  IF v_round.expires_at IS NOT NULL AND v_round.expires_at <= now() THEN
    -- Nao persiste EXPIRED aqui: um RAISE EXCEPTION desfaz (rollback) qualquer UPDATE
    -- feito antes dele nesta mesma chamada, entao gravar e lancar exceptions na mesma
    -- invocacao e contraditorio (a gravacao nunca sobreviveria). A persistencia lazy de
    -- EXPIRED fica exclusivamente a cargo do self-heal em dispatch_round_create (S25) --
    -- aqui so precisamos garantir, de forma correta, que o accept NUNCA seja aceito apos
    -- o vencimento (a excecao abaixo ja cumpre isso).
    RAISE EXCEPTION 'round_expired' USING ERRCODE = '55000';
  END IF;

  PERFORM public.dispatch_claim_planned_trip(
    p_empresa_id, v_round.planned_trip_id, v_offer.driver_id, v_offer.asset_id, v_offer.composition_id
  );

  UPDATE public.dispatch_offers SET status = 'ACCEPTED', responded_at = now()
    WHERE id = p_offer_id RETURNING * INTO v_offer;
  UPDATE public.dispatch_rounds
    SET status = 'ASSIGNED', closed_at = now(), closed_reason = 'offer_accepted', winner_offer_id = p_offer_id
    WHERE id = v_round.id;
  UPDATE public.dispatch_offers SET status = 'LOST', responded_at = now()
    WHERE round_id = v_round.id AND status = 'PENDING' AND id <> p_offer_id;

  RETURN v_offer;
END;
$$;

-- ============================================================================
-- 7. dispatch_offer_decline
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_offer_decline(
  p_empresa_id uuid,
  p_offer_id uuid,
  p_driver_id uuid,
  p_reason text,
  p_request_id text
) RETURNS public.dispatch_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer record;
BEGIN
  SELECT * INTO v_offer FROM public.dispatch_offers
    WHERE id = p_offer_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.driver_id <> p_driver_id THEN
    RAISE EXCEPTION 'offer_not_owned_by_driver' USING ERRCODE = '42501';
  END IF;

  -- Idempotencia (S33).
  IF v_offer.status = 'DECLINED' THEN
    RETURN v_offer;
  END IF;
  IF v_offer.status <> 'PENDING' THEN
    RAISE EXCEPTION 'offer_no_longer_available: %', v_offer.status USING ERRCODE = '55000';
  END IF;

  UPDATE public.dispatch_offers
    SET status = 'DECLINED', responded_at = now(), decline_reason = p_reason
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;
  RETURN v_offer;
END;
$$;

-- ============================================================================
-- 8. dispatch_round_cancel
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_round_cancel(
  p_empresa_id uuid,
  p_round_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS public.dispatch_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round record;
BEGIN
  SELECT * INTO v_round FROM public.dispatch_rounds
    WHERE id = p_round_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotencia.
  IF v_round.status = 'CANCELLED' THEN
    RETURN v_round;
  END IF;
  IF v_round.status <> 'OPEN' THEN
    RAISE EXCEPTION 'round_not_cancellable: %', v_round.status USING ERRCODE = '55000';
  END IF;

  UPDATE public.dispatch_rounds
    SET status = 'CANCELLED', closed_at = now(), closed_reason = COALESCE(NULLIF(p_reason, ''), 'manager_cancelled')
    WHERE id = p_round_id
    RETURNING * INTO v_round;
  UPDATE public.dispatch_offers SET status = 'CANCELLED', responded_at = now()
    WHERE round_id = p_round_id AND status = 'PENDING';

  RETURN v_round;
END;
$$;

-- ============================================================================
-- 9. Grants das RPCs publicas (least privilege - S16/S70). dispatch_claim_planned_trip
--    e interna: nao recebe GRANT nenhum (so chamada de dentro das RPCs acima).
-- ============================================================================

REVOKE ALL ON FUNCTION public.dispatch_round_create(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,jsonb,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_round_create(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,jsonb,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_round_create(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,jsonb,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_round_create(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,jsonb,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_offer_accept(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_offer_accept(uuid,uuid,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_offer_accept(uuid,uuid,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_offer_accept(uuid,uuid,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_offer_decline(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_offer_decline(uuid,uuid,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_offer_decline(uuid,uuid,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_offer_decline(uuid,uuid,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_round_cancel(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_round_cancel(uuid,uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_round_cancel(uuid,uuid,uuid,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_round_cancel(uuid,uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_claim_planned_trip(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_claim_planned_trip(uuid,uuid,uuid,uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_claim_planned_trip(uuid,uuid,uuid,uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.dispatch_claim_planned_trip(uuid,uuid,uuid,uuid,uuid) FROM service_role;

-- ============================================================================
-- 10. Permissoes (technical DML - S71): 'campaign.dispatch' (managers) e
--     'campaign.dispatch_respond' (motorista). Mesmo idioma da 076
--     (ensure_operation_campaign_template_permissions_for_empresa): backfill das
--     empresas existentes + funcao reaproveitada por permissionProvisioning.js no
--     fluxo de criacao de empresa nova. So concede a quem ja tem 'campaign.manage'
--     hoje (administrador/gerente_frota) e ao motorista (resposta a oferta propria).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_dispatch_v1_template_permissions_for_empresa(p_empresa_id uuid)
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
    SELECT id, stable_key
      FROM public.permission_templates
     WHERE empresa_id = p_empresa_id
  LOOP
    v_keys := CASE v_tpl.stable_key
      WHEN 'administrador' THEN ARRAY['campaign.dispatch']
      WHEN 'gerente_frota' THEN ARRAY['campaign.dispatch']
      WHEN 'motorista' THEN ARRAY['campaign.dispatch_respond']
      ELSE ARRAY[]::text[]
    END;

    INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
    SELECT v_tpl.id, key, true FROM unnest(v_keys) AS key
    ON CONFLICT (template_id, permission_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_dispatch_v1_template_permissions_for_empresa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_dispatch_v1_template_permissions_for_empresa(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_dispatch_v1_template_permissions_for_empresa(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_dispatch_v1_template_permissions_for_empresa(uuid) TO service_role;

DO $$
DECLARE
  v_emp uuid;
BEGIN
  FOR v_emp IN SELECT id FROM public.empresas LOOP
    PERFORM public.ensure_dispatch_v1_template_permissions_for_empresa(v_emp);
  END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK manual (logico, nao executado automaticamente):
--   DROP FUNCTION IF EXISTS public.ensure_dispatch_v1_template_permissions_for_empresa(uuid);
--   DROP FUNCTION IF EXISTS public.dispatch_round_cancel(uuid,uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.dispatch_offer_decline(uuid,uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.dispatch_offer_accept(uuid,uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.dispatch_round_create(uuid,uuid,uuid,uuid,text,jsonb,timestamptz,jsonb,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.dispatch_claim_planned_trip(uuid,uuid,uuid,uuid,uuid);
--   DROP TABLE IF EXISTS public.dispatch_offers;
--   DROP TABLE IF EXISTS public.dispatch_rounds;
--   (permission_template_permissions inseridas pelo backfill NAO sao revertidas
--    automaticamente -- decisao de produto, nao efeito colateral de schema.)

-- DB-SEC-1: hardening de funcoes public auditadas.
--
-- Escopo:
--   * sem DML de negocio;
--   * sem migration de dados;
--   * sem alterar Asaas, ERP, entitlements ou PR #490;
--   * corrigir grants de EXECUTE e search_path das funcoes auditadas.
--
-- Autoridade:
--   * helpers RLS rls_* continuam executaveis por authenticated + service_role;
--   * rotinas backend-only/maintenance ficam service_role-only;
--   * trigger functions continuam funcionando por trigger, mas deixam de ser RPC publica;
--   * default privileges globais ou de platform schemas nao sao alterados.

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER legadas expostas como RPC publica.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.empresa_ativa(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.empresa_ativa(uuid) SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.empresa_ativa(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.empresa_ativa(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.expirar_trials()') IS NOT NULL THEN
    ALTER FUNCTION public.expirar_trials() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.expirar_trials() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.expirar_trials() TO service_role;
  END IF;

  IF to_regprocedure('public.is_admin()') IS NOT NULL THEN
    ALTER FUNCTION public.is_admin() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
  END IF;

  IF to_regprocedure('public.verificar_limite_motoristas()') IS NOT NULL THEN
    ALTER FUNCTION public.verificar_limite_motoristas() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.verificar_limite_motoristas() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.verificar_limite_motoristas() TO service_role;
  END IF;

  IF to_regprocedure('public.purge_frete_localizacoes_vencidas()') IS NOT NULL THEN
    ALTER FUNCTION public.purge_frete_localizacoes_vencidas() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.purge_frete_localizacoes_vencidas() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.purge_frete_localizacoes_vencidas() TO service_role;
  END IF;
END $$;
-- ---------------------------------------------------------------------------
-- 2. Helpers legados ainda usados por policies de configuracoes.
--    authenticated precisa permanecer, anon/PUBLIC nao.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.empresa_id()') IS NOT NULL THEN
    ALTER FUNCTION public.empresa_id() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.empresa_id() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.empresa_id() TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.is_super_admin()') IS NOT NULL THEN
    ALTER FUNCTION public.is_super_admin() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers RLS canonicos: preservar contrato authenticated + service_role,
--    apenas reafirmar search_path fixo e ausencia de anon/PUBLIC.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.rls_empresa_id()') IS NOT NULL THEN
    ALTER FUNCTION public.rls_empresa_id() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.rls_empresa_id() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.rls_empresa_id() TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.rls_is_company_admin()') IS NOT NULL THEN
    ALTER FUNCTION public.rls_is_company_admin() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.rls_is_company_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.rls_is_company_admin() TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.rls_is_super_admin()') IS NOT NULL THEN
    ALTER FUNCTION public.rls_is_super_admin() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.rls_is_super_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Trigger functions com search_path mutavel ou grants herdados.
--    Triggers nao dependem de EXECUTE para anon/authenticated.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_empresa_timestamp()') IS NOT NULL THEN
    ALTER FUNCTION public.update_empresa_timestamp() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.update_empresa_timestamp() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.update_empresa_timestamp() TO service_role;
  END IF;

  IF to_regprocedure('public.check_motorista_limit()') IS NOT NULL THEN
    ALTER FUNCTION public.check_motorista_limit() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.check_motorista_limit() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.check_motorista_limit() TO service_role;
  END IF;

  IF to_regprocedure('public.contrato_modelos_protege_publicado()') IS NOT NULL THEN
    ALTER FUNCTION public.contrato_modelos_protege_publicado() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.contrato_modelos_protege_publicado() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.contrato_modelos_protege_publicado() TO service_role;
  END IF;

  IF to_regprocedure('public.set_asaas_webhook_events_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.set_asaas_webhook_events_updated_at() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.set_asaas_webhook_events_updated_at() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.set_asaas_webhook_events_updated_at() TO service_role;
  END IF;

  IF to_regprocedure('public.partner_opportunity_congelar_snapshot()') IS NOT NULL THEN
    ALTER FUNCTION public.partner_opportunity_congelar_snapshot() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.partner_opportunity_congelar_snapshot() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.partner_opportunity_congelar_snapshot() TO service_role;
  END IF;

  IF to_regprocedure('public.partner_response_append_only()') IS NOT NULL THEN
    ALTER FUNCTION public.partner_response_append_only() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.partner_response_append_only() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.partner_response_append_only() TO service_role;
  END IF;

  IF to_regprocedure('public.partner_network_event_append_only()') IS NOT NULL THEN
    ALTER FUNCTION public.partner_network_event_append_only() SET search_path = public, pg_catalog;
    REVOKE EXECUTE ON FUNCTION public.partner_network_event_append_only() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.partner_network_event_append_only() TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. RPCs operacionais P1: ja eram service_role-only; fixar search_path.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.p1_audit(text,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_audit(text,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_criar_grupo(text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_criar_grupo(text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_atualizar_grupo(uuid,text,text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_atualizar_grupo(uuid,text,text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_vincular_empresa_grupo(uuid,uuid,text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_vincular_empresa_grupo(uuid,uuid,text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_criar_unidade(uuid,uuid,text,text,text,text,text,text,text,boolean,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_criar_unidade(uuid,uuid,text,text,text,text,text,text,text,boolean,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_atualizar_unidade(uuid,text,text,text,text,boolean,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_atualizar_unidade(uuid,text,text,text,text,boolean,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_criar_regiao(uuid,uuid,text,text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_criar_regiao(uuid,uuid,text,text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_atualizar_regiao(uuid,text,text,text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_atualizar_regiao(uuid,text,text,text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_definir_unidades_regiao(uuid,uuid[],uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_definir_unidades_regiao(uuid,uuid[],uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_criar_membership(uuid,uuid,uuid,text,uuid,uuid,text,boolean,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_criar_membership(uuid,uuid,uuid,text,uuid,uuid,text,boolean,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_atualizar_membership(uuid,text,uuid,uuid,text,text,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_atualizar_membership(uuid,text,uuid,uuid,text,text,uuid,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.p1_ativar_enforcement(uuid,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.p1_ativar_enforcement(uuid,uuid,text) SET search_path = public, pg_catalog;
  END IF;
END $$;

-- Reafirmar grants service_role-only das RPCs P1, caso algum ambiente tenha sido
-- criado antes do hardening da 067.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.p1_audit(text,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text)',
    'public.p1_criar_grupo(text,uuid,text)',
    'public.p1_atualizar_grupo(uuid,text,text,uuid,text)',
    'public.p1_vincular_empresa_grupo(uuid,uuid,text,uuid,text)',
    'public.p1_criar_unidade(uuid,uuid,text,text,text,text,text,text,text,boolean,uuid,text)',
    'public.p1_atualizar_unidade(uuid,text,text,text,text,boolean,uuid,text)',
    'public.p1_criar_regiao(uuid,uuid,text,text,uuid,text)',
    'public.p1_atualizar_regiao(uuid,text,text,text,uuid,text)',
    'public.p1_definir_unidades_regiao(uuid,uuid[],uuid,text)',
    'public.p1_criar_membership(uuid,uuid,uuid,text,uuid,uuid,text,boolean,uuid,text)',
    'public.p1_atualizar_membership(uuid,text,uuid,uuid,text,text,uuid,text)',
    'public.p1_ativar_enforcement(uuid,uuid,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

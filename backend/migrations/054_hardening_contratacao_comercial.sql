-- Hardening complementar da contratacao comercial.
-- NAO aplicar sem autorizacao explicita do proprietario para a migration 054 revisada.
-- Migration idempotente, sem alteracao ou exclusao de dados.
-- Escopo restrito a grants, helpers RLS e indices das tabelas comerciais.

REVOKE ALL ON TABLE public.propostas_comerciais FROM anon;
REVOKE ALL ON TABLE public.propostas_comerciais FROM authenticated;
REVOKE ALL ON TABLE public.contratos_comerciais FROM anon;
REVOKE ALL ON TABLE public.contratos_comerciais FROM authenticated;
REVOKE ALL ON TABLE public.contrato_signatarios FROM anon;
REVOKE ALL ON TABLE public.contrato_signatarios FROM authenticated;
REVOKE ALL ON TABLE public.contrato_eventos FROM anon;
REVOKE ALL ON TABLE public.contrato_eventos FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_is_super_admin() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_is_company_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_is_company_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_is_company_admin() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_empresa_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_empresa_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_empresa_id() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_company_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_empresa_id() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_contrato_signatarios_empresa
  ON public.contrato_signatarios (empresa_id)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contrato_eventos_empresa_criado
  ON public.contrato_eventos (empresa_id, criado_em DESC)
  WHERE empresa_id IS NOT NULL;

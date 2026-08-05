-- 99_grants_service_role_test.sql — SOMENTE PARA O BANCO DE TESTE (CI).
--
-- NÃO é migration de produção. Reproduz os privilégios padrão que o Supabase já
-- concede ao papel service_role (BYPASSRLS + acesso às tabelas do schema public),
-- para que a RPC (SECURITY INVOKER) opere sob `SET ROLE service_role` no teste de
-- privilégios de forma fiel à produção. anon/authenticated recebem apenas USAGE
-- no schema (como na prod) — o EXECUTE da RPC permanece revogado (migration 061),
-- provando a negação pela via correta (42501 no EXECUTE, não por falta de schema).

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER ROLE service_role BYPASSRLS;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

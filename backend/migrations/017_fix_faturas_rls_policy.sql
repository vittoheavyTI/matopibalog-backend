-- Migration 017: Corrigir as policies RLS da tabela `faturas`
-- Rodar no Supabase SQL Editor (manual; NÃO aplicar automaticamente).
--
-- ┌─ CONTEXTO ────────────────────────────────────────────────────────────────┐
-- │ * As migrations 015/016 já foram aplicadas: RLS ligado nas 8 tabelas       │
-- │   críticas, policies legadas removidas e apenas as 9 policies corretas      │
-- │   `*_tenant_access` / `planos_read` / `planos_admin_write` ativas.          │
-- │ * `faturas` JÁ TINHA RLS ativo, mas manteve policy LEGADA com semântica     │
-- │   antiga: tratava QUALQUER usuarios.tipo='admin' como "vê tudo". No modelo  │
-- │   atual, billing/faturas é área de PLATAFORMA — um admin COMUM não pode     │
-- │   ver faturas de outras empresas via acesso direto ao Postgres.            │
-- │                                                                            │
-- │ Esta migration 017 troca as policies de `faturas` por policies corretas,    │
-- │ SEM desabilitar RLS e SEM tocar em dados.                                   │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- DECISÃO DE PRODUTO (billing = plataforma):
--   * super-admin  → acesso TOTAL (leitura + escrita).
--   * admin comum  → SOMENTE LEITURA das faturas DA PRÓPRIA EMPRESA
--                    (suporta a tela "Minhas Faturas" da transportadora).
--   * escrita (INSERT/UPDATE/DELETE) → SOMENTE super-admin.
--     Cobranças são criadas/alteradas pela plataforma; admin comum não escreve.
--   * NENHUMA policy aberta para `public`/anon.
--
-- GARANTIAS:
--   * idempotente (DROP POLICY IF EXISTS + CREATE; reexecutável);
--   * NÃO desabilita RLS em faturas;
--   * NÃO mexe em dados (sem DROP TABLE/DELETE/UPDATE/INSERT/TRUNCATE);
--   * NÃO usa coluna `role` — usa is_super_admin / tipo / empresa_id via helpers;
--   * reutiliza os helpers SECURITY DEFINER da migration 015
--     (rls_is_super_admin(), rls_is_company_admin(), rls_empresa_id()).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remover policies LEGADAS de faturas (semântica antiga tipo='admin'=tudo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cobre os nomes versionados/diagnosticados e os mesmos padrões limpos na 016.
-- DROP IF EXISTS é no-op para nomes inexistentes (idempotente).
DROP POLICY IF EXISTS faturas_isolation                 ON faturas;
DROP POLICY IF EXISTS admin_le_proprias_faturas         ON faturas;
DROP POLICY IF EXISTS superadmin_le_todas_faturas       ON faturas;
DROP POLICY IF EXISTS admin_all_faturas                 ON faturas;
DROP POLICY IF EXISTS super_admin_tudo_faturas          ON faturas;
DROP POLICY IF EXISTS user_manage_faturas               ON faturas;
DROP POLICY IF EXISTS usuario_empresa_select_faturas    ON faturas;
DROP POLICY IF EXISTS usuario_empresa_insert_faturas    ON faturas;
DROP POLICY IF EXISTS usuario_empresa_update_faturas    ON faturas;
DROP POLICY IF EXISTS usuario_empresa_delete_faturas    ON faturas;
DROP POLICY IF EXISTS usuario_select_faturas            ON faturas;

-- Novas policies deste PR (idempotência ao reaplicar a migration)
DROP POLICY IF EXISTS faturas_superadmin_all            ON faturas;
DROP POLICY IF EXISTS faturas_empresa_select            ON faturas;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Policies novas
-- ─────────────────────────────────────────────────────────────────────────────

-- super-admin → tudo (leitura + escrita)
CREATE POLICY faturas_superadmin_all ON faturas
  FOR ALL
  USING (rls_is_super_admin())
  WITH CHECK (rls_is_super_admin());

-- admin comum → SOMENTE LEITURA das faturas da própria empresa.
-- Gated por rls_is_company_admin() para que apenas o ADMIN da empresa veja as
-- cobranças (motorista da empresa não enxerga faturas via SQL direto).
-- empresa_id = rls_empresa_id() garante o isolamento por tenant; se algum dos
-- lados for NULL, a comparação é NULL (≠ TRUE) → nega, como esperado.
CREATE POLICY faturas_empresa_select ON faturas
  FOR SELECT
  USING (
    rls_is_company_admin()
    AND empresa_id IS NOT NULL
    AND empresa_id = rls_empresa_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA:
--   * Nenhuma policy de escrita para admin comum (billing é plataforma).
--   * RLS de faturas permanece ATIVO (esta migration não chama DISABLE).
--   * Sem impacto na API: o backend usa service_role (BYPASSRLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration 016: Limpar policies RLS LEGADAS remanescentes
-- Rodar no Supabase SQL Editor (manual; NÃO aplicar automaticamente).
--
-- ┌─ CONTEXTO ────────────────────────────────────────────────────────────────┐
-- │ * A migration 015 HABILITOU RLS (rowsecurity = true) nas 8 tabelas alvo    │
-- │   (usuarios, motoristas, empresas, fretes, despesas, abastecimentos,       │
-- │   vales, planos) e criou as policies corretas `*_tenant_access` +          │
-- │   `planos_read`/`planos_admin_write`, além dos helpers SECURITY DEFINER     │
-- │   rls_is_super_admin(), rls_is_company_admin(), rls_empresa_id().           │
-- │ * O diagnóstico PÓS-aplicação mostrou que várias policies LEGADAS de        │
-- │   tentativas anteriores continuaram presentes nas mesmas tabelas.          │
-- │ * Policies em Postgres são PERMISSIVAS por padrão: o acesso é a UNIÃO de    │
-- │   todas as policies. Logo, qualquer policy legada permissiva pode ABRIR     │
-- │   acesso além do desejado, mesmo com as novas policies corretas no lugar.  │
-- │                                                                            │
-- │ Esta migration 016 APENAS REMOVE as policies legadas remanescentes,        │
-- │ deixando ativas somente as policies corretas da migration 015.             │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- GARANTIAS DESTA MIGRATION:
--   * idempotente — usa SOMENTE `DROP POLICY IF EXISTS` (no-op se a policy
--     não existir); pode rodar mais de uma vez sem erro;
--   * NÃO desabilita RLS;
--   * NÃO mexe em dados (sem DROP TABLE/DELETE/UPDATE/INSERT/TRUNCATE);
--   * NÃO remove as policies novas `*_tenant_access` / `planos_read` /
--     `planos_admin_write`;
--   * NÃO remove os helpers rls_*;
--   * NÃO toca em `faturas` (ver follow-up no fim do arquivo).

-- ─────────────────────────────────────────────────────────────────────────────
-- usuarios
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_usuarios               ON usuarios;
DROP POLICY IF EXISTS super_admin_tudo_usuarios         ON usuarios;
DROP POLICY IF EXISTS user_view_self                    ON usuarios;
DROP POLICY IF EXISTS usuario_empresa_select_usuarios   ON usuarios;
DROP POLICY IF EXISTS usuario_empresa_insert_usuarios   ON usuarios;
DROP POLICY IF EXISTS usuario_empresa_update_usuarios   ON usuarios;
DROP POLICY IF EXISTS usuario_empresa_delete_usuarios   ON usuarios;

-- ─────────────────────────────────────────────────────────────────────────────
-- motoristas
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_motoristas             ON motoristas;
DROP POLICY IF EXISTS super_admin_tudo_motoristas       ON motoristas;
DROP POLICY IF EXISTS user_view_motorista               ON motoristas;
DROP POLICY IF EXISTS usuario_empresa_select_motoristas ON motoristas;
DROP POLICY IF EXISTS usuario_empresa_insert_motoristas ON motoristas;
DROP POLICY IF EXISTS usuario_empresa_update_motoristas ON motoristas;
DROP POLICY IF EXISTS usuario_empresa_delete_motoristas ON motoristas;

-- ─────────────────────────────────────────────────────────────────────────────
-- empresas
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_tudo_empresas         ON empresas;
DROP POLICY IF EXISTS usuario_empresa_select_empresas   ON empresas;

-- ─────────────────────────────────────────────────────────────────────────────
-- fretes
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_fretes                 ON fretes;
DROP POLICY IF EXISTS super_admin_tudo_fretes           ON fretes;
DROP POLICY IF EXISTS user_manage_fretes                ON fretes;
DROP POLICY IF EXISTS usuario_empresa_select_fretes     ON fretes;
DROP POLICY IF EXISTS usuario_empresa_insert_fretes     ON fretes;
DROP POLICY IF EXISTS usuario_empresa_update_fretes     ON fretes;
DROP POLICY IF EXISTS usuario_empresa_delete_fretes     ON fretes;

-- ─────────────────────────────────────────────────────────────────────────────
-- despesas
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_despesas               ON despesas;
DROP POLICY IF EXISTS super_admin_tudo_despesas         ON despesas;
DROP POLICY IF EXISTS user_manage_despesas              ON despesas;
DROP POLICY IF EXISTS usuario_empresa_select_despesas   ON despesas;
DROP POLICY IF EXISTS usuario_empresa_insert_despesas   ON despesas;
DROP POLICY IF EXISTS usuario_empresa_update_despesas   ON despesas;
DROP POLICY IF EXISTS usuario_empresa_delete_despesas   ON despesas;

-- ─────────────────────────────────────────────────────────────────────────────
-- abastecimentos
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_abastecimentos         ON abastecimentos;
DROP POLICY IF EXISTS super_admin_tudo_abastecimentos   ON abastecimentos;
DROP POLICY IF EXISTS user_manage_abastecimentos        ON abastecimentos;
DROP POLICY IF EXISTS usuario_empresa_select_abastecimentos ON abastecimentos;
DROP POLICY IF EXISTS usuario_empresa_insert_abastecimentos ON abastecimentos;
DROP POLICY IF EXISTS usuario_empresa_update_abastecimentos ON abastecimentos;
DROP POLICY IF EXISTS usuario_empresa_delete_abastecimentos ON abastecimentos;

-- ─────────────────────────────────────────────────────────────────────────────
-- vales
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS admin_all_vales                  ON vales;
DROP POLICY IF EXISTS super_admin_tudo_vales            ON vales;
DROP POLICY IF EXISTS user_manage_vales                 ON vales;
DROP POLICY IF EXISTS usuario_empresa_select_vales      ON vales;
DROP POLICY IF EXISTS usuario_empresa_insert_vales      ON vales;
DROP POLICY IF EXISTS usuario_empresa_update_vales      ON vales;
DROP POLICY IF EXISTS usuario_empresa_delete_vales      ON vales;

-- ─────────────────────────────────────────────────────────────────────────────
-- planos
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_tudo_planos           ON planos;
DROP POLICY IF EXISTS usuario_select_planos             ON planos;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEVEM PERMANECER (NÃO removidas aqui — criadas na migration 015):
--   usuarios_tenant_access, motoristas_tenant_access, empresas_tenant_access,
--   fretes_tenant_access, despesas_tenant_access, abastecimentos_tenant_access,
--   vales_tenant_access, planos_read, planos_admin_write
-- Helpers que permanecem:
--   rls_is_super_admin(), rls_is_company_admin(), rls_empresa_id()
--
-- FOLLOW-UP (fora do escopo deste PR):
--   * faturas: já tem RLS ativo, mas a policy legada `faturas_isolation` usa
--     tipo='admin' (semântica antiga; billing é plataforma → deveria ser
--     is_super_admin). Tratar em PR próprio. NÃO alterado aqui.
-- ─────────────────────────────────────────────────────────────────────────────

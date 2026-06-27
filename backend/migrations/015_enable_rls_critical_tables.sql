-- Migration 015: Habilitar RLS nas tabelas críticas com policies compatíveis
-- Rodar no Supabase SQL Editor (NÃO aplicar automaticamente; ver ordem segura abaixo).
--
-- Escopo deste PR (#167):
--   * habilita ROW LEVEL SECURITY em: usuarios, motoristas, empresas,
--     fretes, despesas, abastecimentos, vales e planos;
--   * cria policies compatíveis com o SCHEMA REAL de produção
--     (usuarios.is_super_admin + usuarios.empresa_id + usuarios.tipo);
--   * é idempotente (pode rodar mais de uma vez sem erro);
--   * NÃO mexe em faturas/configuracoes/termos/termos_aceites/documentos
--     (já têm RLS ativo — ver nota no fim do arquivo).
--
-- ┌─ POR QUE ISTO É "DEFENSE-IN-DEPTH" E NÃO MUDA O COMPORTAMENTO DA API ─┐
-- │ O backend acessa o Postgres via service_role, que tem BYPASSRLS:     │
-- │ continua enxergando tudo, então a API não muda.                      │
-- │ Painel web e app Flutter NÃO falam direto com o Supabase — passam    │
-- │ pelo backend. Logo, hoje nenhum cliente chega com JWT do Supabase    │
-- │ e auth.uid() é NULL para conexões anon → todas as policies abaixo    │
-- │ avaliam FALSE → acesso negado. Resultado: uma chave anon vazada não  │
-- │ lê nada, e as policies já ficam CORRETAS caso algum dia o acesso     │
-- │ direto com JWT do Supabase seja habilitado.                          │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- IMPORTANTE: estas policies usam usuarios.is_super_admin e usuarios.empresa_id.
-- NÃO existe e NÃO é usada nenhuma coluna `role`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helpers SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
-- Rodam com os privilégios do DONO da função (owner da tabela), que é isento de
-- RLS. Isso evita RECURSÃO INFINITA quando uma policy de `usuarios` precisa
-- consultar a própria tabela `usuarios`. `STABLE` permite cache dentro da query.
-- Prefixo rls_* para não colidir com is_admin() legado (migrations 002/full_setup).

CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM usuarios WHERE id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_empresa_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM usuarios WHERE id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Habilitar RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE usuarios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE abastecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE planos         ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Limpar policies LEGADAS incompatíveis (semântica antiga tipo='admin'=tudo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Origem: 002_create_rls.sql, full_setup.sql e backend/sql/01_init.sql.
-- Essas policies tratavam QUALQUER tipo='admin' como "vê tudo" — hoje admin é
-- admin COMUM (multi-tenant), o que vazaria empresas entre si. Removemos para
-- não conviverem com as novas. DROP IF EXISTS é no-op se nunca foram aplicadas.

-- 01_init.sql (isolation)
DROP POLICY IF EXISTS empresas_isolation       ON empresas;
DROP POLICY IF EXISTS usuarios_isolation        ON usuarios;
DROP POLICY IF EXISTS motoristas_isolation      ON motoristas;
DROP POLICY IF EXISTS fretes_isolation          ON fretes;
DROP POLICY IF EXISTS despesas_isolation        ON despesas;
DROP POLICY IF EXISTS abastecimentos_isolation  ON abastecimentos;
DROP POLICY IF EXISTS vales_isolation           ON vales;

-- 002_create_rls.sql
DROP POLICY IF EXISTS "Admins total usuarios"                 ON usuarios;
DROP POLICY IF EXISTS "Motorista vê próprio perfil"           ON usuarios;
DROP POLICY IF EXISTS "Admins total motoristas"               ON motoristas;
DROP POLICY IF EXISTS "Motorista vê próprio técnico"          ON motoristas;
DROP POLICY IF EXISTS "Admins total fretes"                   ON fretes;
DROP POLICY IF EXISTS "Motorista gerencia seus fretes"        ON fretes;
DROP POLICY IF EXISTS "Admins total despesas"                 ON despesas;
DROP POLICY IF EXISTS "Motorista gerencia suas despesas"      ON despesas;
DROP POLICY IF EXISTS "Admins total abastecimentos"           ON abastecimentos;
DROP POLICY IF EXISTS "Motorista gerencia seus abastecimentos" ON abastecimentos;
DROP POLICY IF EXISTS "Admins total vales"                    ON vales;
DROP POLICY IF EXISTS "Motorista gerencia seus vales"         ON vales;

-- full_setup.sql
DROP POLICY IF EXISTS "Admin pode tudo em usuarios"            ON usuarios;
DROP POLICY IF EXISTS "Motorista ve proprio perfil"           ON usuarios;
DROP POLICY IF EXISTS "Motorista atualiza proprio perfil"     ON usuarios;
DROP POLICY IF EXISTS "Admin pode tudo em motoristas"         ON motoristas;
DROP POLICY IF EXISTS "Motorista ve seus dados"               ON motoristas;
DROP POLICY IF EXISTS "Motorista nao altera comissao nem status" ON motoristas;
DROP POLICY IF EXISTS "Admin pode tudo em fretes"             ON fretes;
DROP POLICY IF EXISTS "Motorista ve seus fretes"              ON fretes;
DROP POLICY IF EXISTS "Motorista cria seus fretes"            ON fretes;
DROP POLICY IF EXISTS "Motorista atualiza seus fretes"        ON fretes;
DROP POLICY IF EXISTS "Motorista deleta seus fretes"          ON fretes;
DROP POLICY IF EXISTS "Admin pode tudo em despesas"          ON despesas;
DROP POLICY IF EXISTS "Motorista gerencia suas despesas"      ON despesas;
DROP POLICY IF EXISTS "Admin pode tudo em abastecimentos"    ON abastecimentos;
DROP POLICY IF EXISTS "Motorista gerencia seus abastecimentos" ON abastecimentos;
DROP POLICY IF EXISTS "Admin pode tudo em vales"             ON vales;
DROP POLICY IF EXISTS "Motorista gerencia seus vales"        ON vales;

-- Novas policies deste PR (idempotência ao reaplicar a migration)
DROP POLICY IF EXISTS usuarios_tenant_access       ON usuarios;
DROP POLICY IF EXISTS motoristas_tenant_access     ON motoristas;
DROP POLICY IF EXISTS empresas_tenant_access       ON empresas;
DROP POLICY IF EXISTS fretes_tenant_access         ON fretes;
DROP POLICY IF EXISTS despesas_tenant_access       ON despesas;
DROP POLICY IF EXISTS abastecimentos_tenant_access ON abastecimentos;
DROP POLICY IF EXISTS vales_tenant_access          ON vales;
DROP POLICY IF EXISTS planos_read                  ON planos;
DROP POLICY IF EXISTS planos_admin_write           ON planos;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Policies novas (FOR ALL: USING também é usado como WITH CHECK)
-- ─────────────────────────────────────────────────────────────────────────────

-- usuarios:
--   super-admin → tudo
--   o próprio usuário → o próprio registro
--   admin comum    → usuários da própria empresa
CREATE POLICY usuarios_tenant_access ON usuarios
  FOR ALL
  USING (
    rls_is_super_admin()
    OR id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id IS NOT NULL AND empresa_id = rls_empresa_id())
  );

-- motoristas (motoristas.id = usuarios.id; empresa_id NOT NULL):
--   super-admin → tudo
--   o próprio motorista → o próprio registro
--   admin comum         → motoristas da própria empresa
CREATE POLICY motoristas_tenant_access ON motoristas
  FOR ALL
  USING (
    rls_is_super_admin()
    OR id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
  );

-- empresas:
--   super-admin → tudo
--   usuário comum → apenas a empresa vinculada ao seu usuarios.empresa_id
CREATE POLICY empresas_tenant_access ON empresas
  FOR ALL
  USING (
    rls_is_super_admin()
    OR id = rls_empresa_id()
  );

-- fretes / despesas / abastecimentos / vales (motorista_id + empresa_id NOT NULL):
--   super-admin → tudo
--   motorista   → registros com motorista_id = auth.uid()
--   admin comum → registros da própria empresa
CREATE POLICY fretes_tenant_access ON fretes
  FOR ALL
  USING (
    rls_is_super_admin()
    OR motorista_id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
  );

CREATE POLICY despesas_tenant_access ON despesas
  FOR ALL
  USING (
    rls_is_super_admin()
    OR motorista_id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
  );

CREATE POLICY abastecimentos_tenant_access ON abastecimentos
  FOR ALL
  USING (
    rls_is_super_admin()
    OR motorista_id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
  );

CREATE POLICY vales_tenant_access ON vales
  FOR ALL
  USING (
    rls_is_super_admin()
    OR motorista_id = auth.uid()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
  );

-- planos (catálogo):
--   leitura liberada para usuários AUTENTICADOS (não para anon/public);
--   escrita apenas super-admin.
CREATE POLICY planos_read ON planos
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY planos_admin_write ON planos
  FOR ALL
  USING (rls_is_super_admin())
  WITH CHECK (rls_is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA — tabelas NÃO tocadas de propósito:
--   * faturas: já tem RLS ativo. A policy `faturas_isolation` legada usa
--     tipo='admin' (semântica antiga) e deveria migrar para is_super_admin
--     (billing é plataforma). Fica como FOLLOW-UP fora do escopo deste PR.
--   * configuracoes / termos / termos_aceites: RLS já ativo (migration 014 etc.).
--   * documentos: RLS ativo, schema sem uso real — não priorizado.
-- ─────────────────────────────────────────────────────────────────────────────

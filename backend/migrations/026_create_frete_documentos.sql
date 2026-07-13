-- Migration 026: documentos fiscais de frete (CTe, MDF-e, NF-e e outros).
-- Rodar no Supabase SQL Editor (NAO aplicar automaticamente em producao aqui).
--
-- Escopo:
--   * cada linha = 1 arquivo anexado a um frete (PDF, XML ou imagem);
--   * arquivo vive no BUCKET PRIVADO `fretes-documentos` (nunca no publico
--     `comprovantes`); guardamos so o PATH, nunca URL publica;
--   * isolamento por empresa/frete; exibicao via signed URL (backend);
--   * aditiva, reversivel, idempotente (pode rodar mais de uma vez).
--
-- Backend acessa via service_role (BYPASSRLS): a API funciona independente das
-- policies. As policies abaixo protegem acesso direto com JWT (auth.uid()), no
-- mesmo espirito das migrations 015/020. Reusa os helpers da 015
-- (rls_is_super_admin / rls_is_company_admin / rls_empresa_id).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS frete_documentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id       UUID NOT NULL REFERENCES fretes(id)   ON DELETE CASCADE,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('cte','mdfe','nfe','outro')),
  storage_path   TEXT NOT NULL,
  nome_arquivo   TEXT NULL,
  mime           TEXT NULL,
  tamanho_bytes  INTEGER NULL,
  criado_por     UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listagem por frete (uso principal do app/painel).
CREATE INDEX IF NOT EXISTS frete_documentos_frete_idx   ON frete_documentos (frete_id);
-- Consultas/filtragem administrativa por empresa.
CREATE INDEX IF NOT EXISTS frete_documentos_empresa_idx ON frete_documentos (empresa_id);
-- Um mesmo objeto no bucket nao deve duplicar linha.
CREATE UNIQUE INDEX IF NOT EXISTS frete_documentos_path_key ON frete_documentos (storage_path);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: super-admin ve tudo; admin ve documentos da sua empresa; motorista ve os
-- dos proprios fretes. service_role bypassa (backend). Helpers vem da 015.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE frete_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_documentos_tenant_access ON frete_documentos;
CREATE POLICY frete_documentos_tenant_access ON frete_documentos
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f
               WHERE f.id = frete_documentos.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f
               WHERE f.id = frete_documentos.frete_id AND f.motorista_id = auth.uid())
  );

-- ── Rollback (referencia; nao executar junto) ───────────────────────────────
-- DROP TABLE IF EXISTS frete_documentos;
-- (o bucket `fretes-documentos` e seus objetos sao removidos manualmente no
--  Supabase Storage, se desejado — SQL nao toca storage.)

-- Migration 049: ocorrencias logisticas por frete.
-- Rodar no Supabase SQL Editor (NAO aplicar automaticamente em producao aqui).
--
-- Escopo:
--   * `frete_ocorrencias`: N ocorrencias por frete (atraso, avaria, recusa,
--     reentrega, extravio, divergencia, outro). Ciclo: aberta -> em_analise ->
--     resolvida. Campo `impacto` (texto curto) descreve o efeito na entrega.
--   * `frete_ocorrencia_evidencias`: N arquivos (foto/PDF) por ocorrencia, no
--     BUCKET PRIVADO `fretes-evidencias` (o mesmo da migration 048; guardamos so
--     o PATH; exibicao via signed URL no backend).
--   * aditiva, reversivel, idempotente (pode rodar mais de uma vez).
--
-- Backend acessa via service_role (BYPASSRLS). As policies protegem acesso direto
-- com JWT (auth.uid()). Reusa os helpers da 015 (rls_is_super_admin /
-- rls_is_company_admin / rls_empresa_id).
--
-- Depende do bucket PRIVADO `fretes-evidencias` (criado no passo manual da 048).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Ocorrencia (N por frete)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frete_ocorrencias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id      UUID NOT NULL REFERENCES fretes(id)   ON DELETE CASCADE,
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN
                  ('atraso','avaria','recusa','reentrega','extravio','divergencia','outro')),
  descricao     TEXT NOT NULL,
  ocorrido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'aberta'
                  CHECK (status IN ('aberta','em_analise','resolvida')),
  impacto       TEXT NULL,
  resolucao     TEXT NULL,
  resolvida_em  TIMESTAMPTZ NULL,
  resolvida_por UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por    UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_ocorrencias_frete_idx   ON frete_ocorrencias (frete_id);
CREATE INDEX IF NOT EXISTS frete_ocorrencias_empresa_idx ON frete_ocorrencias (empresa_id);
CREATE INDEX IF NOT EXISTS frete_ocorrencias_status_idx  ON frete_ocorrencias (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Evidencias da ocorrencia (N por ocorrencia)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frete_ocorrencia_evidencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocorrencia_id  UUID NOT NULL REFERENCES frete_ocorrencias(id) ON DELETE CASCADE,
  frete_id       UUID NOT NULL REFERENCES fretes(id)            ON DELETE CASCADE,
  empresa_id     UUID NOT NULL REFERENCES empresas(id)          ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  nome_arquivo   TEXT NULL,
  mime           TEXT NULL,
  tamanho_bytes  INTEGER NULL,
  criado_por     UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_ocor_evid_ocorrencia_idx ON frete_ocorrencia_evidencias (ocorrencia_id);
CREATE INDEX IF NOT EXISTS frete_ocor_evid_empresa_idx    ON frete_ocorrencia_evidencias (empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS frete_ocor_evid_path_key ON frete_ocorrencia_evidencias (storage_path);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: super-admin ve tudo; admin ve a sua empresa; motorista ve os proprios
-- fretes. service_role bypassa (backend). Helpers vem da 015.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE frete_ocorrencias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE frete_ocorrencia_evidencias  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_ocorrencias_tenant_access ON frete_ocorrencias;
CREATE POLICY frete_ocorrencias_tenant_access ON frete_ocorrencias
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_ocorrencias.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_ocorrencias.frete_id AND f.motorista_id = auth.uid())
  );

DROP POLICY IF EXISTS frete_ocor_evid_tenant_access ON frete_ocorrencia_evidencias;
CREATE POLICY frete_ocor_evid_tenant_access ON frete_ocorrencia_evidencias
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_ocorrencia_evidencias.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_ocorrencia_evidencias.frete_id AND f.motorista_id = auth.uid())
  );

-- ── Rollback (referencia; nao executar junto) ───────────────────────────────
-- DROP TABLE IF EXISTS frete_ocorrencia_evidencias;
-- DROP TABLE IF EXISTS frete_ocorrencias;

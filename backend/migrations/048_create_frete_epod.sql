-- Migration 048: ePOD (comprovacao de entrega digital) por frete.
-- Rodar no Supabase SQL Editor (NAO aplicar automaticamente em producao aqui).
--
-- Escopo:
--   * `frete_epod`: 1 comprovacao por frete (UNIQUE frete_id) — a "prova de
--     entrega" com data/hora, quem recebeu, observacao, GPS opcional e caminho
--     opcional de assinatura. Ciclo: registrado -> validado | rejeitado.
--   * `frete_epod_evidencias`: N arquivos (foto/canhoto/PDF) por comprovacao,
--     no BUCKET PRIVADO `fretes-evidencias` (guardamos so o PATH; exibicao via
--     signed URL no backend). NUNCA usa o bucket publico `comprovantes`.
--   * GPS (latitude/longitude) e assinatura_path sao NULLABLE de proposito: o
--     app do motorista preenche depois (proxima frente), sem novo ALTER.
--   * aditiva, reversivel, idempotente (pode rodar mais de uma vez).
--
-- Backend acessa via service_role (BYPASSRLS): a API funciona independente das
-- policies. As policies abaixo protegem acesso direto com JWT (auth.uid()), no
-- mesmo espirito das migrations 015/020/026. Reusa os helpers da 015
-- (rls_is_super_admin / rls_is_company_admin / rls_empresa_id).
--
-- IMPORTANTE (passo manual FORA do SQL): criar no Supabase Storage o bucket
-- PRIVADO `fretes-evidencias` (usado por ePOD e por ocorrencias/migration 049).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Comprovacao (1 por frete)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frete_epod (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id        UUID NOT NULL UNIQUE REFERENCES fretes(id)   ON DELETE CASCADE,
  empresa_id      UUID NOT NULL        REFERENCES empresas(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'registrado'
                    CHECK (status IN ('registrado','validado','rejeitado')),
  comprovado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  recebido_por    TEXT NULL,
  observacao      TEXT NULL,
  latitude        NUMERIC(10,7) NULL CHECK (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90)),
  longitude       NUMERIC(10,7) NULL CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  assinatura_path TEXT NULL,
  criado_por      UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_por    UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em     TIMESTAMPTZ NULL,
  motivo_rejeicao TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_epod_empresa_idx ON frete_epod (empresa_id);
CREATE INDEX IF NOT EXISTS frete_epod_status_idx  ON frete_epod (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Evidencias da comprovacao (N por ePOD)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frete_epod_evidencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epod_id        UUID NOT NULL REFERENCES frete_epod(id) ON DELETE CASCADE,
  frete_id       UUID NOT NULL REFERENCES fretes(id)     ON DELETE CASCADE,
  empresa_id     UUID NOT NULL REFERENCES empresas(id)   ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  nome_arquivo   TEXT NULL,
  mime           TEXT NULL,
  tamanho_bytes  INTEGER NULL,
  criado_por     UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_epod_evid_epod_idx    ON frete_epod_evidencias (epod_id);
CREATE INDEX IF NOT EXISTS frete_epod_evid_empresa_idx ON frete_epod_evidencias (empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS frete_epod_evid_path_key ON frete_epod_evidencias (storage_path);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: super-admin ve tudo; admin ve a sua empresa; motorista ve os proprios
-- fretes. service_role bypassa (backend). Helpers vem da 015.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE frete_epod            ENABLE ROW LEVEL SECURITY;
ALTER TABLE frete_epod_evidencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_epod_tenant_access ON frete_epod;
CREATE POLICY frete_epod_tenant_access ON frete_epod
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_epod.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_epod.frete_id AND f.motorista_id = auth.uid())
  );

DROP POLICY IF EXISTS frete_epod_evid_tenant_access ON frete_epod_evidencias;
CREATE POLICY frete_epod_evid_tenant_access ON frete_epod_evidencias
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_epod_evidencias.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f WHERE f.id = frete_epod_evidencias.frete_id AND f.motorista_id = auth.uid())
  );

-- ── Rollback (referencia; nao executar junto) ───────────────────────────────
-- DROP TABLE IF EXISTS frete_epod_evidencias;
-- DROP TABLE IF EXISTS frete_epod;
-- (o bucket `fretes-evidencias` e seus objetos sao removidos manualmente no
--  Supabase Storage, se desejado — SQL nao toca storage.)

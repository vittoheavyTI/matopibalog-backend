-- Migration 073: E1.4A documents foundation/security/web.
-- NAO aplicar automaticamente em producao. Exige OWNER_MIGRATION_GATE_E14A.
--
-- Escopo:
--   * contrato v2 para documentos "outro" com nome/descricao;
--   * idempotencia de upload via client_request_id;
--   * cancelamento logico e auditoria minima;
--   * fundacao para multiplos recebedores/signatarios operacionais.
--
-- Aditiva e idempotente. Nao toca o bucket publico legado `comprovantes`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE frete_documentos
  ADD COLUMN IF NOT EXISTS document_contract_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nome_documento TEXT NULL,
  ADD COLUMN IF NOT EXISTS descricao TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelado_por UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelamento_motivo TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE frete_documentos
  DROP CONSTRAINT IF EXISTS frete_documentos_status_check;
ALTER TABLE frete_documentos
  ADD CONSTRAINT frete_documentos_status_check
  CHECK (status IN ('ativo','cancelado'));

ALTER TABLE frete_documentos
  DROP CONSTRAINT IF EXISTS frete_documentos_contract_version_check;
ALTER TABLE frete_documentos
  ADD CONSTRAINT frete_documentos_contract_version_check
  CHECK (document_contract_version IN (1,2));

CREATE UNIQUE INDEX IF NOT EXISTS frete_documentos_client_request_key
  ON frete_documentos (frete_id, criado_por, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS frete_documentos_status_idx
  ON frete_documentos (frete_id, status, created_at);

ALTER TABLE frete_epod_evidencias
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS frete_epod_evidencias_client_request_key
  ON frete_epod_evidencias (epod_id, criado_por, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE frete_ocorrencia_evidencias
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS frete_ocorrencia_evidencias_client_request_key
  ON frete_ocorrencia_evidencias (ocorrencia_id, criado_por, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS frete_documento_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES frete_documentos(id) ON DELETE CASCADE,
  frete_id UUID NOT NULL REFERENCES fretes(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  evento TEXT NOT NULL CHECK (evento IN ('uploaded','replaced','cancelled','acknowledged','returned')),
  actor_id UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  actor_role TEXT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_documento_eventos_documento_idx
  ON frete_documento_eventos (documento_id, created_at);
CREATE INDEX IF NOT EXISTS frete_documento_eventos_frete_idx
  ON frete_documento_eventos (frete_id, created_at);

ALTER TABLE frete_documento_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_documento_eventos_tenant_access ON frete_documento_eventos;
CREATE POLICY frete_documento_eventos_tenant_access ON frete_documento_eventos
  FOR SELECT
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f
               WHERE f.id = frete_documento_eventos.frete_id AND f.motorista_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS frete_documento_participantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES frete_documentos(id) ON DELETE CASCADE,
  frete_id UUID NOT NULL REFERENCES fretes(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('recebedor','signatario')),
  nome TEXT NOT NULL,
  documento TEXT NULL,
  email TEXT NULL,
  telefone TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','dispensado','cancelado')),
  ordem INTEGER NULL,
  criado_por UUID NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frete_documento_participantes_documento_idx
  ON frete_documento_participantes (documento_id, tipo, status);

ALTER TABLE frete_documento_participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_documento_participantes_tenant_access ON frete_documento_participantes;
CREATE POLICY frete_documento_participantes_tenant_access ON frete_documento_participantes
  FOR ALL
  USING (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f
               WHERE f.id = frete_documento_participantes.frete_id AND f.motorista_id = auth.uid())
  )
  WITH CHECK (
    rls_is_super_admin()
    OR (rls_is_company_admin() AND empresa_id = rls_empresa_id())
    OR EXISTS (SELECT 1 FROM fretes f
               WHERE f.id = frete_documento_participantes.frete_id AND f.motorista_id = auth.uid())
  );

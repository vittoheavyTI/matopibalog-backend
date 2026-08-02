-- Assinatura eletronica interna com codigo de confirmacao.
-- Aditiva/idempotente. Nao cria cobranca, nao chama Asaas e nao altera dados
-- comerciais existentes. A aplicacao remota exige autorizacao explicita.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_status_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      DROP CONSTRAINT contratos_comerciais_status_check;
  END IF;

  ALTER TABLE public.contratos_comerciais
    ADD CONSTRAINT contratos_comerciais_status_check
    CHECK (status IN (
      'rascunho',
      'aguardando_assinatura',
      'pronto_assinatura',
      'aguardando_assinatura_cliente',
      'aguardando_assinatura_matopiba',
      'plenamente_assinado',
      'assinado',
      'aceito_manualmente',
      'recusado',
      'expirado',
      'substituido',
      'cancelado'
    ));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_provider_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      DROP CONSTRAINT contratos_comerciais_provider_check;
  END IF;

  ALTER TABLE public.contratos_comerciais
    ADD CONSTRAINT contratos_comerciais_provider_check
    CHECK (provider IN ('manual','mock','clicksign','interno_otp','autentique','zapsign'));
END $$;

ALTER TABLE public.contratos_comerciais
  ADD COLUMN IF NOT EXISTS signature_method text NULL,
  ADD COLUMN IF NOT EXISTS signature_method_version text NULL,
  ADD COLUMN IF NOT EXISTS document_file_hash text NULL,
  ADD COLUMN IF NOT EXISTS document_size_bytes integer NULL,
  ADD COLUMN IF NOT EXISTS document_fechado_em timestamptz NULL,
  ADD COLUMN IF NOT EXISTS certificate_storage_path text NULL,
  ADD COLUMN IF NOT EXISTS certificate_file_hash text NULL,
  ADD COLUMN IF NOT EXISTS verification_token_hash text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_signature_method_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      ADD CONSTRAINT contratos_comerciais_signature_method_check
      CHECK (signature_method IS NULL OR signature_method IN ('manual','interno_otp','clicksign','autentique','zapsign','mock'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_document_file_hash_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      ADD CONSTRAINT contratos_comerciais_document_file_hash_check
      CHECK (document_file_hash IS NULL OR document_file_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_certificate_file_hash_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      ADD CONSTRAINT contratos_comerciais_certificate_file_hash_check
      CHECK (certificate_file_hash IS NULL OR certificate_file_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contratos_comerciais_verification_token_hash_check'
      AND conrelid = 'public.contratos_comerciais'::regclass
  ) THEN
    ALTER TABLE public.contratos_comerciais
      ADD CONSTRAINT contratos_comerciais_verification_token_hash_check
      CHECK (verification_token_hash IS NULL OR verification_token_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contratos_comerciais_verification_token_hash
  ON public.contratos_comerciais (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

ALTER TABLE public.contrato_signatarios
  ADD COLUMN IF NOT EXISTS usuario_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_mascarado text NULL,
  ADD COLUMN IF NOT EXISTS metodo_assinatura text NULL,
  ADD COLUMN IF NOT EXISTS assinatura_hash text NULL,
  ADD COLUMN IF NOT EXISTS document_hash_assinado text NULL,
  ADD COLUMN IF NOT EXISTS consent_text_version text NULL,
  ADD COLUMN IF NOT EXISTS consent_text text NULL,
  ADD COLUMN IF NOT EXISTS ip_hash text NULL,
  ADD COLUMN IF NOT EXISTS user_agent_hash text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_signatarios_metodo_assinatura_check'
      AND conrelid = 'public.contrato_signatarios'::regclass
  ) THEN
    ALTER TABLE public.contrato_signatarios
      ADD CONSTRAINT contrato_signatarios_metodo_assinatura_check
      CHECK (metodo_assinatura IS NULL OR metodo_assinatura IN ('manual','interno_otp','clicksign','autentique','zapsign','mock'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_signatarios_assinatura_hash_check'
      AND conrelid = 'public.contrato_signatarios'::regclass
  ) THEN
    ALTER TABLE public.contrato_signatarios
      ADD CONSTRAINT contrato_signatarios_assinatura_hash_check
      CHECK (assinatura_hash IS NULL OR assinatura_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_signatarios_document_hash_assinado_check'
      AND conrelid = 'public.contrato_signatarios'::regclass
  ) THEN
    ALTER TABLE public.contrato_signatarios
      ADD CONSTRAINT contrato_signatarios_document_hash_assinado_check
      CHECK (document_hash_assinado IS NULL OR document_hash_assinado ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_signatarios_ip_hash_check'
      AND conrelid = 'public.contrato_signatarios'::regclass
  ) THEN
    ALTER TABLE public.contrato_signatarios
      ADD CONSTRAINT contrato_signatarios_ip_hash_check
      CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_signatarios_user_agent_hash_check'
      AND conrelid = 'public.contrato_signatarios'::regclass
  ) THEN
    ALTER TABLE public.contrato_signatarios
      ADD CONSTRAINT contrato_signatarios_user_agent_hash_check
      CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_signatarios_parte_principal
  ON public.contrato_signatarios (contrato_id, papel)
  WHERE papel IN ('cliente','matopiba');

CREATE TABLE IF NOT EXISTS public.contrato_assinatura_desafios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos_comerciais(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  signatario_id uuid NOT NULL REFERENCES public.contrato_signatarios(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  papel text NOT NULL CHECK (papel IN ('cliente','matopiba')),
  finalidade text NOT NULL DEFAULT 'assinatura_contrato' CHECK (finalidade IN ('assinatura_contrato')),
  document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  codigo_hmac text NOT NULL CHECK (codigo_hmac ~ '^[0-9a-f]{64}$'),
  codigo_alg text NOT NULL DEFAULT 'hmac-sha256-v1' CHECK (codigo_alg IN ('hmac-sha256-v1')),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','confirmado','expirado','bloqueado','cancelado')),
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  email_mascarado text NOT NULL,
  ip_hash text NULL,
  user_agent_hash text NULL,
  sent_at timestamptz NULL,
  confirmed_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS idx_contrato_assinatura_desafios_contrato
  ON public.contrato_assinatura_desafios (contrato_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contrato_assinatura_desafios_signatario_ativo
  ON public.contrato_assinatura_desafios (signatario_id, created_at DESC)
  WHERE status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_assinatura_desafios_um_ativo
  ON public.contrato_assinatura_desafios (signatario_id, finalidade)
  WHERE status = 'ativo';

ALTER TABLE public.contrato_eventos
  ADD COLUMN IF NOT EXISTS prev_hash text NULL,
  ADD COLUMN IF NOT EXISTS event_hash text NULL,
  ADD COLUMN IF NOT EXISTS actor_papel text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_eventos_prev_hash_check'
      AND conrelid = 'public.contrato_eventos'::regclass
  ) THEN
    ALTER TABLE public.contrato_eventos
      ADD CONSTRAINT contrato_eventos_prev_hash_check
      CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contrato_eventos_event_hash_check'
      AND conrelid = 'public.contrato_eventos'::regclass
  ) THEN
    ALTER TABLE public.contrato_eventos
      ADD CONSTRAINT contrato_eventos_event_hash_check
      CHECK (event_hash IS NULL OR event_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_eventos_idempotency_key
  ON public.contrato_eventos (contrato_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_eventos_event_hash
  ON public.contrato_eventos (contrato_id, event_hash)
  WHERE event_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_eventos_chain_prev
  ON public.contrato_eventos (contrato_id, (COALESCE(prev_hash, 'ROOT')))
  WHERE event_hash IS NOT NULL;

ALTER TABLE public.contrato_assinatura_desafios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contrato_assinatura_desafios_select_tenant ON public.contrato_assinatura_desafios;
CREATE POLICY contrato_assinatura_desafios_select_tenant ON public.contrato_assinatura_desafios
  FOR SELECT
  TO authenticated
  USING (
    public.rls_is_super_admin()
    OR (empresa_id IS NOT NULL AND public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

COMMENT ON TABLE public.contrato_assinatura_desafios IS
  'Desafios OTP da assinatura eletronica interna. Modelo backend-only: authenticated nao possui GRANT direto; a policy SELECT e defesa futura tenant-safe.';

COMMENT ON COLUMN public.contrato_assinatura_desafios.expires_at IS
  'Retencao operacional curta do codigo; contrato, signatarios e eventos possuem retencao probatoria separada.';

REVOKE ALL ON TABLE public.contrato_assinatura_desafios FROM PUBLIC;
REVOKE ALL ON TABLE public.contrato_assinatura_desafios FROM anon;
REVOKE ALL ON TABLE public.contrato_assinatura_desafios FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.propostas_comerciais TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.propostas_comerciais FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contratos_comerciais TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contratos_comerciais FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contrato_signatarios TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contrato_signatarios FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contrato_eventos FROM service_role;
GRANT SELECT, INSERT ON TABLE public.contrato_eventos TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contrato_assinatura_desafios TO service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contrato_assinatura_desafios FROM service_role;

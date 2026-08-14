-- 067_grupos_filiais_escopos_operacionais.sql
-- Macrofrente P1: grupos empresariais, unidades operacionais e escopos.
--
-- ADITIVA e compativel:
-- - empresas continua sendo a entidade legal/tenant principal.
-- - registros legados sem unidade_operacional_id continuam validos.
-- - nao ha backfill destrutivo nem alteracao de valores financeiros/tracking.
-- - billing/Asaas permanecem OFF: esta migration nao toca billing flags nem chaves.

CREATE TABLE IF NOT EXISTS public.grupos_empresariais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grupo_empresarial_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_empresariais(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupo_empresas_unique UNIQUE (grupo_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS public.unidades_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NULL REFERENCES public.grupos_empresariais(id) ON DELETE SET NULL,
  nome text NOT NULL,
  codigo text NULL,
  tipo text NOT NULL DEFAULT 'operacional' CHECK (tipo IN ('matriz','filial','base','operacional','outro')),
  documento text NULL,
  cidade text NULL,
  uf text NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_unidades_operacionais_default
  ON public.unidades_operacionais (empresa_id)
  WHERE is_default = true AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_unidades_operacionais_codigo
  ON public.unidades_operacionais (empresa_id, lower(codigo))
  WHERE codigo IS NOT NULL AND status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_unidades_operacionais_empresa
  ON public.unidades_operacionais (empresa_id, status, nome);

CREATE INDEX IF NOT EXISTS idx_unidades_operacionais_grupo
  ON public.unidades_operacionais (grupo_id, status);

CREATE TABLE IF NOT EXISTS public.regioes_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NULL REFERENCES public.grupos_empresariais(id) ON DELETE SET NULL,
  nome text NOT NULL,
  codigo text NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_regioes_operacionais_codigo
  ON public.regioes_operacionais (empresa_id, lower(codigo))
  WHERE codigo IS NOT NULL AND status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_regioes_operacionais_empresa
  ON public.regioes_operacionais (empresa_id, status, nome);

CREATE TABLE IF NOT EXISTS public.regiao_operacional_unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  regiao_id uuid NOT NULL REFERENCES public.regioes_operacionais(id) ON DELETE CASCADE,
  unidade_operacional_id uuid NOT NULL REFERENCES public.unidades_operacionais(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regiao_unidade_unique UNIQUE (regiao_id, unidade_operacional_id)
);

CREATE INDEX IF NOT EXISTS idx_regiao_unidades_empresa
  ON public.regiao_operacional_unidades (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_regiao_unidades_unidade
  ON public.regiao_operacional_unidades (unidade_operacional_id, status);

CREATE TABLE IF NOT EXISTS public.usuario_operacional_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NULL REFERENCES public.grupos_empresariais(id) ON DELETE SET NULL,
  unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE CASCADE,
  regiao_operacional_id uuid NULL REFERENCES public.regioes_operacionais(id) ON DELETE CASCADE,
  scope_level text NOT NULL CHECK (scope_level IN ('LOCAL','REGIONAL','GLOBAL')),
  papel text NOT NULL DEFAULT 'operador' CHECK (papel IN ('operador','gestor','admin')),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','revogado','arquivado')),
  is_primary boolean NOT NULL DEFAULT false,
  motivo text NULL,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_shape_chk CHECK (
    (scope_level = 'LOCAL' AND unidade_operacional_id IS NOT NULL AND regiao_operacional_id IS NULL)
    OR (scope_level = 'REGIONAL' AND unidade_operacional_id IS NULL AND regiao_operacional_id IS NOT NULL)
    OR (scope_level = 'GLOBAL' AND unidade_operacional_id IS NULL AND regiao_operacional_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_local_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id, unidade_operacional_id)
  WHERE scope_level = 'LOCAL' AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_regional_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id, regiao_operacional_id)
  WHERE scope_level = 'REGIONAL' AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_global_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id)
  WHERE scope_level = 'GLOBAL' AND status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_memberships_usuario
  ON public.usuario_operacional_memberships (usuario_id, status, empresa_id);

CREATE INDEX IF NOT EXISTS idx_memberships_empresa
  ON public.usuario_operacional_memberships (empresa_id, status, scope_level);

CREATE TABLE IF NOT EXISTS public.operational_scope_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE SET NULL,
  grupo_id uuid NULL REFERENCES public.grupos_empresariais(id) ON DELETE SET NULL,
  unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL,
  membership_id uuid NULL REFERENCES public.usuario_operacional_memberships(id) ON DELETE SET NULL,
  actor_user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'grupo_criado','grupo_alterado',
    'grupo_empresa_vinculada','grupo_empresa_alterada',
    'unidade_criada','unidade_alterada','unidade_default_alterada',
    'regiao_criada','regiao_alterada','regiao_unidade_alterada',
    'membership_criado','membership_alterado','membership_revogado'
  )),
  before_snapshot jsonb NULL,
  after_snapshot jsonb NULL,
  reason text NULL,
  request_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_scope_aud_empresa
  ON public.operational_scope_auditoria (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_scope_aud_actor
  ON public.operational_scope_auditoria (actor_user_id, created_at DESC);

ALTER TABLE IF EXISTS public.motoristas
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.fretes
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.despesas
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.abastecimentos
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.vales
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_documentos
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_epod
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_epod_evidencias
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_ocorrencias
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_ocorrencia_evidencias
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_localizacoes
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_ultima_localizacao
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_localizacao_estado
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.frete_localizacao_retencao
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL REFERENCES public.unidades_operacionais(id) ON DELETE SET NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'motoristas','fretes','despesas','abastecimentos','vales',
    'frete_documentos','frete_epod','frete_epod_evidencias',
    'frete_ocorrencias','frete_ocorrencia_evidencias',
    'frete_localizacoes','frete_ultima_localizacao',
    'frete_localizacao_estado','frete_localizacao_retencao'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (empresa_id, unidade_operacional_id)',
        'idx_' || t || '_empresa_unidade',
        t
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.grupos_empresariais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupo_empresarial_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regioes_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regiao_operacional_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_operacional_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_scope_auditoria ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.grupos_empresariais FORCE ROW LEVEL SECURITY;
ALTER TABLE public.grupo_empresarial_empresas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_operacionais FORCE ROW LEVEL SECURITY;
ALTER TABLE public.regioes_operacionais FORCE ROW LEVEL SECURITY;
ALTER TABLE public.regiao_operacional_unidades FORCE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_operacional_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.operational_scope_auditoria FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.grupos_empresariais,
  public.grupo_empresarial_empresas,
  public.unidades_operacionais,
  public.regioes_operacionais,
  public.regiao_operacional_unidades,
  public.usuario_operacional_memberships,
  public.operational_scope_auditoria
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.grupos_empresariais,
  public.grupo_empresarial_empresas,
  public.unidades_operacionais,
  public.regioes_operacionais,
  public.regiao_operacional_unidades,
  public.usuario_operacional_memberships,
  public.operational_scope_auditoria
TO service_role;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.grupos_empresariais,
  public.grupo_empresarial_empresas,
  public.unidades_operacionais,
  public.regioes_operacionais,
  public.regiao_operacional_unidades,
  public.usuario_operacional_memberships,
  public.operational_scope_auditoria
FROM service_role;

COMMENT ON TABLE public.grupos_empresariais IS
  'P1: agrupador corporativo. Nao concede acesso por si so; acesso depende de memberships.';
COMMENT ON TABLE public.unidades_operacionais IS
  'P1: unidade operacional/filial explicita. empresas continua sendo entidade legal/tenant.';
COMMENT ON TABLE public.usuario_operacional_memberships IS
  'P1: autoridade de escopo operacional por usuario. LOCAL=unidade, REGIONAL=regiao, GLOBAL=empresa/grupo autorizado.';

-- ============================================================================
-- ROLLBACK documentado (nao executar sem gate):
--   ALTER TABLE public.fretes DROP COLUMN IF EXISTS unidade_operacional_id;
--   DROP TABLE IF EXISTS public.operational_scope_auditoria;
--   DROP TABLE IF EXISTS public.usuario_operacional_memberships;
--   DROP TABLE IF EXISTS public.regiao_operacional_unidades;
--   DROP TABLE IF EXISTS public.regioes_operacionais;
--   DROP TABLE IF EXISTS public.unidades_operacionais;
--   DROP TABLE IF EXISTS public.grupo_empresarial_empresas;
--   DROP TABLE IF EXISTS public.grupos_empresariais;
-- ============================================================================

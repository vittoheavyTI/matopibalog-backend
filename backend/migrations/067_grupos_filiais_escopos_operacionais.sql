-- 067_grupos_filiais_escopos_operacionais.sql
-- Macrofrente P1: grupos empresariais, unidades operacionais e escopos.
--
-- ADITIVA e compativel:
-- - empresas continua sendo a entidade legal/tenant principal.
-- - operational_scope_mode controla rollout: legacy -> configured -> enforced.
-- - registros legados sem unidade_operacional_id em fretes continuam validos.
-- - objetos filhos de frete derivam unidade pelo frete; nao duplicamos unidade em
--   despesas/abastecimentos/vales/ePOD/ocorrencias/tracking nesta P1.
-- - billing/Asaas permanecem OFF: esta migration nao toca billing flags nem chaves.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS operational_scope_mode text NOT NULL DEFAULT 'legacy'
  CHECK (operational_scope_mode IN ('legacy','configured','enforced'));

CREATE INDEX IF NOT EXISTS idx_empresas_operational_scope_mode
  ON public.empresas (operational_scope_mode);

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

CREATE UNIQUE INDEX IF NOT EXISTS ux_grupo_empresas_empresa_active
  ON public.grupo_empresarial_empresas (empresa_id)
  WHERE status = 'ativo';

CREATE TABLE IF NOT EXISTS public.unidades_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NULL,
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidades_id_empresa_unique UNIQUE (id, empresa_id),
  CONSTRAINT unidade_grupo_empresa_fk
    FOREIGN KEY (grupo_id, empresa_id)
    REFERENCES public.grupo_empresarial_empresas (grupo_id, empresa_id)
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
  grupo_id uuid NULL,
  nome text NOT NULL,
  codigo text NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regioes_id_empresa_unique UNIQUE (id, empresa_id),
  CONSTRAINT regiao_grupo_empresa_fk
    FOREIGN KEY (grupo_id, empresa_id)
    REFERENCES public.grupo_empresarial_empresas (grupo_id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_regioes_operacionais_codigo
  ON public.regioes_operacionais (empresa_id, lower(codigo))
  WHERE codigo IS NOT NULL AND status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_regioes_operacionais_empresa
  ON public.regioes_operacionais (empresa_id, status, nome);

CREATE TABLE IF NOT EXISTS public.regiao_operacional_unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  regiao_id uuid NOT NULL,
  unidade_operacional_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regiao_unidade_unique UNIQUE (regiao_id, unidade_operacional_id),
  CONSTRAINT regiao_unidade_regiao_empresa_fk
    FOREIGN KEY (regiao_id, empresa_id)
    REFERENCES public.regioes_operacionais (id, empresa_id)
    ON DELETE CASCADE,
  CONSTRAINT regiao_unidade_unidade_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_regiao_unidades_empresa
  ON public.regiao_operacional_unidades (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_regiao_unidades_unidade
  ON public.regiao_operacional_unidades (unidade_operacional_id, status);

CREATE TABLE IF NOT EXISTS public.usuario_operacional_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  grupo_id uuid NULL REFERENCES public.grupos_empresariais(id) ON DELETE CASCADE,
  unidade_operacional_id uuid NULL,
  regiao_operacional_id uuid NULL,
  scope_level text NOT NULL CHECK (scope_level IN ('LOCAL','REGIONAL','GLOBAL')),
  papel text NOT NULL DEFAULT 'operador' CHECK (papel IN ('operador','gestor','admin')),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','revogado','arquivado')),
  is_primary boolean NOT NULL DEFAULT false,
  motivo text NULL,
  created_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_empresa_ou_grupo_chk CHECK (
    (empresa_id IS NOT NULL AND grupo_id IS NULL)
    OR (empresa_id IS NULL AND grupo_id IS NOT NULL AND scope_level = 'GLOBAL')
  ),
  CONSTRAINT membership_shape_chk CHECK (
    (scope_level = 'LOCAL' AND empresa_id IS NOT NULL AND unidade_operacional_id IS NOT NULL AND regiao_operacional_id IS NULL)
    OR (scope_level = 'REGIONAL' AND empresa_id IS NOT NULL AND unidade_operacional_id IS NULL AND regiao_operacional_id IS NOT NULL)
    OR (scope_level = 'GLOBAL' AND unidade_operacional_id IS NULL AND regiao_operacional_id IS NULL)
  ),
  CONSTRAINT membership_unidade_empresa_fk
    FOREIGN KEY (unidade_operacional_id, empresa_id)
    REFERENCES public.unidades_operacionais (id, empresa_id)
    ON DELETE CASCADE,
  CONSTRAINT membership_regiao_empresa_fk
    FOREIGN KEY (regiao_operacional_id, empresa_id)
    REFERENCES public.regioes_operacionais (id, empresa_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_local_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id, unidade_operacional_id)
  WHERE scope_level = 'LOCAL' AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_regional_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id, regiao_operacional_id)
  WHERE scope_level = 'REGIONAL' AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_global_empresa_active
  ON public.usuario_operacional_memberships (usuario_id, empresa_id)
  WHERE scope_level = 'GLOBAL' AND empresa_id IS NOT NULL AND status = 'ativo';

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_global_grupo_active
  ON public.usuario_operacional_memberships (usuario_id, grupo_id)
  WHERE scope_level = 'GLOBAL' AND grupo_id IS NOT NULL AND empresa_id IS NULL AND status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_memberships_usuario
  ON public.usuario_operacional_memberships (usuario_id, status, empresa_id, grupo_id);

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
    'membership_criado','membership_alterado','membership_revogado',
    'operational_scope_configured','operational_scope_enforced'
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
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL;

ALTER TABLE IF EXISTS public.fretes
  ADD COLUMN IF NOT EXISTS unidade_operacional_id uuid NULL;

DO $$
BEGIN
  IF to_regclass('public.motoristas') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'motoristas_unidade_empresa_fk'
  ) THEN
    ALTER TABLE public.motoristas
      ADD CONSTRAINT motoristas_unidade_empresa_fk
      FOREIGN KEY (unidade_operacional_id, empresa_id)
      REFERENCES public.unidades_operacionais (id, empresa_id)
      ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.fretes') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_unidade_empresa_fk'
  ) THEN
    ALTER TABLE public.fretes
      ADD CONSTRAINT fretes_unidade_empresa_fk
      FOREIGN KEY (unidade_operacional_id, empresa_id)
      REFERENCES public.unidades_operacionais (id, empresa_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_motoristas_empresa_unidade
  ON public.motoristas (empresa_id, unidade_operacional_id);

CREATE INDEX IF NOT EXISTS idx_fretes_empresa_unidade
  ON public.fretes (empresa_id, unidade_operacional_id);

CREATE OR REPLACE FUNCTION public.p1_audit(
  p_action text,
  p_empresa_id uuid,
  p_grupo_id uuid,
  p_unidade_id uuid,
  p_membership_id uuid,
  p_actor_user_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.operational_scope_auditoria (
    action, empresa_id, grupo_id, unidade_operacional_id, membership_id,
    actor_user_id, before_snapshot, after_snapshot, reason
  ) VALUES (
    p_action, p_empresa_id, p_grupo_id, p_unidade_id, p_membership_id,
    p_actor_user_id, p_before, p_after, p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_criar_grupo(
  p_nome text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.grupos_empresariais
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.grupos_empresariais;
BEGIN
  INSERT INTO public.grupos_empresariais (nome, created_by, updated_by)
  VALUES (trim(p_nome), p_actor_user_id, p_actor_user_id)
  RETURNING * INTO v_row;
  PERFORM public.p1_audit('grupo_criado', NULL, v_row.id, NULL, NULL, p_actor_user_id, NULL, to_jsonb(v_row), p_reason);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_atualizar_grupo(
  p_grupo_id uuid,
  p_nome text,
  p_status text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.grupos_empresariais
LANGUAGE plpgsql
AS $$
DECLARE
  v_before public.grupos_empresariais;
  v_after public.grupos_empresariais;
BEGIN
  SELECT * INTO v_before FROM public.grupos_empresariais WHERE id = p_grupo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grupo_not_found'; END IF;
  UPDATE public.grupos_empresariais
     SET nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
         status = COALESCE(p_status, status),
         updated_by = p_actor_user_id,
         updated_at = now()
   WHERE id = p_grupo_id
  RETURNING * INTO v_after;
  PERFORM public.p1_audit('grupo_alterado', NULL, p_grupo_id, NULL, NULL, p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after), p_reason);
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_vincular_empresa_grupo(
  p_grupo_id uuid,
  p_empresa_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.grupo_empresarial_empresas
LANGUAGE plpgsql
AS $$
DECLARE
  v_before public.grupo_empresarial_empresas;
  v_after public.grupo_empresarial_empresas;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('p1_grupo_empresa'), hashtext(p_empresa_id::text));
  SELECT * INTO v_before
    FROM public.grupo_empresarial_empresas
   WHERE grupo_id = p_grupo_id AND empresa_id = p_empresa_id
   FOR UPDATE;

  INSERT INTO public.grupo_empresarial_empresas (grupo_id, empresa_id, status, created_by, updated_by, updated_at)
  VALUES (p_grupo_id, p_empresa_id, COALESCE(p_status, 'ativo'), p_actor_user_id, p_actor_user_id, now())
  ON CONFLICT (grupo_id, empresa_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  RETURNING * INTO v_after;

  PERFORM public.p1_audit('grupo_empresa_alterada', p_empresa_id, p_grupo_id, NULL, NULL, p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after), p_reason);
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_criar_unidade(
  p_empresa_id uuid,
  p_grupo_id uuid,
  p_nome text,
  p_codigo text,
  p_tipo text,
  p_documento text,
  p_cidade text,
  p_uf text,
  p_timezone text,
  p_is_default boolean,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.unidades_operacionais
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
  v_is_default boolean;
  v_row public.unidades_operacionais;
  v_mode text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('p1_unidade'), hashtext(p_empresa_id::text));
  SELECT operational_scope_mode INTO v_mode FROM public.empresas WHERE id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'empresa_not_found'; END IF;
  IF p_grupo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.grupo_empresarial_empresas
     WHERE grupo_id = p_grupo_id
       AND empresa_id = p_empresa_id
       AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'grupo_empresa_not_active';
  END IF;
  SELECT count(*) INTO v_count FROM public.unidades_operacionais WHERE empresa_id = p_empresa_id AND status = 'ativo';
  v_is_default := (v_count = 0) OR (p_is_default IS TRUE);
  IF v_is_default THEN
    UPDATE public.unidades_operacionais
       SET is_default = false, updated_by = p_actor_user_id, updated_at = now()
     WHERE empresa_id = p_empresa_id AND is_default = true;
  END IF;
  INSERT INTO public.unidades_operacionais (
    empresa_id, grupo_id, nome, codigo, tipo, documento, cidade, uf, timezone,
    is_default, created_by, updated_by
  ) VALUES (
    p_empresa_id, p_grupo_id, trim(p_nome), NULLIF(trim(COALESCE(p_codigo, '')), ''),
    COALESCE(p_tipo, 'operacional'), NULLIF(trim(COALESCE(p_documento, '')), ''),
    NULLIF(trim(COALESCE(p_cidade, '')), ''), NULLIF(trim(COALESCE(p_uf, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_timezone, '')), ''), 'America/Sao_Paulo'),
    v_is_default, p_actor_user_id, p_actor_user_id
  )
  RETURNING * INTO v_row;
  IF v_mode = 'legacy' THEN
    UPDATE public.empresas SET operational_scope_mode = 'configured' WHERE id = p_empresa_id;
  END IF;
  PERFORM public.p1_audit('unidade_criada', p_empresa_id, p_grupo_id, v_row.id, NULL, p_actor_user_id, NULL, to_jsonb(v_row), p_reason);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_atualizar_unidade(
  p_unidade_id uuid,
  p_nome text,
  p_codigo text,
  p_tipo text,
  p_status text,
  p_is_default boolean,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.unidades_operacionais
LANGUAGE plpgsql
AS $$
DECLARE
  v_before public.unidades_operacionais;
  v_after public.unidades_operacionais;
  v_other_default uuid;
BEGIN
  SELECT * INTO v_before FROM public.unidades_operacionais WHERE id = p_unidade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unidade_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('p1_unidade'), hashtext(v_before.empresa_id::text));
  IF p_status = 'arquivado' AND v_before.is_default THEN
    SELECT id INTO v_other_default
      FROM public.unidades_operacionais
     WHERE empresa_id = v_before.empresa_id AND status = 'ativo' AND id <> p_unidade_id
     LIMIT 1;
    IF v_other_default IS NULL THEN RAISE EXCEPTION 'cannot_archive_only_default_unit'; END IF;
    UPDATE public.unidades_operacionais
       SET is_default = true, updated_by = p_actor_user_id, updated_at = now()
     WHERE id = v_other_default;
  END IF;
  IF p_is_default IS TRUE THEN
    UPDATE public.unidades_operacionais
       SET is_default = false, updated_by = p_actor_user_id, updated_at = now()
     WHERE empresa_id = v_before.empresa_id AND id <> p_unidade_id AND is_default = true;
  END IF;
  UPDATE public.unidades_operacionais
     SET nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
         codigo = COALESCE(NULLIF(trim(p_codigo), ''), codigo),
         tipo = COALESCE(p_tipo, tipo),
         status = COALESCE(p_status, status),
         is_default = CASE WHEN p_is_default IS TRUE THEN true WHEN p_status = 'arquivado' THEN false ELSE is_default END,
         updated_by = p_actor_user_id,
         updated_at = now()
   WHERE id = p_unidade_id
  RETURNING * INTO v_after;
  PERFORM public.p1_audit('unidade_alterada', v_after.empresa_id, v_after.grupo_id, v_after.id, NULL, p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after), p_reason);
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_criar_regiao(
  p_empresa_id uuid,
  p_grupo_id uuid,
  p_nome text,
  p_codigo text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.regioes_operacionais
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.regioes_operacionais;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('p1_regiao_empresa'), hashtext(p_empresa_id::text));
  IF p_grupo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.grupo_empresarial_empresas
     WHERE grupo_id = p_grupo_id
       AND empresa_id = p_empresa_id
       AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'grupo_empresa_not_active';
  END IF;
  INSERT INTO public.regioes_operacionais (empresa_id, grupo_id, nome, codigo, created_by, updated_by)
  VALUES (p_empresa_id, p_grupo_id, trim(p_nome), NULLIF(trim(COALESCE(p_codigo, '')), ''), p_actor_user_id, p_actor_user_id)
  RETURNING * INTO v_row;
  PERFORM public.p1_audit('regiao_criada', p_empresa_id, p_grupo_id, NULL, NULL, p_actor_user_id, NULL, to_jsonb(v_row), p_reason);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_atualizar_regiao(
  p_regiao_id uuid,
  p_nome text,
  p_codigo text,
  p_status text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS public.regioes_operacionais
LANGUAGE plpgsql
AS $$
DECLARE
  v_before public.regioes_operacionais;
  v_after public.regioes_operacionais;
BEGIN
  SELECT * INTO v_before FROM public.regioes_operacionais WHERE id = p_regiao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'regiao_not_found'; END IF;
  UPDATE public.regioes_operacionais
     SET nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
         codigo = COALESCE(NULLIF(trim(p_codigo), ''), codigo),
         status = COALESCE(p_status, status),
         updated_by = p_actor_user_id,
         updated_at = now()
   WHERE id = p_regiao_id
  RETURNING * INTO v_after;
  PERFORM public.p1_audit('regiao_alterada', v_after.empresa_id, v_after.grupo_id, NULL, NULL, p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after), p_reason);
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_definir_unidades_regiao(
  p_regiao_id uuid,
  p_unidade_ids uuid[],
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_regiao public.regioes_operacionais;
  v_before jsonb;
  v_after jsonb;
  v_invalid int;
  v_id uuid;
BEGIN
  SELECT * INTO v_regiao FROM public.regioes_operacionais WHERE id = p_regiao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'regiao_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('p1_regiao'), hashtext(p_regiao_id::text));

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_before
    FROM public.regiao_operacional_unidades r
   WHERE r.regiao_id = p_regiao_id AND r.status = 'ativo';

  SELECT count(*) INTO v_invalid
    FROM unnest(COALESCE(p_unidade_ids, ARRAY[]::uuid[])) u(id)
    LEFT JOIN public.unidades_operacionais un
      ON un.id = u.id AND un.empresa_id = v_regiao.empresa_id AND un.status = 'ativo'
   WHERE un.id IS NULL;
  IF v_invalid > 0 THEN RAISE EXCEPTION 'region_unit_cross_company_or_archived'; END IF;

  UPDATE public.regiao_operacional_unidades
     SET status = 'arquivado', updated_by = p_actor_user_id, updated_at = now()
   WHERE regiao_id = p_regiao_id AND status = 'ativo';

  FOREACH v_id IN ARRAY COALESCE(p_unidade_ids, ARRAY[]::uuid[]) LOOP
    INSERT INTO public.regiao_operacional_unidades (
      empresa_id, regiao_id, unidade_operacional_id, status, created_by, updated_by, updated_at
    ) VALUES (
      v_regiao.empresa_id, p_regiao_id, v_id, 'ativo', p_actor_user_id, p_actor_user_id, now()
    )
    ON CONFLICT (regiao_id, unidade_operacional_id) DO UPDATE
      SET status = 'ativo',
          updated_by = EXCLUDED.updated_by,
          updated_at = now();
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_after
    FROM public.regiao_operacional_unidades r
   WHERE r.regiao_id = p_regiao_id AND r.status = 'ativo';
  PERFORM public.p1_audit('regiao_unidade_alterada', v_regiao.empresa_id, v_regiao.grupo_id, NULL, NULL, p_actor_user_id, v_before, v_after, p_reason);
  RETURN jsonb_build_object('ok', true, 'regiao_id', p_regiao_id, 'unidades', COALESCE(p_unidade_ids, ARRAY[]::uuid[]));
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_criar_membership(
  p_usuario_id uuid,
  p_empresa_id uuid,
  p_grupo_id uuid,
  p_scope_level text,
  p_unidade_id uuid,
  p_regiao_id uuid,
  p_papel text,
  p_is_primary boolean,
  p_actor_user_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS public.usuario_operacional_memberships
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.usuario_operacional_memberships;
  v_target_empresa_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('p1_membership'), hashtext(p_usuario_id::text));
  IF p_empresa_id IS NULL AND p_grupo_id IS NOT NULL THEN
    SELECT empresa_id INTO v_target_empresa_id
      FROM public.usuarios
     WHERE id = p_usuario_id;
    IF v_target_empresa_id IS NULL THEN
      RAISE EXCEPTION 'target_user_without_company';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.grupos_empresariais g
        JOIN public.grupo_empresarial_empresas ge
          ON ge.grupo_id = g.id
       WHERE g.id = p_grupo_id
         AND g.status = 'ativo'
         AND ge.empresa_id = v_target_empresa_id
         AND ge.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'target_user_not_in_active_group';
    END IF;
  END IF;
  INSERT INTO public.usuario_operacional_memberships (
    usuario_id, empresa_id, grupo_id, scope_level, unidade_operacional_id,
    regiao_operacional_id, papel, status, is_primary, motivo, created_by, updated_by
  ) VALUES (
    p_usuario_id, p_empresa_id, p_grupo_id, p_scope_level, p_unidade_id,
    p_regiao_id, COALESCE(p_papel, 'operador'), 'ativo', COALESCE(p_is_primary, false),
    p_motivo, p_actor_user_id, p_actor_user_id
  )
  RETURNING * INTO v_row;
  PERFORM public.p1_audit('membership_criado', p_empresa_id, p_grupo_id, p_unidade_id, v_row.id, p_actor_user_id, NULL, to_jsonb(v_row), p_motivo);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_atualizar_membership(
  p_membership_id uuid,
  p_scope_level text,
  p_unidade_id uuid,
  p_regiao_id uuid,
  p_papel text,
  p_status text,
  p_actor_user_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS public.usuario_operacional_memberships
LANGUAGE plpgsql
AS $$
DECLARE
  v_before public.usuario_operacional_memberships;
  v_after public.usuario_operacional_memberships;
BEGIN
  SELECT * INTO v_before FROM public.usuario_operacional_memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;
  UPDATE public.usuario_operacional_memberships
     SET scope_level = COALESCE(p_scope_level, scope_level),
         unidade_operacional_id = CASE WHEN COALESCE(p_scope_level, scope_level) = 'LOCAL' THEN p_unidade_id ELSE NULL END,
         regiao_operacional_id = CASE WHEN COALESCE(p_scope_level, scope_level) = 'REGIONAL' THEN p_regiao_id ELSE NULL END,
         papel = COALESCE(p_papel, papel),
         status = COALESCE(p_status, status),
         motivo = COALESCE(p_motivo, motivo),
         updated_by = p_actor_user_id,
         updated_at = now()
   WHERE id = p_membership_id
  RETURNING * INTO v_after;
  PERFORM public.p1_audit(
    CASE WHEN COALESCE(p_status, v_before.status) = 'revogado' THEN 'membership_revogado' ELSE 'membership_alterado' END,
    v_after.empresa_id, v_after.grupo_id, v_after.unidade_operacional_id, v_after.id,
    p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after), p_motivo
  );
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1_ativar_enforcement(
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_missing int;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('p1_enforcement'), hashtext(p_empresa_id::text));
  SELECT to_jsonb(e) INTO v_before FROM public.empresas e WHERE e.id = p_empresa_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'empresa_not_found'; END IF;

  SELECT count(*) INTO v_missing
    FROM public.usuarios u
   WHERE u.empresa_id = p_empresa_id
     AND COALESCE(u.status, 'ativo') = 'ativo'
     AND u.tipo IN ('admin','master')
     AND NOT EXISTS (
       SELECT 1
         FROM public.usuario_operacional_memberships m
        WHERE m.usuario_id = u.id
          AND m.empresa_id = p_empresa_id
          AND m.status = 'ativo'
     );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'admins_without_operational_membership:%', v_missing;
  END IF;

  UPDATE public.empresas SET operational_scope_mode = 'enforced' WHERE id = p_empresa_id;
  SELECT to_jsonb(e) INTO v_after FROM public.empresas e WHERE e.id = p_empresa_id;
  PERFORM public.p1_audit('operational_scope_enforced', p_empresa_id, NULL, NULL, NULL, p_actor_user_id, v_before, v_after, p_reason);
  RETURN jsonb_build_object('ok', true, 'empresa_id', p_empresa_id, 'missing_admins', 0);
END;
$$;

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

REVOKE DELETE, TRUNCATE ON TABLE
  public.grupos_empresariais,
  public.grupo_empresarial_empresas,
  public.unidades_operacionais,
  public.regioes_operacionais,
  public.regiao_operacional_unidades,
  public.usuario_operacional_memberships,
  public.operational_scope_auditoria
FROM service_role;

GRANT EXECUTE ON FUNCTION
  public.p1_audit(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text),
  public.p1_criar_grupo(text, uuid, text),
  public.p1_atualizar_grupo(uuid, text, text, uuid, text),
  public.p1_vincular_empresa_grupo(uuid, uuid, text, uuid, text),
  public.p1_criar_unidade(uuid, uuid, text, text, text, text, text, text, text, boolean, uuid, text),
  public.p1_atualizar_unidade(uuid, text, text, text, text, boolean, uuid, text),
  public.p1_criar_regiao(uuid, uuid, text, text, uuid, text),
  public.p1_atualizar_regiao(uuid, text, text, text, uuid, text),
  public.p1_definir_unidades_regiao(uuid, uuid[], uuid, text),
  public.p1_criar_membership(uuid, uuid, uuid, text, uuid, uuid, text, boolean, uuid, text),
  public.p1_atualizar_membership(uuid, text, uuid, uuid, text, text, uuid, text),
  public.p1_ativar_enforcement(uuid, uuid, text)
TO service_role;

REVOKE ALL ON FUNCTION
  public.p1_audit(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text),
  public.p1_criar_grupo(text, uuid, text),
  public.p1_atualizar_grupo(uuid, text, text, uuid, text),
  public.p1_vincular_empresa_grupo(uuid, uuid, text, uuid, text),
  public.p1_criar_unidade(uuid, uuid, text, text, text, text, text, text, text, boolean, uuid, text),
  public.p1_atualizar_unidade(uuid, text, text, text, text, boolean, uuid, text),
  public.p1_criar_regiao(uuid, uuid, text, text, uuid, text),
  public.p1_atualizar_regiao(uuid, text, text, text, uuid, text),
  public.p1_definir_unidades_regiao(uuid, uuid[], uuid, text),
  public.p1_criar_membership(uuid, uuid, uuid, text, uuid, uuid, text, boolean, uuid, text),
  public.p1_atualizar_membership(uuid, text, uuid, uuid, text, text, uuid, text),
  public.p1_ativar_enforcement(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.empresas.operational_scope_mode IS
  'P1 rollout: legacy/configured preserva acesso empresa_id; enforced aplica memberships operacionais.';
COMMENT ON TABLE public.grupos_empresariais IS
  'P1: agrupador corporativo. Nao concede acesso por si so; acesso depende de memberships.';
COMMENT ON TABLE public.unidades_operacionais IS
  'P1: unidade operacional/filial explicita. empresas continua sendo entidade legal/tenant.';
COMMENT ON TABLE public.usuario_operacional_memberships IS
  'P1: autoridade de escopo operacional por usuario. LOCAL=unidade, REGIONAL=regiao, GLOBAL=empresa/grupo autorizado.';

-- ============================================================================
-- ROLLBACK documentado (nao executar sem gate):
--   ALTER TABLE public.fretes DROP COLUMN IF EXISTS unidade_operacional_id;
--   ALTER TABLE public.motoristas DROP COLUMN IF EXISTS unidade_operacional_id;
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS operational_scope_mode;
--   DROP FUNCTION IF EXISTS public.p1_ativar_enforcement(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_atualizar_membership(uuid, text, uuid, uuid, text, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_criar_membership(uuid, uuid, uuid, text, uuid, uuid, text, boolean, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_definir_unidades_regiao(uuid, uuid[], uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_atualizar_regiao(uuid, text, text, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_criar_regiao(uuid, uuid, text, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_atualizar_unidade(uuid, text, text, text, text, boolean, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_criar_unidade(uuid, uuid, text, text, text, text, text, text, text, boolean, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_vincular_empresa_grupo(uuid, uuid, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_atualizar_grupo(uuid, text, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_criar_grupo(text, uuid, text);
--   DROP FUNCTION IF EXISTS public.p1_audit(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text);
--   DROP TABLE IF EXISTS public.operational_scope_auditoria;
--   DROP TABLE IF EXISTS public.usuario_operacional_memberships;
--   DROP TABLE IF EXISTS public.regiao_operacional_unidades;
--   DROP TABLE IF EXISTS public.regioes_operacionais;
--   DROP TABLE IF EXISTS public.unidades_operacionais;
--   DROP TABLE IF EXISTS public.grupo_empresarial_empresas;
--   DROP TABLE IF EXISTS public.grupos_empresariais;
-- ============================================================================

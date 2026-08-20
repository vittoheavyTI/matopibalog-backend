-- 072_permissions_templates_overrides.sql
-- Onda 1 · P2 — Permissões V9: COMPANY ROLE TEMPLATES + USER OVERRIDES + VISIBILITY.
--
-- MODELO (congelado):
--   COMPANY → COMPANY ROLE TEMPLATE → TEMPLATE PERMISSIONS → USER ASSIGNMENT
--           → USER OVERRIDES → EFFECTIVE PERMISSIONS → SCOPE CHECK.
--   Usuário REFERENCIA o template (não copia dezenas de booleans). Override existe
--   SOMENTE para a diferença em relação ao template (ausência de row = INHERIT).
--
-- PROPRIEDADES (política de migração V9):
--   * ADITIVA: só ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS / INSERT idempotente.
--   * SEM drop, SEM rename destrutivo, SEM NOT NULL retroativo, SEM mass UPDATE de
--     permissões existentes, SEM rebaixar admin, SEM ativar financeiro indevido,
--     SEM alterar scopes/tenants.
--   * BACKWARD-COMPATIBLE: segura para aplicar ANTES do deploy do código novo (o
--     código atual ignora as tabelas/colunas novas; a autoridade coarse isAdmin/
--     isSuperAdmin permanece).
--   * IDEMPOTENTE: reaplicar não quebra e não duplica seeds.
--   * PRESERVAÇÃO DE EFETIVO: a migração de dados cria overrides SOMENTE onde o
--     comportamento legado difere do baseline do template, garantindo
--     EFFECTIVE_PERMISSION_BEFORE = EFFECTIVE_PERMISSION_AFTER.
--
-- NÃO aplicar em produção sem o gate explícito do owner (OWNER_MIGRATION_GATE).

-- ===========================================================================
-- 0) ENUM-like via CHECK (visibilidade financeira do motorista — VISIBILITY POLICY)
-- ===========================================================================
-- valores: commission_only | commission_plus_base | full_freight_financial

-- ===========================================================================
-- 1) ROLE TEMPLATES da empresa (baseline inicial editável; NÃO regra global)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  stable_key text NOT NULL,               -- identidade estável (compat Entra App Role)
  display_name text NOT NULL,             -- rótulo editável pela empresa
  descricao text NULL,
  is_system_baseline boolean NOT NULL DEFAULT true,  -- veio do seed do sistema
  editable boolean NOT NULL DEFAULT true,
  -- VISIBILITY POLICY (só faz sentido no template motorista; null = não aplicável)
  driver_financial_visibility_mode text NULL
    CHECK (driver_financial_visibility_mode IS NULL OR driver_financial_visibility_mode
      = ANY (ARRAY['commission_only','commission_plus_base','full_freight_financial']::text[])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, stable_key)
);
CREATE INDEX IF NOT EXISTS idx_permission_templates_empresa ON public.permission_templates (empresa_id);

-- Permissões ALLOW/DENY por template (ausência de row = não concede = default-deny).
-- Não é EAV genérico: permission_key vem do registry canônico do backend.
CREATE TABLE IF NOT EXISTS public.permission_template_permissions (
  template_id uuid NOT NULL REFERENCES public.permission_templates(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  PRIMARY KEY (template_id, permission_key)
);

-- Overrides por usuário (tri-state conceitual: ausência=INHERIT, row=ALLOW/DENY).
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  usuario_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  permission_key text NOT NULL,
  effect text NOT NULL CHECK (effect = ANY (ARRAY['allow','deny']::text[])),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  PRIMARY KEY (usuario_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_empresa ON public.user_permission_overrides (empresa_id);

-- Auditoria append-only de mudanças administrativas de permissão.
CREATE TABLE IF NOT EXISTS public.permission_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY[
    'template.created','template.updated','template.permission_changed',
    'user.template_changed','user.override_set','user.override_removed',
    'user.financial_visibility_changed']::text[])),
  actor_user_id uuid NULL,
  target_type text NULL CHECK (target_type IS NULL OR target_type = ANY (ARRAY['template','user']::text[])),
  target_id uuid NULL,
  permission_key text NULL,
  before_value text NULL,
  after_value text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perm_change_empresa_occ
  ON public.permission_change_events (empresa_id, occurred_at DESC);

-- ===========================================================================
-- 2) Colunas aditivas
-- ---------------------------------------------------------------------------
-- Assignment: usuário → template (nullable p/ compat; resolver cai no legado se null).
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS permission_template_id uuid NULL;

-- Motorista: capability nova freight.create (default false) + visibility override
-- individual (null = herda o template). freight.finish continua tendo o legado
-- pode_finalizar_viagem como fonte, migrado para override quando difere do baseline.
ALTER TABLE public.motoristas ADD COLUMN IF NOT EXISTS pode_criar_frete boolean NOT NULL DEFAULT false;
ALTER TABLE public.motoristas ADD COLUMN IF NOT EXISTS financial_visibility_mode text NULL
  CHECK (financial_visibility_mode IS NULL OR financial_visibility_mode
    = ANY (ARRAY['commission_only','commission_plus_base','full_freight_financial']::text[]));

-- ===========================================================================
-- 3) RLS + append-only + grants (fail-closed p/ anon/authenticated; backend=service_role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.permission_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_template_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_change_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.permission_change_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'PERMISSION_CHANGE_EVENTO_IMUTAVEL' USING errcode = '42501';
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_perm_change_append_only ON public.permission_change_events;
CREATE TRIGGER trg_perm_change_append_only
  BEFORE UPDATE OR DELETE ON public.permission_change_events
  FOR EACH ROW EXECUTE FUNCTION public.permission_change_events_append_only();

-- ===========================================================================
-- 4) SEED idempotente dos templates baseline por EMPRESA
-- ---------------------------------------------------------------------------
-- Espelha backend/services/permissions/permissionRegistry.js (TEMPLATE_BASELINE_ALLOW).
-- Se o registry mudar, este seed deve ser revisto (pgtest cobre a paridade).
DO $seed$
DECLARE
  v_emp uuid;
  v_tpl uuid;
  -- baseline: array de (stable_key, display_name, descricao, allow_keys[], fin_vis)
  r RECORD;
BEGIN
  FOR v_emp IN
    SELECT DISTINCT empresa_id FROM public.usuarios WHERE empresa_id IS NOT NULL
  LOOP
    FOR r IN
      SELECT * FROM (VALUES
        ('administrador','Administrador','Administra o tenant: usuários, permissões, configurações, operação, relatórios e financeiro.',
          ARRAY['company.settings.view','company.settings.manage','users.view','users.manage','permissions.manage','freight.view','freight.create','freight.manage','freight.finish','launch.view','launch.create','launch.approve','launch.reject','launch.cancel','documents.view','documents.manage','drivers.view','drivers.manage','fleet.view','fleet.manage','finance.operational.view','finance.operational.manage','finance.saas.view','reports.operational.view','reports.financial.view','estrutura_operacional.gerenciar','integracoes_erp.gerenciar','acesso_corporativo_sso.gerenciar'], NULL::text),
        ('operador','Operador','Operação do dia a dia: fretes, documentos e lançamentos. Sem financeiro nem administração.',
          ARRAY['company.settings.view','freight.view','freight.create','freight.manage','launch.view','launch.create','documents.view','documents.manage','drivers.view','reports.operational.view'], NULL),
        ('gerente_frota','Gerente de Frota','Gestão operacional da frota no escopo, incluindo aprovação de lançamentos. Sem financeiro por padrão.',
          ARRAY['company.settings.view','freight.view','freight.create','freight.manage','freight.finish','launch.view','launch.create','launch.approve','launch.reject','launch.cancel','documents.view','documents.manage','drivers.view','drivers.manage','fleet.view','fleet.manage','reports.operational.view'], NULL),
        ('gerente_filial','Gerente de Filial','Gestão dentro do escopo da filial. Sem financeiro por padrão.',
          ARRAY['company.settings.view','freight.view','freight.create','freight.manage','freight.finish','launch.view','launch.create','launch.approve','launch.reject','launch.cancel','documents.view','documents.manage','drivers.view','drivers.manage','reports.operational.view'], NULL),
        ('gerente_regional','Gerente Regional','Gestão dentro do escopo regional. Sem financeiro por padrão.',
          ARRAY['company.settings.view','freight.view','freight.create','freight.manage','freight.finish','launch.view','launch.create','launch.approve','launch.reject','launch.cancel','documents.view','documents.manage','drivers.view','drivers.manage','reports.operational.view'], NULL),
        ('gerente_nacional','Gerente Nacional','Gestão no escopo atribuído. Sem financeiro automático.',
          ARRAY['company.settings.view','freight.view','freight.create','freight.manage','freight.finish','launch.view','launch.create','launch.approve','launch.reject','launch.cancel','documents.view','documents.manage','drivers.view','drivers.manage','reports.operational.view'], NULL),
        ('financeiro','Financeiro','Financeiro operacional e relatórios financeiros. Operação administrativa limitada.',
          ARRAY['company.settings.view','freight.view','launch.view','documents.view','finance.operational.view','finance.operational.manage','finance.saas.view','reports.operational.view','reports.financial.view'], NULL),
        ('embarcador','Embarcador','Preparado para planejamento/demanda/documentos (futuro). Sem financeiro por padrão.',
          ARRAY['freight.view','documents.view','reports.operational.view'], NULL),
        ('motorista','Motorista','Acesso ao próprio contexto no app: fretes atribuídos, documentos e lançamentos.',
          ARRAY['freight.view','launch.view','launch.create','documents.view'], 'commission_only')
      ) AS t(stable_key, display_name, descricao, allow_keys, fin_vis)
    LOOP
      -- template (idempotente por empresa+stable_key)
      INSERT INTO public.permission_templates
        (empresa_id, stable_key, display_name, descricao, is_system_baseline, editable, driver_financial_visibility_mode)
      VALUES (v_emp, r.stable_key, r.display_name, r.descricao, true, true, r.fin_vis)
      ON CONFLICT (empresa_id, stable_key) DO NOTHING;

      SELECT id INTO v_tpl FROM public.permission_templates
        WHERE empresa_id = v_emp AND stable_key = r.stable_key;

      -- permissões allow do baseline (idempotente). NÃO sobrescreve edições futuras
      -- da empresa: só insere o que faltar.
      INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
      SELECT v_tpl, k, true FROM unnest(r.allow_keys) AS k
      ON CONFLICT (template_id, permission_key) DO NOTHING;
    END LOOP;
  END LOOP;
END
$seed$;

-- ===========================================================================
-- 5) ASSIGNMENT idempotente: usuário → template baseline por tipo legado
-- ---------------------------------------------------------------------------
-- admin → administrador ; motorista → motorista. NÃO toca super-admin de plataforma
-- (is_super_admin true continua authority separada; o assignment é inofensivo).
UPDATE public.usuarios u
   SET permission_template_id = t.id
  FROM public.permission_templates t
 WHERE u.permission_template_id IS NULL
   AND u.empresa_id IS NOT NULL
   AND t.empresa_id = u.empresa_id
   AND t.stable_key = CASE
         WHEN u.tipo = 'admin' THEN 'administrador'
         WHEN u.tipo = 'motorista' THEN 'motorista'
         ELSE NULL END
   AND CASE WHEN u.tipo IN ('admin','motorista') THEN true ELSE false END;

-- ===========================================================================
-- 6) MIGRAÇÃO DE DADOS — preservar EFETIVO (overrides SOMENTE onde difere)
-- ---------------------------------------------------------------------------
-- 6a) Admin com menu legado desligado → override DENY nas chaves .view de MENU
--     (preserva a visibilidade do painel). NÃO mexe em governance (users.manage/
--     permissions.manage permanecem do template) → invariante do último admin intacta.
--     legacy permissoes: {usuarios, dashboard, motoristas, relatorios, configuracoes}
INSERT INTO public.user_permission_overrides (usuario_id, empresa_id, permission_key, effect, created_by)
SELECT u.id, u.empresa_id, 'users.view', 'deny', NULL
  FROM public.usuarios u
 WHERE u.tipo = 'admin' AND u.empresa_id IS NOT NULL
   AND COALESCE((u.permissoes->>'usuarios')::boolean, true) = false
ON CONFLICT (usuario_id, permission_key) DO NOTHING;

INSERT INTO public.user_permission_overrides (usuario_id, empresa_id, permission_key, effect, created_by)
SELECT u.id, u.empresa_id, 'company.settings.view', 'deny', NULL
  FROM public.usuarios u
 WHERE u.tipo = 'admin' AND u.empresa_id IS NOT NULL
   AND COALESCE((u.permissoes->>'configuracoes')::boolean, true) = false
ON CONFLICT (usuario_id, permission_key) DO NOTHING;

INSERT INTO public.user_permission_overrides (usuario_id, empresa_id, permission_key, effect, created_by)
SELECT u.id, u.empresa_id, 'drivers.view', 'deny', NULL
  FROM public.usuarios u
 WHERE u.tipo = 'admin' AND u.empresa_id IS NOT NULL
   AND COALESCE((u.permissoes->>'motoristas')::boolean, true) = false
ON CONFLICT (usuario_id, permission_key) DO NOTHING;

INSERT INTO public.user_permission_overrides (usuario_id, empresa_id, permission_key, effect, created_by)
SELECT u.id, u.empresa_id, 'reports.operational.view', 'deny', NULL
  FROM public.usuarios u
 WHERE u.tipo = 'admin' AND u.empresa_id IS NOT NULL
   AND COALESCE((u.permissoes->>'relatorios')::boolean, true) = false
ON CONFLICT (usuario_id, permission_key) DO NOTHING;

-- 6b) Motorista com pode_finalizar_viagem=true → override ALLOW freight.finish
--     (baseline motorista tem finish=false). motoristas.id === usuarios.id.
--     Autônomo mantém o bypass no enforcement (propriedade da empresa, não permission)
--     → não depende deste override.
INSERT INTO public.user_permission_overrides (usuario_id, empresa_id, permission_key, effect, created_by)
SELECT u.id, u.empresa_id, 'freight.finish', 'allow', NULL
  FROM public.usuarios u
  JOIN public.motoristas m ON m.id = u.id
 WHERE u.tipo = 'motorista' AND u.empresa_id IS NOT NULL
   AND m.pode_finalizar_viagem = true
ON CONFLICT (usuario_id, permission_key) DO NOTHING;

-- ===========================================================================
-- 7) GUARDA DE GOVERNANÇA — atribuição de template preservando último admin
-- ---------------------------------------------------------------------------
-- Reusa o modelo de "admin válido" (tipo='admin' AND status='ativo') da 069, mas
-- para a via NOVA de mudança de template. Trocar o template de um admin para um
-- template NÃO-administrador implica rebaixá-lo (tipo deixaria de conceder governance).
-- Mantemos tipo='admin' <=> template 'administrador' como marcador canônico durante a
-- transição: atribuir 'administrador' seta tipo='admin'; atribuir outro seta tipo p/ o
-- stable_key (não-admin) — e a guarda bloqueia se remover o último admin.
CREATE OR REPLACE FUNCTION public.atribuir_template_guardando_ultimo_admin(
  p_usuario_id uuid,
  p_empresa_id uuid,
  p_template_id uuid,
  p_actor_user_id uuid
)
RETURNS public.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_tpl public.permission_templates;
  v_novo_tipo text;
  v_era_admin boolean;
  v_sera_admin boolean;
  v_outros integer;
  v_before text;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL OR p_template_id IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuario_nao_encontrado'; END IF;

  SELECT * INTO v_tpl FROM public.permission_templates
   WHERE id = p_template_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_nao_encontrado'; END IF;

  v_novo_tipo := CASE WHEN v_tpl.stable_key = 'administrador' THEN 'admin' ELSE v_tpl.stable_key END;

  v_era_admin  := (v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo');
  v_sera_admin := (v_novo_tipo = 'admin' AND v_alvo.status = 'ativo');

  IF v_era_admin AND NOT v_sera_admin THEN
    SELECT count(*) INTO v_outros FROM public.usuarios
     WHERE empresa_id = p_empresa_id AND id <> p_usuario_id
       AND tipo = 'admin' AND status = 'ativo';
    IF v_outros = 0 THEN RAISE EXCEPTION 'ultimo_admin_da_empresa'; END IF;
  END IF;

  v_before := v_alvo.permission_template_id::text;
  UPDATE public.usuarios
     SET permission_template_id = p_template_id,
         tipo = v_novo_tipo
   WHERE id = p_usuario_id
  RETURNING * INTO v_alvo;

  INSERT INTO public.permission_change_events
    (empresa_id, action, actor_user_id, target_type, target_id, before_value, after_value)
  VALUES (p_empresa_id, 'user.template_changed', p_actor_user_id, 'user', p_usuario_id, v_before, p_template_id::text);

  RETURN v_alvo;
END;
$$;

-- Guarda para override que remove governança do último admin.
CREATE OR REPLACE FUNCTION public.set_user_override_guardando_governanca(
  p_usuario_id uuid,
  p_empresa_id uuid,
  p_permission_key text,
  p_effect text,           -- 'allow' | 'deny' | 'inherit' (inherit = remover row)
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_is_admin boolean;
  v_outros integer;
  v_before text;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL OR p_permission_key IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;
  IF p_effect NOT IN ('allow','deny','inherit') THEN
    RAISE EXCEPTION 'override_effect_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuario_nao_encontrado'; END IF;

  v_is_admin := (v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo');

  -- Negar governance no último admin ativo → bloqueio.
  IF v_is_admin AND p_effect = 'deny'
     AND p_permission_key IN ('users.manage','permissions.manage') THEN
    SELECT count(*) INTO v_outros FROM public.usuarios
     WHERE empresa_id = p_empresa_id AND id <> p_usuario_id
       AND tipo = 'admin' AND status = 'ativo';
    IF v_outros = 0 THEN RAISE EXCEPTION 'ultimo_admin_da_empresa'; END IF;
  END IF;

  SELECT effect INTO v_before FROM public.user_permission_overrides
   WHERE usuario_id = p_usuario_id AND permission_key = p_permission_key;

  IF p_effect = 'inherit' THEN
    DELETE FROM public.user_permission_overrides
     WHERE usuario_id = p_usuario_id AND permission_key = p_permission_key;
    INSERT INTO public.permission_change_events
      (empresa_id, action, actor_user_id, target_type, target_id, permission_key, before_value, after_value)
    VALUES (p_empresa_id, 'user.override_removed', p_actor_user_id, 'user', p_usuario_id, p_permission_key, v_before, NULL);
  ELSE
    INSERT INTO public.user_permission_overrides
      (usuario_id, empresa_id, permission_key, effect, created_by)
    VALUES (p_usuario_id, p_empresa_id, p_permission_key, p_effect, p_actor_user_id)
    ON CONFLICT (usuario_id, permission_key)
      DO UPDATE SET effect = EXCLUDED.effect, created_by = EXCLUDED.created_by, created_at = now();
    INSERT INTO public.permission_change_events
      (empresa_id, action, actor_user_id, target_type, target_id, permission_key, before_value, after_value)
    VALUES (p_empresa_id, 'user.override_set', p_actor_user_id, 'user', p_usuario_id, p_permission_key, v_before, p_effect);
  END IF;
END;
$$;

-- ===========================================================================
-- 8) GRANTS — fail-closed (service_role apenas)
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['permission_templates','permission_template_permissions','user_permission_overrides','permission_change_events'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END
$grants$;

REVOKE ALL ON FUNCTION public.atribuir_template_guardando_ultimo_admin(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atribuir_template_guardando_ultimo_admin(uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.atribuir_template_guardando_ultimo_admin(uuid, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atribuir_template_guardando_ultimo_admin(uuid, uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.set_user_override_guardando_governanca(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_override_guardando_governanca(uuid, uuid, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.set_user_override_guardando_governanca(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_override_guardando_governanca(uuid, uuid, text, text, uuid) TO service_role;

-- ===========================================================================
-- ROLLBACK (documentação — NÃO executar sem gate):
--   DROP FUNCTION IF EXISTS public.set_user_override_guardando_governanca(uuid,uuid,text,text,uuid);
--   DROP FUNCTION IF EXISTS public.atribuir_template_guardando_ultimo_admin(uuid,uuid,uuid,uuid);
--   ALTER TABLE public.motoristas DROP COLUMN IF EXISTS financial_visibility_mode;
--   ALTER TABLE public.motoristas DROP COLUMN IF EXISTS pode_criar_frete;
--   ALTER TABLE public.usuarios  DROP COLUMN IF EXISTS permission_template_id;
--   DROP TABLE IF EXISTS public.permission_change_events;
--   DROP TABLE IF EXISTS public.user_permission_overrides;
--   DROP TABLE IF EXISTS public.permission_template_permissions;
--   DROP TABLE IF EXISTS public.permission_templates;
-- (só se não houver dependência viva; a coluna tipo legada permanece intacta.)

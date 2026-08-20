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
-- 6.5) GOVERNANCE ADMIN V9 — definição por PERMISSÃO EFETIVA (não só tipo)
-- ---------------------------------------------------------------------------
-- GOVERNANCE_ADMIN_VALIDO = usuário da empresa, status='ativo', NÃO super-admin,
-- com EFFECTIVE users.manage AND permissions.manage. Efetivo = override(deny/allow)
-- > template(allow) > default-deny (governança não tem entitlement). Estas funções
-- são a base concurrency-safe de TODAS as guardas de governança da P2.

-- Efetivo de UMA permission para um usuário (sem entitlement — usado só p/ governança).
CREATE OR REPLACE FUNCTION public.p2_effective_permission(
  p_usuario_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_effect text;
  v_tpl uuid;
  v_allow boolean;
BEGIN
  SELECT effect INTO v_effect FROM public.user_permission_overrides
   WHERE usuario_id = p_usuario_id AND permission_key = p_permission_key;
  IF v_effect = 'deny' THEN RETURN false; END IF;
  IF v_effect = 'allow' THEN RETURN true; END IF;

  SELECT permission_template_id INTO v_tpl FROM public.usuarios WHERE id = p_usuario_id;
  IF v_tpl IS NULL THEN RETURN false; END IF;

  SELECT allowed INTO v_allow FROM public.permission_template_permissions
   WHERE template_id = v_tpl AND permission_key = p_permission_key;
  RETURN COALESCE(v_allow, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.eh_governance_admin(
  p_usuario_id uuid,
  p_empresa_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_u public.usuarios;
BEGIN
  SELECT * INTO v_u FROM public.usuarios WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_u.status IS DISTINCT FROM 'ativo' THEN RETURN false; END IF;
  IF v_u.is_super_admin = true THEN RETURN false; END IF;  -- authority de plataforma, não conta como governança do tenant
  RETURN public.p2_effective_permission(p_usuario_id, 'users.manage')
     AND public.p2_effective_permission(p_usuario_id, 'permissions.manage');
END;
$$;

-- Conta governance admins ATIVOS da empresa, opcionalmente excluindo um usuário.
CREATE OR REPLACE FUNCTION public.contar_governance_admins(
  p_empresa_id uuid,
  p_excluir_usuario_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_n integer := 0; r record;
BEGIN
  FOR r IN SELECT id FROM public.usuarios
            WHERE empresa_id = p_empresa_id AND status = 'ativo'
              AND (p_excluir_usuario_id IS NULL OR id <> p_excluir_usuario_id)
  LOOP
    IF public.eh_governance_admin(r.id, p_empresa_id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- 7) GUARDA DE GOVERNANÇA — atribuição de template preservando GOVERNANCE ADMIN
-- ---------------------------------------------------------------------------
-- Trocar o template de um governance admin para um que NÃO concede governança só
-- é permitido se restar >= 1 governance admin na empresa. Concurrency-safe via
-- advisory xact lock por empresa (mesma chave da 069): duas remoções simultâneas
-- dos dois últimos → no máximo uma passa. tipo é mantido como marcador legado
-- (administrador->admin) mas a AUTORIDADE do invariante é a contagem efetiva.
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

  -- Governance admin ANTES da mudança (por permissão efetiva).
  v_era_admin := public.eh_governance_admin(p_usuario_id, p_empresa_id);

  v_before := v_alvo.permission_template_id::text;
  UPDATE public.usuarios
     SET permission_template_id = p_template_id,
         tipo = v_novo_tipo
   WHERE id = p_usuario_id
  RETURNING * INTO v_alvo;

  -- Governance admin DEPOIS (o template novo já vale). Se deixou de ser e a empresa
  -- ficaria com zero → rollback (RAISE dentro da mesma tx desfaz o UPDATE).
  v_sera_admin := public.eh_governance_admin(p_usuario_id, p_empresa_id);
  IF v_era_admin AND NOT v_sera_admin THEN
    v_outros := public.contar_governance_admins(p_empresa_id, p_usuario_id);
    IF v_outros = 0 THEN RAISE EXCEPTION 'ultimo_admin_da_empresa'; END IF;
  END IF;

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
  v_era_admin boolean;
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

  -- Governança ANTES da mudança (por permissão efetiva).
  v_era_admin := public.eh_governance_admin(p_usuario_id, p_empresa_id);

  SELECT effect INTO v_before FROM public.user_permission_overrides
   WHERE usuario_id = p_usuario_id AND permission_key = p_permission_key;

  -- Aplica o override (qualquer key/efeito).
  IF p_effect = 'inherit' THEN
    DELETE FROM public.user_permission_overrides
     WHERE usuario_id = p_usuario_id AND permission_key = p_permission_key;
  ELSE
    INSERT INTO public.user_permission_overrides
      (usuario_id, empresa_id, permission_key, effect, created_by)
    VALUES (p_usuario_id, p_empresa_id, p_permission_key, p_effect, p_actor_user_id)
    ON CONFLICT (usuario_id, permission_key)
      DO UPDATE SET effect = EXCLUDED.effect, created_by = EXCLUDED.created_by, created_at = now();
  END IF;

  -- Governança DEPOIS: se o alvo deixou de ser governance admin e sobraria zero na
  -- empresa → rollback (cobre deny de users.manage/permissions.manage, ou remover
  -- override que os concedia). Concurrency-safe pelo advisory lock por empresa.
  IF v_era_admin AND NOT public.eh_governance_admin(p_usuario_id, p_empresa_id) THEN
    IF public.contar_governance_admins(p_empresa_id, p_usuario_id) = 0 THEN
      RAISE EXCEPTION 'ultimo_admin_da_empresa';
    END IF;
  END IF;

  INSERT INTO public.permission_change_events
    (empresa_id, action, actor_user_id, target_type, target_id, permission_key, before_value, after_value)
  VALUES (p_empresa_id,
    CASE WHEN p_effect = 'inherit' THEN 'user.override_removed' ELSE 'user.override_set' END,
    p_actor_user_id, 'user', p_usuario_id, p_permission_key, v_before,
    CASE WHEN p_effect = 'inherit' THEN NULL ELSE p_effect END);
END;
$$;

-- Guarda de EDIÇÃO DE TEMPLATE preservando governança (aplica as permissões e, se
-- restar zero governance admin, faz rollback). Recebe p_allow (keys marcadas=allow)
-- e p_remove (keys a remover). Concurrency-safe por empresa.
CREATE OR REPLACE FUNCTION public.atualizar_template_permissions_guardando_governanca(
  p_template_id uuid,
  p_empresa_id uuid,
  p_allow_keys text[],
  p_remove_keys text[],
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_tpl public.permission_templates; k text;
BEGIN
  IF p_template_id IS NULL OR p_empresa_id IS NULL THEN RAISE EXCEPTION 'guarda_admin_payload_invalido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_tpl FROM public.permission_templates WHERE id = p_template_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_nao_encontrado'; END IF;
  IF v_tpl.editable = false THEN RAISE EXCEPTION 'template_nao_editavel'; END IF;

  IF p_remove_keys IS NOT NULL THEN
    DELETE FROM public.permission_template_permissions
     WHERE template_id = p_template_id AND permission_key = ANY(p_remove_keys);
  END IF;
  IF p_allow_keys IS NOT NULL THEN
    FOREACH k IN ARRAY p_allow_keys LOOP
      INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
      VALUES (p_template_id, k, true)
      ON CONFLICT (template_id, permission_key) DO UPDATE SET allowed = true;
    END LOOP;
  END IF;

  -- Após aplicar, a empresa precisa manter >= 1 governance admin (a edição pode ter
  -- removido users.manage/permissions.manage de todos os usuários deste template).
  IF public.contar_governance_admins(p_empresa_id, NULL) = 0 THEN
    RAISE EXCEPTION 'ultimo_admin_da_empresa';
  END IF;

  UPDATE public.permission_templates SET updated_at = now() WHERE id = p_template_id;
  INSERT INTO public.permission_change_events
    (empresa_id, action, actor_user_id, target_type, target_id)
  VALUES (p_empresa_id, 'template.permission_changed', p_actor_user_id, 'template', p_template_id);
END;
$$;

-- ===========================================================================
-- 7.5) GOVERNANCE V9 NAS RPCs LEGADO (069) — UPDATE/DELETE de usuário
-- ---------------------------------------------------------------------------
-- As RPCs da 069 protegiam o "último admin" pelo MODELO LEGADO (tipo='admin' AND
-- status='ativo'). Aqui as reescrevemos (CREATE OR REPLACE — a 072 roda depois da
-- 069) PRESERVANDO integralmente a guarda legado E ADICIONANDO a rede V9: após
-- aplicar a mudança, a empresa PRECISA manter >= 1 GOVERNANCE ADMIN efetivo
-- (eh_governance_admin). Isso cobre TODAS as vias que retiram governança por estas
-- RPCs: status ativo→inativo/bloqueado, tipo admin→outro, remoção do usuário e
-- alteração legada de `permissoes`. Concurrency-safe pela MESMA chave de advisory
-- lock por empresa ('guarda_ultimo_admin') — duas remoções simultâneas dos dois
-- últimos governance admins: no máximo uma passa; a segunda re-lê e é negada (409).

CREATE OR REPLACE FUNCTION public.atualizar_usuario_guardando_ultimo_admin(
  p_usuario_id uuid,
  p_empresa_id uuid,
  p_updates jsonb
)
RETURNS public.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_novo_status text;
  v_novo_tipo text;
  v_era_admin boolean;
  v_sera_admin boolean;
  v_outros integer;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo
    FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  v_novo_status := COALESCE(p_updates->>'status', v_alvo.status);
  v_novo_tipo   := COALESCE(p_updates->>'tipo', v_alvo.tipo);

  -- Guarda LEGADO (preservada tal qual a 069): último admin por tipo/status.
  v_era_admin  := (v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo');
  v_sera_admin := (v_novo_tipo = 'admin' AND v_novo_status = 'ativo');
  IF v_era_admin AND NOT v_sera_admin THEN
    SELECT count(*) INTO v_outros
      FROM public.usuarios
     WHERE empresa_id = p_empresa_id
       AND id <> p_usuario_id
       AND tipo = 'admin'
       AND status = 'ativo';
    IF v_outros = 0 THEN
      RAISE EXCEPTION 'ultimo_admin_da_empresa';
    END IF;
  END IF;

  UPDATE public.usuarios SET
    nome       = CASE WHEN p_updates ? 'nome'       THEN p_updates->>'nome'       ELSE nome END,
    telefone   = CASE WHEN p_updates ? 'telefone'   THEN p_updates->>'telefone'   ELSE telefone END,
    cep        = CASE WHEN p_updates ? 'cep'        THEN p_updates->>'cep'        ELSE cep END,
    endereco   = CASE WHEN p_updates ? 'endereco'   THEN p_updates->>'endereco'   ELSE endereco END,
    bairro     = CASE WHEN p_updates ? 'bairro'     THEN p_updates->>'bairro'     ELSE bairro END,
    cidade     = CASE WHEN p_updates ? 'cidade'     THEN p_updates->>'cidade'     ELSE cidade END,
    foto_url   = CASE WHEN p_updates ? 'foto_url'   THEN p_updates->>'foto_url'   ELSE foto_url END,
    permissoes = CASE WHEN p_updates ? 'permissoes' THEN p_updates->'permissoes'  ELSE permissoes END,
    status     = v_novo_status,
    tipo       = v_novo_tipo
  WHERE id = p_usuario_id
  RETURNING * INTO v_alvo;

  -- Rede V9: após aplicar, a empresa precisa manter >= 1 governance admin efetivo.
  IF public.contar_governance_admins(p_empresa_id, NULL) = 0 THEN
    RAISE EXCEPTION 'ultimo_admin_da_empresa';
  END IF;

  RETURN v_alvo;
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_usuario_guardando_ultimo_admin(
  p_usuario_id uuid,
  p_empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_outros integer;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo
    FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  -- Guarda LEGADO (preservada tal qual a 069).
  IF v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo' THEN
    SELECT count(*) INTO v_outros
      FROM public.usuarios
     WHERE empresa_id = p_empresa_id
       AND id <> p_usuario_id
       AND tipo = 'admin'
       AND status = 'ativo';
    IF v_outros = 0 THEN
      RAISE EXCEPTION 'ultimo_admin_da_empresa';
    END IF;
  END IF;

  DELETE FROM public.usuarios WHERE id = p_usuario_id;

  -- Rede V9: após remover, a empresa precisa manter >= 1 governance admin efetivo.
  IF public.contar_governance_admins(p_empresa_id, NULL) = 0 THEN
    RAISE EXCEPTION 'ultimo_admin_da_empresa';
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

-- Governance helpers + template-edit guard (fail-closed p/ anon/authenticated).
DO $gfn$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.p2_effective_permission(uuid, text)',
    'public.eh_governance_admin(uuid, uuid)',
    'public.contar_governance_admins(uuid, uuid)',
    'public.atualizar_template_permissions_guardando_governanca(uuid, uuid, text[], text[], uuid)',
    -- RPCs legado reescritas com governança V9 (re-asserção fail-closed).
    'public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb)',
    'public.excluir_usuario_guardando_ultimo_admin(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END
$gfn$;

-- ===========================================================================
-- ROLLBACK (documentação — NÃO executar sem gate):
--   DROP FUNCTION IF EXISTS public.atualizar_template_permissions_guardando_governanca(uuid,uuid,text[],text[],uuid);
--   DROP FUNCTION IF EXISTS public.contar_governance_admins(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.eh_governance_admin(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.p2_effective_permission(uuid,text);
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

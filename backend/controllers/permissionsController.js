// permissionsController.js — API admin de Perfis e Permissões V9 (P2).
// Tenant-scoped (req.empresa_id). Enforcement: permissions.manage. Mudanças de
// governança (template/override) passam pelas RPCs guardadas (último admin).

'use strict';

const supabase = require('../config/supabase');
const {
  PERMISSIONS,
  TEMPLATE_META,
  UI_ENABLED_TEMPLATE_KEYS,
  DRIVER_FINANCIAL_VISIBILITY_MODES,
  isValidPermissionKey,
} = require('../services/permissions/permissionRegistry');
const { loadEffectivePermissions } = require('../services/permissions/permissionResolver');

// P2.9 — REPAIR PATH administrativo/idempotente (recovery/manutenção explícita).
// Garante os templates baseline da PRÓPRIA empresa (tenant-scoped). NÃO é GET (não
// repara em leitura); é POST explícito, gated por permissions.manage (router). Atômico
// e idempotente via RPC — reaplicar não duplica.
exports.ensureTemplates = async (req, res) => {
  try {
    const { ensurePermissionTemplatesForEmpresa } = require('../services/permissions/permissionProvisioning');
    const r = await ensurePermissionTemplatesForEmpresa(supabase, req.empresa_id);
    if (!r?.ok) return res.status(500).json({ ok: false, message: 'Falha ao provisionar perfis da empresa.' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[permissions.ensureTemplates]', err?.message || err);
    return res.status(500).json({ ok: false, message: 'Falha ao provisionar perfis da empresa.' });
  }
};

// Catálogo canônico p/ a UI (nunca expõe permissões inexistentes). P2.10 — oculta
// capabilities de MÓDULO FUTURO (futureModule) da UI de templates: elas ainda não
// controlam comportamento, então não devem virar checkbox decorativo. A chave técnica
// permanece no registry (compat/baseline) e será reexibida quando o módulo existir.
exports.getRegistry = async (req, res) => {
  res.status(200).json({
    permissions: PERMISSIONS.filter((p) => p.futureModule !== true),
    templates_meta: TEMPLATE_META,
    ui_enabled_templates: UI_ENABLED_TEMPLATE_KEYS,
    financial_visibility_modes: DRIVER_FINANCIAL_VISIBILITY_MODES,
  });
};

// Lista templates da empresa + mapa de permissões + contagem de usuários.
exports.listTemplates = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    // READ-ONLY: este GET NÃO provisiona templates (sem write-on-read). O baseline é
    // semeado no fluxo de CRIAÇÃO da empresa (empresaService.criarEmpresaCompleta →
    // provisionTemplatesForEmpresa) e pela migration 072 nas empresas existentes. Se
    // uma empresa legada estiver sem templates, o resolver tem safety net em código
    // (baselineTemplateFromRegistry) que evita lockout — mas a lista fica vazia aqui
    // até o provisionamento persistente rodar, o que é o comportamento correto para
    // um endpoint de leitura.
    const { data: templates, error } = await supabase
      .from('permission_templates')
      .select('id, stable_key, display_name, descricao, is_system_baseline, editable, driver_financial_visibility_mode')
      .eq('empresa_id', empresaId)
      .order('stable_key');
    if (error) throw error;

    const ids = (templates || []).map((t) => t.id);
    let perms = [];
    let counts = [];
    if (ids.length) {
      const [{ data: p }, { data: u }] = await Promise.all([
        supabase.from('permission_template_permissions').select('template_id, permission_key, allowed').in('template_id', ids),
        supabase.from('usuarios').select('permission_template_id').eq('empresa_id', empresaId),
      ]);
      perms = p || [];
      counts = u || [];
    }
    const permByTpl = {};
    for (const row of perms) {
      if (!permByTpl[row.template_id]) permByTpl[row.template_id] = {};
      if (row.allowed === true) permByTpl[row.template_id][row.permission_key] = true;
    }
    const countByTpl = {};
    for (const row of counts) if (row.permission_template_id) countByTpl[row.permission_template_id] = (countByTpl[row.permission_template_id] || 0) + 1;

    res.status(200).json({
      templates: (templates || []).map((t) => ({
        ...t,
        permissions: permByTpl[t.id] || {},
        user_count: countByTpl[t.id] || 0,
      })),
    });
  } catch (err) {
    console.error('[permissions.listTemplates]', err?.message || err);
    res.status(500).json({ message: 'Erro ao listar perfis.' });
  }
};

// Atualiza um template da empresa (display_name / permissões / visibility policy).
exports.updateTemplate = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const templateId = req.params.id;
    const { display_name, permissions, driver_financial_visibility_mode } = req.body || {};

    const { data: tpl, error: tplErr } = await supabase
      .from('permission_templates')
      .select('id, editable, driver_financial_visibility_mode, stable_key')
      .eq('id', templateId).eq('empresa_id', empresaId).maybeSingle();
    if (tplErr) throw tplErr;
    if (!tpl) return res.status(404).json({ message: 'Perfil não encontrado.' });
    if (tpl.editable === false) return res.status(409).json({ message: 'Perfil não editável.' });

    // permissions: objeto { key: boolean }. Valida contra o registry e aplica via
    // RPC GUARDADA (concurrency-safe + preserva governança da empresa).
    if (permissions && typeof permissions === 'object') {
      const invalidas = Object.keys(permissions).filter((k) => !isValidPermissionKey(k));
      if (invalidas.length) return res.status(400).json({ message: 'Permissões inválidas.', invalidas });
      const allowKeys = Object.entries(permissions).filter(([, v]) => v === true).map(([k]) => k);
      const removeKeys = Object.entries(permissions).filter(([, v]) => v !== true).map(([k]) => k);
      const { error: rpcErr } = await supabase.rpc('atualizar_template_permissions_guardando_governanca', {
        p_template_id: templateId, p_empresa_id: empresaId,
        p_allow_keys: allowKeys, p_remove_keys: removeKeys, p_actor_user_id: req.user?.uid || null,
      });
      if (rpcErr) return mapGuardError(res, rpcErr);
    }

    const patch = {};
    if (typeof display_name === 'string' && display_name.trim()) patch.display_name = display_name.trim();
    if (driver_financial_visibility_mode !== undefined) {
      if (driver_financial_visibility_mode !== null && !DRIVER_FINANCIAL_VISIBILITY_MODES.includes(driver_financial_visibility_mode)) {
        return res.status(400).json({ message: 'Modo de visibilidade financeira inválido.' });
      }
      patch.driver_financial_visibility_mode = driver_financial_visibility_mode;
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await supabase.from('permission_templates').update(patch).eq('id', templateId).eq('empresa_id', empresaId);
    }

    await supabase.from('permission_change_events').insert({
      empresa_id: empresaId, action: 'template.updated', actor_user_id: req.user?.uid || null,
      target_type: 'template', target_id: templateId,
      metadata: { permissions_changed: !!permissions, meta_changed: Object.keys(patch).length > 0 },
    }).then(() => {}, () => {});

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[permissions.updateTemplate]', err?.message || err);
    res.status(500).json({ message: 'Erro ao atualizar perfil.' });
  }
};

// Efetivo + template + overrides de um usuário-alvo da empresa.
exports.getUserPermissions = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const usuarioId = req.params.id;
    const { data: alvo, error } = await supabase
      .from('usuarios')
      .select('id, nome, tipo, status, permission_template_id, empresa_id, empresas!usuarios_empresa_id_fkey(tipo)')
      .eq('id', usuarioId).eq('empresa_id', empresaId).maybeSingle();
    if (error) throw error;
    if (!alvo) return res.status(404).json({ message: 'Usuário não encontrado.' });

    const { data: ovs } = await supabase
      .from('user_permission_overrides')
      .select('permission_key, effect').eq('usuario_id', usuarioId);

    const eff = await loadEffectivePermissions(supabase, {
      uid: alvo.id, tipo: alvo.tipo, is_super_admin: false,
      empresa_id: alvo.empresa_id, empresa_tipo: alvo.empresas?.tipo ?? null,
    });

    res.status(200).json({
      usuario: { id: alvo.id, nome: alvo.nome, tipo: alvo.tipo, status: alvo.status },
      permission_template_id: alvo.permission_template_id,
      overrides: Object.fromEntries((ovs || []).map((o) => [o.permission_key, o.effect])),
      effective: eff.permissions,
      driver_financial_visibility: eff.driverFinancialVisibility,
    });
  } catch (err) {
    console.error('[permissions.getUserPermissions]', err?.message || err);
    res.status(500).json({ message: 'Erro ao carregar permissões do usuário.' });
  }
};

// Atribui template (guardado contra último admin).
exports.assignTemplate = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const usuarioId = req.params.id;
    const { template_id } = req.body || {};
    if (!template_id) return res.status(400).json({ message: 'template_id obrigatório.' });

    const { data, error } = await supabase.rpc('atribuir_template_guardando_ultimo_admin', {
      p_usuario_id: usuarioId, p_empresa_id: empresaId, p_template_id: template_id, p_actor_user_id: req.user?.uid || null,
    });
    if (error) return mapGuardError(res, error);
    res.status(200).json({ ok: true, usuario: data });
  } catch (err) {
    console.error('[permissions.assignTemplate]', err?.message || err);
    res.status(500).json({ message: 'Erro ao atribuir perfil.' });
  }
};

// Define/remove override (allow|deny|inherit), guardado contra último admin.
exports.setOverride = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const usuarioId = req.params.id;
    const { permission_key, effect } = req.body || {};
    if (!permission_key || !isValidPermissionKey(permission_key)) return res.status(400).json({ message: 'permission_key inválida.' });
    if (!['allow', 'deny', 'inherit'].includes(effect)) return res.status(400).json({ message: 'effect inválido (allow|deny|inherit).' });

    const { error } = await supabase.rpc('set_user_override_guardando_governanca', {
      p_usuario_id: usuarioId, p_empresa_id: empresaId, p_permission_key: permission_key, p_effect: effect, p_actor_user_id: req.user?.uid || null,
    });
    if (error) return mapGuardError(res, error);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[permissions.setOverride]', err?.message || err);
    res.status(500).json({ message: 'Erro ao definir override.' });
  }
};

// Ajustes do motorista: pode_criar_frete / pode_finalizar_viagem / visibilidade financeira.
exports.updateMotorista = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const motoristaId = req.params.id;
    const { pode_criar_frete, pode_finalizar_viagem, financial_visibility_mode } = req.body || {};

    const { data: mot, error: motErr } = await supabase
      .from('motoristas').select('id, empresa_id').eq('id', motoristaId).eq('empresa_id', empresaId).maybeSingle();
    if (motErr) throw motErr;
    if (!mot) return res.status(404).json({ message: 'Motorista não encontrado.' });

    const patch = {};
    if (pode_criar_frete !== undefined) patch.pode_criar_frete = Boolean(pode_criar_frete);
    if (pode_finalizar_viagem !== undefined) patch.pode_finalizar_viagem = Boolean(pode_finalizar_viagem);
    if (financial_visibility_mode !== undefined) {
      if (financial_visibility_mode !== null && !DRIVER_FINANCIAL_VISIBILITY_MODES.includes(financial_visibility_mode)) {
        return res.status(400).json({ message: 'Modo de visibilidade financeira inválido.' });
      }
      patch.financial_visibility_mode = financial_visibility_mode;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nada para atualizar.' });

    const { error: updErr } = await supabase.from('motoristas').update(patch).eq('id', motoristaId).eq('empresa_id', empresaId);
    if (updErr) throw updErr;

    if (patch.financial_visibility_mode !== undefined) {
      await supabase.from('permission_change_events').insert({
        empresa_id: empresaId, action: 'user.financial_visibility_changed', actor_user_id: req.user?.uid || null,
        target_type: 'user', target_id: motoristaId, after_value: String(patch.financial_visibility_mode),
      }).then(() => {}, () => {});
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[permissions.updateMotorista]', err?.message || err);
    res.status(500).json({ message: 'Erro ao atualizar motorista.' });
  }
};

function mapGuardError(res, error) {
  const msg = String(error.message || '');
  if (/ultimo_admin_da_empresa/.test(msg)) {
    return res.status(409).json({ message: 'A empresa ficaria sem administrador válido. Promova outro administrador antes.' });
  }
  if (/usuario_nao_encontrado|template_nao_encontrado/.test(msg)) {
    return res.status(404).json({ message: 'Registro não encontrado.' });
  }
  if (/template_nao_editavel/.test(msg)) {
    return res.status(409).json({ message: 'Perfil não editável.' });
  }
  if (/override_effect_invalido|guarda_admin_payload_invalido/.test(msg)) {
    return res.status(400).json({ message: 'Requisição inválida.' });
  }
  console.error('[permissions.guard]', msg);
  return res.status(500).json({ message: 'Erro ao aplicar mudança de permissão.' });
}

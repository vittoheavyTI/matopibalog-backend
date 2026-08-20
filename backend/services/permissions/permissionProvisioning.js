// permissionProvisioning.js — Provisiona templates baseline + assignment para
// empresas/usuários NOVOS (criados após a migration 072). Espelha o seed da 072
// a partir do registry canônico. Idempotente e fail-safe (nunca derruba o fluxo
// de criação; o resolver tem safety net em código de qualquer forma).

'use strict';

const {
  TEMPLATE_KEYS,
  TEMPLATE_META,
  TEMPLATE_BASELINE_ALLOW,
  TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY,
  LEGACY_TIPO_TO_TEMPLATE,
} = require('./permissionRegistry');

/** Semeia (idempotente) os 9 templates baseline + permissões da empresa. */
async function provisionTemplatesForEmpresa(supabase, empresaId) {
  if (!empresaId) return { ok: false, reason: 'no_empresa' };
  try {
    for (const stableKey of Object.values(TEMPLATE_KEYS)) {
      const meta = TEMPLATE_META[stableKey] || { display_name: stableKey, descricao: null };
      const finVis = TEMPLATE_DEFAULT_FINANCIAL_VISIBILITY[stableKey] || null;

      // upsert do template por (empresa_id, stable_key)
      await supabase.from('permission_templates').upsert({
        empresa_id: empresaId, stable_key: stableKey,
        display_name: meta.display_name, descricao: meta.descricao || null,
        is_system_baseline: true, editable: true, driver_financial_visibility_mode: finVis,
      }, { onConflict: 'empresa_id,stable_key', ignoreDuplicates: true });

      const { data: tpl } = await supabase.from('permission_templates')
        .select('id').eq('empresa_id', empresaId).eq('stable_key', stableKey).maybeSingle();
      if (!tpl) continue;

      const allow = TEMPLATE_BASELINE_ALLOW[stableKey] || [];
      if (allow.length) {
        await supabase.from('permission_template_permissions').upsert(
          allow.map((permission_key) => ({ template_id: tpl.id, permission_key, allowed: true })),
          { onConflict: 'template_id,permission_key', ignoreDuplicates: true }
        );
      }
    }
    return { ok: true };
  } catch (err) {
    // fail-safe: não bloqueia criação; resolver usa baseline do registry.
    console.error('[permissionProvisioning.provisionTemplatesForEmpresa]', err?.message || err);
    return { ok: false, reason: 'error' };
  }
}

/** Atribui o template baseline por tipo legado (admin→administrador, motorista→motorista). */
async function assignTemplateByTipo(supabase, usuarioId, empresaId, tipo) {
  const stableKey = LEGACY_TIPO_TO_TEMPLATE[tipo] || null;
  if (!usuarioId || !empresaId || !stableKey) return { ok: false, reason: 'no_mapping' };
  try {
    let { data: tpl } = await supabase.from('permission_templates')
      .select('id').eq('empresa_id', empresaId).eq('stable_key', stableKey).maybeSingle();
    if (!tpl) {
      // provisiona sob demanda (empresa nova) e re-consulta
      await provisionTemplatesForEmpresa(supabase, empresaId);
      ({ data: tpl } = await supabase.from('permission_templates')
        .select('id').eq('empresa_id', empresaId).eq('stable_key', stableKey).maybeSingle());
    }
    if (!tpl) return { ok: false, reason: 'template_ausente' };
    await supabase.from('usuarios').update({ permission_template_id: tpl.id }).eq('id', usuarioId);
    return { ok: true, template_id: tpl.id };
  } catch (err) {
    console.error('[permissionProvisioning.assignTemplateByTipo]', err?.message || err);
    return { ok: false, reason: 'error' };
  }
}

module.exports = { provisionTemplatesForEmpresa, assignTemplateByTipo };

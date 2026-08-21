// permissionProvisioning.js — Provisionamento de templates baseline por EMPRESA.
//
// AUTORIDADE (P2.9): o provisionamento é PERSISTENTE e ATÔMICO via a RPC
// `ensure_permission_templates_for_empresa` (migration 072): uma transação da função,
// idempotente (ON CONFLICT DO NOTHING), stable_key como identidade. É o ÚNICO caminho
// de provisionamento (criação de empresa, recovery/manutenção, backfill). NUNCA via GET.
//
// permission_template_id do usuário é uma DENORMALIZAÇÃO/CACHE não-autoritativa: o
// resolver resolve por empresa+stable_key (dual-read) quando o ponteiro é null, e a
// ATRIBUIÇÃO DELIBERADA de template é feita pela RPC guardada
// `atribuir_template_guardando_ultimo_admin` (atômica, com invariante de governança).
// Por isso o set inicial do ponteiro em createUsuario/createMotorista é best-effort:
// se falhar, o efetivo do usuário é idêntico (resolver cai no template por stable_key).

'use strict';

/**
 * Provisiona (idempotente, ATÔMICO) os templates baseline da empresa via RPC.
 * Repair path canônico: criação, recovery e backfill. Reaplicar não duplica.
 * @returns {{ok:boolean, reason?:string}}
 */
async function ensurePermissionTemplatesForEmpresa(supabase, empresaId) {
  if (!empresaId) return { ok: false, reason: 'no_empresa' };
  const { error } = await supabase.rpc('ensure_permission_templates_for_empresa', {
    p_empresa_id: empresaId,
  });
  if (error) {
    console.error('[permissionProvisioning.ensure]', error.message || error);
    return { ok: false, reason: 'rpc_error', message: error.message || String(error) };
  }
  return { ok: true };
}

// Alias histórico (mesma semântica estrita/atômica).
const provisionTemplatesForEmpresa = ensurePermissionTemplatesForEmpresa;

/**
 * Atribui (CACHE) o template baseline por tipo legado ao usuário. Best-effort: o
 * ponteiro é não-autoritativo (resolver dual-read por stable_key). Se o template
 * ainda não existir (empresa nova em recovery), garante o provisionamento e re-consulta.
 */
async function assignTemplateByTipo(supabase, usuarioId, empresaId, tipo) {
  const { LEGACY_TIPO_TO_TEMPLATE } = require('./permissionRegistry');
  const stableKey = LEGACY_TIPO_TO_TEMPLATE[tipo] || null;
  if (!usuarioId || !empresaId || !stableKey) return { ok: false, reason: 'no_mapping' };
  try {
    let { data: tpl } = await supabase.from('permission_templates')
      .select('id').eq('empresa_id', empresaId).eq('stable_key', stableKey).maybeSingle();
    if (!tpl) {
      await ensurePermissionTemplatesForEmpresa(supabase, empresaId);
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

module.exports = {
  ensurePermissionTemplatesForEmpresa,
  provisionTemplatesForEmpresa,
  assignTemplateByTipo,
};

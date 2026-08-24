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
  await ensureOperationCampaignTemplatePermissionsForEmpresa(supabase, empresaId);
  await ensureDispatchV1TemplatePermissionsForEmpresa(supabase, empresaId);
  return { ok: true };
}

async function ensureOperationCampaignTemplatePermissionsForEmpresa(supabase, empresaId) {
  if (!empresaId) return { ok: false, reason: 'no_empresa' };
  try {
    const { error } = await supabase.rpc('ensure_operation_campaign_template_permissions_for_empresa', {
      p_empresa_id: empresaId,
    });
    if (!error) return { ok: true };
    if (isMissingRpc(error)) return { ok: false, reason: 'campaign_rpc_absent' };
    console.error('[permissionProvisioning.ensureCampaign]', error.message || error);
    return { ok: false, reason: 'campaign_rpc_error', message: error.message || String(error) };
  } catch (err) {
    if (/ensure_permission_templates_for_empresa|ensure_operation_campaign_template_permissions_for_empresa|assert/i.test(err?.message || '')) {
      return { ok: false, reason: 'campaign_rpc_absent' };
    }
    console.error('[permissionProvisioning.ensureCampaign]', err?.message || err);
    return { ok: false, reason: 'campaign_rpc_error', message: err?.message || String(err) };
  }
}

// Mesmo idioma de ensureOperationCampaignTemplatePermissionsForEmpresa, para as chaves do
// Dispatch V1 (migration 079: campaign.dispatch / campaign.dispatch_respond). Tolerante a
// RPC ausente (empresa provisionada antes da 079 existir/aplicar em produção).
async function ensureDispatchV1TemplatePermissionsForEmpresa(supabase, empresaId) {
  if (!empresaId) return { ok: false, reason: 'no_empresa' };
  try {
    const { error } = await supabase.rpc('ensure_dispatch_v1_template_permissions_for_empresa', {
      p_empresa_id: empresaId,
    });
    if (!error) return { ok: true };
    if (isMissingRpc(error)) return { ok: false, reason: 'dispatch_rpc_absent' };
    console.error('[permissionProvisioning.ensureDispatch]', error.message || error);
    return { ok: false, reason: 'dispatch_rpc_error', message: error.message || String(error) };
  } catch (err) {
    if (/ensure_dispatch_v1_template_permissions_for_empresa|assert/i.test(err?.message || '')) {
      return { ok: false, reason: 'dispatch_rpc_absent' };
    }
    console.error('[permissionProvisioning.ensureDispatch]', err?.message || err);
    return { ok: false, reason: 'dispatch_rpc_error', message: err?.message || String(err) };
  }
}

function isMissingRpc(error) {
  return error && (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    /function .* does not exist|could not find .* function|schema cache/i.test(error.message || '')
  );
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
  ensureOperationCampaignTemplatePermissionsForEmpresa,
  ensureDispatchV1TemplatePermissionsForEmpresa,
  provisionTemplatesForEmpresa,
  assignTemplateByTipo,
};

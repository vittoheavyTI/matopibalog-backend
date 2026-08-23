'use strict';

function hasSupabaseError(result) {
  return result && result.error;
}

function createSupabaseDiagnosticFacts(supabase) {
  async function selectLimited(table, columns, limit = 50) {
    const result = await supabase.from(table).select(columns).limit(limit);
    if (hasSupabaseError(result)) {
      const err = new Error(result.error.message || `query_failed:${table}`);
      err.code = result.error.code || `query_failed:${table}`;
      throw err;
    }
    return Array.isArray(result.data) ? result.data : [];
  }

  return {
    async sampleAuthAudit() {
      return selectLimited('auth_event_audit', 'event,origem,request_id,resultado,motivo,user_agent,created_at', 50);
    },
    async sampleLancamentoEventos() {
      return selectLimited('lancamento_eventos', 'entity_type,entity_id,action,actor_role,source,reason,metadata,occurred_at', 50);
    },
    async sampleDocumentoUploads() {
      return selectLimited('frete_documentos', 'tipo,document_contract_version,client_request_id,status,nome_documento,descricao,created_at', 50);
    },
    async sampleDocumentoEventos() {
      return selectLimited('frete_documento_eventos', 'evento,actor_role,source,reason,metadata,created_at', 50);
    },
    async sampleBillingOutbox() {
      return selectLimited('billing_outbox', 'event_type,dedupe_key,status,attempts,max_attempts,created_at', 50);
    },
    async sampleFleetCompositionMembers() {
      return selectLimited('vehicle_composition_members', 'id,empresa_id,composition_id,asset_id,valid_until,created_at', 200);
    },
    async sampleFleetDriverAssignments() {
      return selectLimited('driver_vehicle_assignments', 'id,empresa_id,driver_id,asset_id,composition_id,assignment_status,valid_until,created_at', 200);
    },
    async sampleFleetAssets() {
      return selectLimited('fleet_assets', 'id,empresa_id,unidade_operacional_id,status,created_at', 200);
    },
    async sampleFleetCompositions() {
      return selectLimited('vehicle_compositions', 'id,empresa_id,unidade_operacional_id,status,created_at', 200);
    },
  };
}

module.exports = { createSupabaseDiagnosticFacts };

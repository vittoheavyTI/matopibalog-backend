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

  async function selectLimitedOptional(table, columns, limit = 50) {
    try {
      return await selectLimited(table, columns, limit);
    } catch (err) {
      if (err && (
        err.code === '42P01' ||
        err.code === 'PGRST205' ||
        err.code === '42703' ||
        /does not exist|could not find|schema cache/i.test(err.message || '')
      )) {
        return [];
      }
      throw err;
    }
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
    async sampleCampaignPlanVersions() {
      return selectLimitedOptional('campaign_plan_versions', 'id,empresa_id,campaign_id,status,result_summary,resource_snapshot,generated_at', 200);
    },
    async sampleCampaignPlannedTrips() {
      return selectLimitedOptional('campaign_planned_trips', 'id,empresa_id,campaign_id,plan_version_id,scenario_id,demand_id,origin_location_id,destination_location_id,planned_quantity,required_capacity_kg,candidate_asset_id,candidate_composition_id,status', 500);
    },
    async sampleCampaignApprovals() {
      return selectLimitedOptional('campaign_approvals', 'id,empresa_id,campaign_id,plan_version_id,action,actor_user_id,occurred_at', 200);
    },
  };
}

module.exports = { createSupabaseDiagnosticFacts };

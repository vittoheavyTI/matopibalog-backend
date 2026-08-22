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
  };
}

module.exports = { createSupabaseDiagnosticFacts };

'use strict';

// Verifiability / diagnostics do ERP Hub (§12). READ-ONLY e PURO. Reporta o
// estado seguro do Hub sem executar nada e sem logar segredo. REPAIR/WRITE
// externo permanece DISABLED nesta fatia.

const { MODES, LIMITS, resolveMode, providerAvailable, isEnabled } = require('./config');
const { KNOWN_CAPABILITIES } = require('./capabilities');
const { KNOWN_RECONCILE_STATUSES } = require('./reconcile');
const {
  OUTBOX_STATUS, CLAIM_ACTION, DEFAULT_LEASE_MS,
  OUTBOX_PROVIDER_AUTHORITY, OUTBOX_DEDUPE_AUTHORITY, ERP_OUTBOX_AMBIGUOUS_RECOVERY,
} = require('./outboxContract');
const { SCHEMA_VERSION } = require('./canonicalEnvelope');
const { ERP_EVENT_IDENTITY, ERP_INTENT_FINGERPRINT } = require('./idempotency');
const gateway = require('./erpProviderGateway');

// Snapshot seguro do Hub. `entitlement` é opcional e injetado pela rota (estado
// técnico real da funcionalidade integracoes_erp), para o relatório ser honesto
// sem acoplar o domínio puro ao banco.
function buildHubDiagnostics({ entitlement = null } = {}) {
  const mode = resolveMode();
  return {
    hub: 'erp_integration_hub',
    version: 'E3.7A',
    // Estado operacional — em produção (disabled) tudo abaixo é inerte.
    mode,
    enabled: isEnabled(mode),
    provider_available: providerAvailable(mode),
    read_only: true,                 // nenhuma escrita externa nesta fatia
    production_inert: mode === MODES.DISABLED,
    // Contrato exposto (declarativo, estável).
    schema_version: SCHEMA_VERSION,
    provider_capabilities: gateway.capabilities({ mode }), // [] quando disabled
    known_capabilities: KNOWN_CAPABILITIES,
    reconcile_statuses: KNOWN_RECONCILE_STATUSES,
    outbox_statuses: Object.values(OUTBOX_STATUS),
    outbox_claim_actions: Object.values(CLAIM_ACTION),
    // R3-HIGH-01 — duas autoridades DISTINTAS e nomeadas: a identidade da ocorrência
    // lógica e a guarda de conflito de intenção. Nunca a mesma coisa.
    event_identity_authority: ERP_EVENT_IDENTITY,
    intent_fingerprint_role: ERP_INTENT_FINGERPRINT,
    outbox_provider_authority: OUTBOX_PROVIDER_AUTHORITY,
    outbox_dedupe_authority: OUTBOX_DEDUPE_AUTHORITY,
    outbox_ambiguous_recovery: ERP_OUTBOX_AMBIGUOUS_RECOVERY,
    // Linguagem precisa: a SEMÂNTICA de recuperação (lease + reclaim + recusa de
    // claim obsoleto) está definida e testada, mas sem persistência não há
    // crash-safety de produção — um crash do processo perde a fila.
    crash_safety: 'CRASH_SAFE_CONTRACT_DEFINED',
    outbox_lease_ms: DEFAULT_LEASE_MS,
    limits: LIMITS,
    // Estado comercial/técnico da funcionalidade ERP (preservado por esta frente).
    entitlement: entitlement || {
      codigo: 'integracoes_erp',
      technical_state: 'unknown',
      access: 'nao_implementada',
    },
    // Sinalização honesta para UX: NUNCA "conectado"/"sincronizando".
    display_status: 'em_preparacao',
  };
}

module.exports = { buildHubDiagnostics };

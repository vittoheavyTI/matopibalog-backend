'use strict';

// Verifiability / diagnostics do ERP Hub (§12). READ-ONLY e PURO. Reporta o
// estado seguro do Hub sem executar nada e sem logar segredo. REPAIR/WRITE
// externo permanece DISABLED nesta fatia.

const { MODES, LIMITS, resolveMode, providerAvailable, isEnabled } = require('./config');
const { KNOWN_CAPABILITIES } = require('./capabilities');
const { KNOWN_RECONCILE_STATUSES } = require('./reconcile');
const { OUTBOX_STATUS, DEFAULT_LEASE_MS } = require('./outboxContract');
const { SCHEMA_VERSION } = require('./canonicalEnvelope');
const { IDEMPOTENCY_EVENT_AUTHORITY } = require('./idempotency');
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
    idempotency_event_authority: IDEMPOTENCY_EVENT_AUTHORITY,
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

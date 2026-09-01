'use strict';

// Semântica de reconciliação (§9). Um reconcile deve distinguir 5 estados. A
// invariante mais importante da frente vive aqui:
//
//   UNKNOWN nunca vira SUCCEEDED.
//
// "Não sei" é um estado terminalmente honesto: promover UNKNOWN a SUCCEEDED
// registraria um efeito externo que talvez não aconteceu. O reconcile é
// determinístico e conservador.

const RECONCILE_STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',   // o ERP não conhece este envio → seguro reenviar
  PENDING: 'PENDING',       // em processamento no ERP → aguardar
  SUCCEEDED: 'SUCCEEDED',   // confirmado pelo ERP
  FAILED: 'FAILED',         // recusado pelo ERP → decidir reenvio
  UNKNOWN: 'UNKNOWN',       // não foi possível determinar → NUNCA promover
});

const KNOWN = Object.freeze(Object.values(RECONCILE_STATUS));

function isReconcileStatus(s) {
  return typeof s === 'string' && KNOWN.includes(s);
}

// Normaliza uma resposta arbitrária do adapter para um estado canônico. Qualquer
// coisa não reconhecida colapsa em UNKNOWN (falha segura, nunca SUCCEEDED).
function normalizeReconcile(raw) {
  if (isReconcileStatus(raw)) return raw;
  return RECONCILE_STATUS.UNKNOWN;
}

// Só estes estados autorizam marcar o item do outbox como processado com sucesso.
// UNKNOWN e PENDING explicitamente NÃO autorizam.
function canPromoteToSucceeded(status) {
  return status === RECONCILE_STATUS.SUCCEEDED;
}

// Reenviar é seguro apenas quando o ERP comprovadamente não conhece o envio.
// PENDING/UNKNOWN NÃO autorizam reenvio (risco de efeito duplicado).
function safeToRetry(status) {
  return status === RECONCILE_STATUS.NOT_FOUND || status === RECONCILE_STATUS.FAILED;
}

module.exports = {
  RECONCILE_STATUS,
  KNOWN_RECONCILE_STATUSES: KNOWN,
  isReconcileStatus,
  normalizeReconcile,
  canPromoteToSucceeded,
  safeToRetry,
};

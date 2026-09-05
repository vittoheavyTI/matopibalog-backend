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

// HIGH-05 — reenviar é seguro apenas quando o ERP comprovadamente NÃO conhece o
// envio (NOT_FOUND). Todos os demais estados negam por padrão.
//
// R3-HIGH-04 — esta função é CONSULTADA PELA MÁQUINA DE OUTBOX (`recordReconcile`),
// não é um helper opcional ao lado dela. Na R2 o outbox tinha um critério próprio
// (`next_retry_at` vencido ⇒ elegível para envio) que contradizia esta política em
// silêncio: bastava um `markFailed` genérico e o backoff para o item ser reenviado
// sem evidência nenhuma. Autoridade única, aplicada no único lugar que decide.
//
// FAILED **não** é genericamente seguro, e essa foi a correção: provider-agnostic,
// "falhou" pode significar tanto "o ERP recusou e nada foi aplicado" quanto "o ERP
// aplicou o efeito e a resposta se perdeu no transporte". Reenviar no segundo caso
// duplica um efeito de negócio real. Como o Hub não pode distinguir os dois sem o
// provider dizer, o default é NÃO reenviar.
//
// Um provider futuro que consiga provar a distinção informa evidência explícita:
//   safeToRetry(FAILED, { retry_safe: true })
// Isso mantém o contrato desacoplado (o Hub não conhece fornecedor nenhum) e coloca
// o ônus da prova em quem tem a informação. Qualquer outro valor é ignorado.
function safeToRetry(status, evidence = null) {
  if (status === RECONCILE_STATUS.NOT_FOUND) return true;
  if (status === RECONCILE_STATUS.FAILED) {
    return Boolean(evidence && evidence.retry_safe === true);
  }
  return false; // PENDING, UNKNOWN, SUCCEEDED e desconhecidos
}

module.exports = {
  RECONCILE_STATUS,
  KNOWN_RECONCILE_STATUSES: KNOWN,
  isReconcileStatus,
  normalizeReconcile,
  canPromoteToSucceeded,
  safeToRetry,
};

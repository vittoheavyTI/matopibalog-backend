// backend/utils/webhookHash.js
// Hash canônico mínimo para idempotência do webhook Asaas.
// Usa SHA-256 sobre um subconjunto determinístico de campos do evento.
// NÃO armazena payload bruto, PII, token, cartão, QR/Pix ou documento.

const crypto = require('crypto');

// Campos considerados no hash canônico. Ordem alfabética fixa para determinismo.
// Ausência de campo é representada como string vazia (estável).
// NÃO inclui: customer, externalReference, subscription completo,
// email, documento, telefone, cartão, QR/Pix, split, address.
const CAMPOS_HASH = [
  'billingType',
  'confirmedDate',
  'dueDate',
  'event_type',
  'event_id',
  'payment_id',
  'paymentDate',
  'status',
  'subscription', // apenas o ID da subscription do payment (string), não o objeto
];

function valorEstavel(obj, campo) {
  if (obj == null) return '';
  const v = obj[campo];
  if (v == null) return '';
  return String(v).trim();
}

function extrairSubscriptionId(payment) {
  if (!payment || payment.subscription == null) return '';
  // subscription pode vir como string (id) ou objeto { id: 'sub_...' }
  if (typeof payment.subscription === 'string') return payment.subscription.trim();
  if (typeof payment.subscription === 'object' && payment.subscription.id) {
    return String(payment.subscription.id).trim();
  }
  return '';
}

/**
 * Calcula o hash canônico de um evento de webhook normalizado.
 *
 * @param {object} normalizado - Objeto com { event_id, event_type, payment?, payment_id? }
 * @returns {string} Hash SHA-256 hex (64 caracteres)
 */
function calcularPayloadHash(normalizado) {
  const payment = normalizado.payment || {};

  // Valores em ordem determinística (CAMPOS_HASH em ordem alfabética)
  const partes = CAMPOS_HASH.map((campo) => {
    switch (campo) {
      case 'billingType':
        return valorEstavel(payment, 'billingType');
      case 'confirmedDate':
        return valorEstavel(payment, 'confirmedDate');
      case 'dueDate':
        return valorEstavel(payment, 'dueDate');
      case 'event_type':
        return valorEstavel(normalizado, 'event_type');
      case 'event_id':
        return valorEstavel(normalizado, 'event_id');
      case 'payment_id':
        return valorEstavel(normalizado, 'payment_id') || valorEstavel(payment, 'id');
      case 'paymentDate':
        return valorEstavel(payment, 'paymentDate');
      case 'status':
        return valorEstavel(payment, 'status');
      case 'subscription':
        return extrairSubscriptionId(payment);
      default:
        return '';
    }
  });

  // Junta com separador | (pipe não aparece em valores normais dos campos)
  const canonico = partes.join('|');
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

module.exports = { calcularPayloadHash, CAMPOS_HASH };
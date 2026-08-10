// Máquina de estados PURA para aplicar um evento de webhook a uma fatura local
// (macrofrente 3A-2). Tolerante a eventos FORA DE ORDEM (§21) e idempotente (§20):
// um evento antigo (ex.: PENDING) que chega depois de um estado mais novo (ex.:
// RECEBIDO) NÃO regride o estado. Mesmo evento aplicado N vezes → mesmo resultado.
//
// A DEDUPLICAÇÃO por event_id já é feita pelo asaasWebhookEventRepository; este
// serviço decide a TRANSIÇÃO de status da fatura de forma segura.

// Status canônicos locais + ranking. Avançar de rank é permitido; regredir não.
const STATUS_LOCAL = Object.freeze({
  PENDENTE: 'pendente',
  VENCIDO: 'vencido',
  PAGO: 'pago',
  ESTORNADO: 'estornado',
  CANCELADO: 'cancelado',
});

const RANK = Object.freeze({
  pendente: 1,
  vencido: 2,
  pago: 3,
  // Estados terminais de correção (refund/cancel) ficam acima de "pago" para
  // poderem corrigir um pagamento já registrado.
  estornado: 4,
  cancelado: 4,
});

// Mapeia o status/evento do Asaas para o status local canônico.
function mapearStatusAsaas(evento, statusPagamento) {
  const ev = String(evento || '').toUpperCase();
  const st = String(statusPagamento || '').toUpperCase();
  if (ev === 'PAYMENT_REFUNDED' || st === 'REFUNDED') return STATUS_LOCAL.ESTORNADO;
  if (ev === 'PAYMENT_DELETED' || st === 'DELETED') return STATUS_LOCAL.CANCELADO;
  if (ev === 'PAYMENT_RECEIVED' || st === 'RECEIVED' || ev === 'PAYMENT_CONFIRMED' || st === 'CONFIRMED') return STATUS_LOCAL.PAGO;
  if (ev === 'PAYMENT_OVERDUE' || st === 'OVERDUE') return STATUS_LOCAL.VENCIDO;
  if (ev === 'PAYMENT_CREATED' || st === 'PENDING' || st === 'AWAITING_RISK_ANALYSIS') return STATUS_LOCAL.PENDENTE;
  return null; // evento não relevante para status
}

// Decide a transição. Recebe:
//   faturaAtual : { status } (status local atual) | null
//   evento      : { event, payment: { status } }
// Devolve { novoStatus, mudou, ignorado, motivo }.
function aplicarEvento({ faturaAtual, evento } = {}) {
  const atual = (faturaAtual && faturaAtual.status) ? String(faturaAtual.status) : STATUS_LOCAL.PENDENTE;
  const alvo = mapearStatusAsaas(evento?.event, evento?.payment?.status);

  if (!alvo) {
    return { novoStatus: atual, mudou: false, ignorado: true, motivo: 'evento_irrelevante' };
  }
  if (alvo === atual) {
    return { novoStatus: atual, mudou: false, ignorado: true, motivo: 'idempotente_mesmo_status' };
  }

  const rankAtual = RANK[atual] ?? 0;
  const rankAlvo = RANK[alvo] ?? 0;

  // Regressão proibida: evento fora de ordem não desfaz estado mais novo.
  // Exceção: correções terminais (estorno/cancelamento) sempre podem aplicar.
  const correcaoTerminal = alvo === STATUS_LOCAL.ESTORNADO || alvo === STATUS_LOCAL.CANCELADO;
  if (rankAlvo < rankAtual && !correcaoTerminal) {
    return { novoStatus: atual, mudou: false, ignorado: true, motivo: 'fora_de_ordem_ignorado' };
  }

  return { novoStatus: alvo, mudou: true, ignorado: false, motivo: `transicao:${atual}->${alvo}` };
}

module.exports = {
  STATUS_LOCAL,
  RANK,
  mapearStatusAsaas,
  aplicarEvento,
};

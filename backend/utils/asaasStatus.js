// backend/utils/asaasStatus.js
// Normalização do status de um PAGAMENTO (payment) do Asaas para o vocabulário
// interno da tabela `faturas`. Função pura (sem DB/rede) para teste isolado.
//
// A tabela `faturas.status` tem CHECK que só aceita:
//   'pendente' | 'pago' | 'vencido' | 'cancelado' | 'estornado'
// O Asaas devolve o status do pagamento em inglês/maiúsculas (ex.: 'PENDING').
// Gravar o valor cru violaria o CHECK (erro 23514). Esta função faz a ponte.
//
// IMPORTANTE — escopo: isto mapeia o STATUS de um payment (usado na criação e na
// conciliação, que leem payment.status). O webhook trabalha com EVENTOS
// (PAYMENT_CONFIRMED, PAYMENT_OVERDUE, ...), que são um vocabulário diferente e
// permanecem mapeados no próprio webhook. Não confundir os dois.

// Mapa de status de payment do Asaas → status interno da fatura.
// Referência: estados usuais da API de cobranças do Asaas.
const MAPA_STATUS_ASAAS = {
  PENDING: 'pendente',            // aguardando pagamento
  AWAITING_RISK_ANALYSIS: 'pendente', // cartão em análise antifraude
  RECEIVED: 'pago',              // recebido
  CONFIRMED: 'pago',             // confirmado (compensação em andamento)
  RECEIVED_IN_CASH: 'pago',      // baixado como recebido em dinheiro
  OVERDUE: 'vencido',            // vencido
  DELETED: 'cancelado',          // cobrança removida
  REFUNDED: 'estornado',         // estornado
  REFUND_REQUESTED: 'estornado', // estorno solicitado
  REFUND_IN_PROGRESS: 'estornado', // estorno em processamento
};

// Recebe o status cru do Asaas e devolve o status interno válido para `faturas`.
// - Case-insensitive e tolerante a espaços.
// - Status desconhecido/ausente → 'pendente' (default seguro): nunca viola o
//   CHECK e é o estado de menor privilégio — não libera nem suspende empresa por
//   engano. A conciliação/webhook só promovem a empresa em status explícitos.
function normalizarStatusAsaas(status) {
  if (typeof status !== 'string') return 'pendente';
  const chave = status.trim().toUpperCase();
  return MAPA_STATUS_ASAAS[chave] || 'pendente';
}

module.exports = { normalizarStatusAsaas, MAPA_STATUS_ASAAS };

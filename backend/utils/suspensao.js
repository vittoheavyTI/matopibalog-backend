// Metadados de suspensão financeira automática (migration 024).
// A reativação pós-pagamento (paymentDomainService.decidirTransicaoContaPorPagamento)
// SÓ reativa suspensão com reason='financial' e source automático — portanto todo
// caminho que suspende automaticamente por inadimplência PRECISA gravar estes
// campos, senão a empresa paga e continua suspensa. Mesmo shape usado pelo
// webhook (asaasWebhookService).

function patchSuspensaoFinanceiraAutomatica(agora = new Date()) {
  return {
    status: 'suspenso',
    suspension_reason: 'financial',
    suspension_source: 'automatic',
    suspended_at: agora.toISOString(),
    suspended_by: null,
  };
}

function patchLimparSuspensao() {
  return {
    suspension_reason: null,
    suspension_source: null,
    suspended_at: null,
    suspended_by: null,
  };
}

module.exports = { patchSuspensaoFinanceiraAutomatica, patchLimparSuspensao };

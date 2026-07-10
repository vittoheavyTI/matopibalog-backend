const STATUS_FATURA = new Set(['pendente', 'pago', 'vencido', 'cancelado', 'estornado']);

const STATUS_ASAAS = {
  PENDING: 'pendente',
  AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'pago',
  CONFIRMED: 'pago',
  RECEIVED_IN_CASH: 'pago',
  OVERDUE: 'vencido',
  DELETED: 'cancelado',
  CANCELED: 'cancelado',
  CANCELLED: 'cancelado',
  REFUNDED: 'estornado',
  REFUND_REQUESTED: 'estornado',
  REFUND_IN_PROGRESS: 'estornado',
};

const EVENTOS_ASAAS = {
  PAYMENT_RECEIVED: 'pago',
  PAYMENT_CONFIRMED: 'pago',
  PAYMENT_OVERDUE: 'vencido',
  PAYMENT_CANCELED: 'cancelado',
  PAYMENT_DELETED: 'cancelado',
  PAYMENT_REFUNDED: 'estornado',
};

function statusAnteriorSeguro(statusAtual) {
  return STATUS_FATURA.has(statusAtual) ? statusAtual : 'pendente';
}

function normalizarStatusAsaas(rawStatus, statusAtual = 'pendente') {
  const anterior = statusAnteriorSeguro(statusAtual);
  if (typeof rawStatus !== 'string') {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'status_ausente' };
  }

  const chave = rawStatus.trim().toUpperCase();
  const status = STATUS_ASAAS[chave];
  if (!status) {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'status_desconhecido' };
  }

  return { status, conhecido: true, ignorado: false, razao: `status_${chave.toLowerCase()}` };
}

function normalizarEventoAsaas(eventType, statusAtual = 'pendente') {
  const anterior = statusAnteriorSeguro(statusAtual);
  if (typeof eventType !== 'string') {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'evento_ausente' };
  }

  const chave = eventType.trim().toUpperCase();
  const status = EVENTOS_ASAAS[chave];
  if (!status) {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'evento_desconhecido' };
  }

  return { status, conhecido: true, ignorado: false, razao: `evento_${chave.toLowerCase()}` };
}

function decidirAtualizacaoFatura({ statusAtual, statusNovo, pagoEmAtual, pagoEmDetectado, agora = new Date() }) {
  const atual = statusAnteriorSeguro(statusAtual);
  if (!STATUS_FATURA.has(statusNovo)) {
    return { ignorar: true, update: null, statusFinal: atual, razao: 'status_novo_invalido' };
  }

  if (atual === 'pago' && (statusNovo === 'vencido' || statusNovo === 'cancelado')) {
    return { ignorar: true, update: null, statusFinal: atual, razao: 'nao_rebaixar_fatura_paga' };
  }

  const update = { status: statusNovo };
  if (statusNovo === 'pago' && !pagoEmAtual) {
    update.pago_em = pagoEmDetectado || agora.toISOString();
  }

  return { ignorar: false, update, statusFinal: statusNovo, razao: `fatura_${statusNovo}` };
}

function decidirTransicaoContaPorPagamento(statusConta, statusFatura) {
  const status = statusConta || null;
  if (statusFatura !== 'pago') {
    return { deveAtualizar: false, novoStatus: status, razao: 'fatura_nao_paga' };
  }

  if (status === 'trial') {
    return { deveAtualizar: true, novoStatus: 'ativo', razao: 'trial_pago_ativado' };
  }

  if (status === 'ativo') {
    return { deveAtualizar: false, novoStatus: 'ativo', razao: 'conta_ativa_preservada' };
  }

  // Bloco A ainda nao diferencia suspensao financeira de administrativa/manual.
  if (['suspenso', 'bloqueado', 'expirado'].includes(status)) {
    return { deveAtualizar: false, novoStatus: status, razao: `conta_${status}_preservada` };
  }

  return { deveAtualizar: false, novoStatus: status, razao: 'status_conta_sem_transicao' };
}

function dataISO(data) {
  if (!data) return null;
  if (data instanceof Date && !Number.isNaN(data.getTime())) return data.toISOString().slice(0, 10);
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data)) return data.slice(0, 10);
  const parsed = new Date(data);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function avaliarElegibilidadeSuspensao({ empresa, fatura, hoje = new Date(), erroConsulta = null } = {}) {
  if (erroConsulta) return { elegivel: false, razao: 'fail_safe_erro_consulta' };
  if (!empresa || !empresa.id) return { elegivel: false, razao: 'empresa_ausente' };
  if (!fatura) return { elegivel: false, razao: 'fatura_ausente' };
  if (fatura.empresa_id && fatura.empresa_id !== empresa.id) {
    return { elegivel: false, razao: 'fatura_outro_tenant' };
  }
  if (!['pendente', 'vencido'].includes(fatura.status)) {
    return { elegivel: false, razao: 'status_fatura_nao_elegivel' };
  }
  if (empresa.status === 'trial') {
    const trialFim = dataISO(empresa.trial_ends_at);
    const hojeStr = dataISO(hoje);
    if (!trialFim || trialFim >= hojeStr) return { elegivel: false, razao: 'trial_ativo' };
  }

  const dueDate = dataISO(fatura.due_date);
  const hojeStr = dataISO(hoje);
  if (!dueDate) return { elegivel: false, razao: 'vencimento_ausente' };
  if (dueDate >= hojeStr) return { elegivel: false, razao: 'vencimento_nao_passado' };
  if (!fatura.invoice_url && !fatura.bank_slip_url) {
    return { elegivel: false, razao: 'sem_caminho_regularizacao' };
  }

  return { elegivel: true, razao: 'fatura_vencida_com_regularizacao' };
}

function decidirSuspensaoPorInadimplencia({ empresa, fatura, hoje, erroConsulta } = {}) {
  const elegibilidade = avaliarElegibilidadeSuspensao({ empresa, fatura, hoje, erroConsulta });
  if (!elegibilidade.elegivel) {
    return { deveSuspender: false, novoStatus: empresa?.status || null, razao: elegibilidade.razao };
  }

  if (!['trial', 'ativo'].includes(empresa.status)) {
    return { deveSuspender: false, novoStatus: empresa.status, razao: `conta_${empresa.status}_preservada` };
  }

  return { deveSuspender: true, novoStatus: 'suspenso', razao: elegibilidade.razao };
}

module.exports = {
  normalizarStatusAsaas,
  normalizarEventoAsaas,
  decidirAtualizacaoFatura,
  decidirTransicaoContaPorPagamento,
  avaliarElegibilidadeSuspensao,
  decidirSuspensaoPorInadimplencia,
  STATUS_ASAAS,
  EVENTOS_ASAAS,
};

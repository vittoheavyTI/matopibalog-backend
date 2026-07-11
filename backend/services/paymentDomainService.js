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
  REFUND_IN_PROGRESS: null,
};

const EVENTOS_ASAAS = {
  // Criação/atualização
  PAYMENT_CREATED: 'pendente',
  PAYMENT_UPDATED: null, // não altera status sozinho — verifica status do payment
  PAYMENT_RESTORED: null, // restaura baseado no status atual do payment

  // Pagamento
  PAYMENT_CONFIRMED: 'pago',
  PAYMENT_RECEIVED: 'pago',

  // Inadimplência
  PAYMENT_OVERDUE: 'vencido',

  // Cancelamento
  PAYMENT_DELETED: 'cancelado',

  // Estorno
  PAYMENT_REFUNDED: 'estornado',
  PAYMENT_PARTIALLY_REFUNDED: null, // não é estorno integral — só atualiza asaas_raw_status
  PAYMENT_REFUND_IN_PROGRESS: null, // não é estorno definitivo
  PAYMENT_REFUND_DENIED: null, // estorno negado, não altera status
  PAYMENT_RECEIVED_IN_CASH_UNDONE: null, // desfaz baixa em dinheiro, preserva status anterior

  // Chargeback
  PAYMENT_CHARGEBACK_REQUESTED: null,
  PAYMENT_CHARGEBACK_DISPUTE: null,
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: null,
};

// Eventos conhecidos mas que não mapeiam para status de fatura.
// Devem ser persistidos e marcados como processed_without_transition.
const EVENTOS_SEM_TRANSICAO = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_RESTORED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

// Eventos que são reconhecidos mas não têm ação financeira.
const EVENTOS_RECONHECIDOS = new Set(Object.keys(EVENTOS_ASAAS));

function statusAnteriorSeguro(statusAtual) {
  return STATUS_FATURA.has(statusAtual) ? statusAtual : 'pendente';
}

function normalizarStatusAsaas(rawStatus, statusAtual = 'pendente') {
  const anterior = statusAnteriorSeguro(statusAtual);
  if (typeof rawStatus !== 'string') {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'status_ausente' };
  }

  const chave = rawStatus.trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(STATUS_ASAAS, chave) || !STATUS_ASAAS[chave]) {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'status_desconhecido' };
  }

  return { status: STATUS_ASAAS[chave], conhecido: true, ignorado: false, razao: `status_${chave.toLowerCase()}` };
}

function normalizarEventoAsaas(eventType, statusAtual = 'pendente') {
  const anterior = statusAnteriorSeguro(statusAtual);
  if (typeof eventType !== 'string') {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'evento_ausente' };
  }

  const chave = eventType.trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(EVENTOS_ASAAS, chave)) {
    return { status: anterior, conhecido: false, ignorado: true, razao: 'evento_desconhecido' };
  }

  return { status: EVENTOS_ASAAS[chave], conhecido: true, ignorado: false, razao: `evento_${chave.toLowerCase()}` };
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

/**
 * Decide se uma conta deve ser reativada após pagamento.
 * Agora diferencia suspensão financeira (reativável) de administrativa/segurança/legado (não reativável).
 *
 * @param {string|null} statusConta - Status atual da empresa
 * @param {string} statusFatura - Status final da fatura após evento
 * @param {object} [opts] - Opções adicionais
 * @param {string|null} [opts.suspensionReason] - Motivo da suspensão (financial, administrative, security, legacy_unknown)
 * @returns {{ deveAtualizar: boolean, novoStatus: string|null, razao: string, deveLimparSuspensao?: boolean }}
 */
function decidirTransicaoContaPorPagamento(statusConta, statusFatura, opts = {}) {
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

  if (status === 'suspenso') {
    const reason = opts.suspensionReason || null;
    const source = opts.suspensionSource || null;

    // Suspensão financeira automática: reativa e limpa metadados.
    if (reason === 'financial' && (source === 'automatic' || source === null)) {
      return {
        deveAtualizar: true,
        novoStatus: 'ativo',
        razao: 'suspensao_financeira_reativada',
        deveLimparSuspensao: true,
      };
    }

    // Suspensão administrativa, segurança, legacy_unknown ou manual:
    // não reativar automaticamente.
    return {
      deveAtualizar: false,
      novoStatus: status,
      razao: `suspensao_${reason || 'motivo_desconhecido'}_preservada`,
    };
  }

  // Bloqueado, expirado: nunca reativar automaticamente.
  if (['bloqueado', 'expirado'].includes(status)) {
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

/**
 * Decide a transição de fatura e conta a partir de um evento de webhook.
 * Função combinada que normaliza o evento, aplica precedência e retorna
 * as ações necessárias para fatura e empresa.
 *
 * @param {object} params
 * @param {string} params.eventType - Tipo do evento Asaas (ex: PAYMENT_CONFIRMED)
 * @param {object} params.fatura - Fatura atual { status, pago_em, due_date, empresa_id }
 * @param {object} [params.empresa] - Empresa atual { status, suspension_reason, suspension_source }
 * @param {string} [params.paymentStatus] - Status do payment (para PAYMENT_UPDATED/RESTORED)
 * @param {string} [params.pagoEmDetectado] - Data de pagamento do payload
 * @returns {{
 *   conhecido: boolean,
 *   acaoFinanceira: boolean,
 *   fatura?: { ignorar: boolean, update: object|null, statusFinal: string|null, razao: string },
 *   empresa?: { deveAtualizar: boolean, novoStatus: string|null, razao: string, deveLimparSuspensao?: boolean, deveSuspender?: boolean },
 *   razao: string,
 * }}
 */
function decidirTransicaoFaturaEvento({ eventType, fatura, empresa, paymentStatus, pagoEmDetectado }) {
  const evento = normalizarEventoAsaas(eventType, fatura?.status);
  if (!evento.conhecido) {
    return { conhecido: false, acaoFinanceira: false, razao: evento.razao };
  }

  // Eventos sem mapeamento de status direto (criacao, atualizacao, restauracao,
  // estorno parcial, chargeback): não alteram status da fatura.
  if (EVENTOS_SEM_TRANSICAO.has(eventType)) {
    // PAYMENT_UPDATED e PAYMENT_RESTORED: podem ter payment.status atualizado
    if ((eventType === 'PAYMENT_UPDATED' || eventType === 'PAYMENT_RESTORED') && paymentStatus) {
      const statusViaPayment = normalizarStatusAsaas(paymentStatus, fatura?.status);
      if (statusViaPayment.conhecido) {
        const decisao = decidirAtualizacaoFatura({
          statusAtual: fatura?.status,
          statusNovo: statusViaPayment.status,
          pagoEmAtual: fatura?.pago_em,
          pagoEmDetectado,
        });
        const acaoEmpresa = processarAcaoEmpresa(decisao, empresa, fatura);
        return { conhecido: true, acaoFinanceira: !decisao.ignorar, fatura: decisao, empresa: acaoEmpresa, razao: decisao.razao };
      }
    }

    return { conhecido: true, acaoFinanceira: false, razao: `sem_transicao_${eventType.toLowerCase()}` };
  }

  // Eventos com mapeamento direto de status
  const statusNovo = evento.status;
  const decisao = decidirAtualizacaoFatura({
    statusAtual: fatura?.status,
    statusNovo,
    pagoEmAtual: fatura?.pago_em,
    pagoEmDetectado,
  });

  const acaoEmpresa = processarAcaoEmpresa(decisao, empresa, fatura);

  return { conhecido: true, acaoFinanceira: !decisao.ignorar, fatura: decisao, empresa: acaoEmpresa, razao: decisao.razao };
}

/**
 * Processa a ação na empresa baseada na decisão da fatura.
 */
function processarAcaoEmpresa(decisaoFatura, empresa, fatura) {
  if (decisaoFatura.ignorar) return null;
  if (!fatura?.empresa_id || !empresa) return null;

  if (decisaoFatura.statusFinal === 'pago') {
    return decidirTransicaoContaPorPagamento(empresa.status, 'pago', {
      suspensionReason: empresa.suspension_reason,
      suspensionSource: empresa.suspension_source,
    });
  }

  if (decisaoFatura.statusFinal === 'vencido') {
    const decisaoSusp = decidirSuspensaoPorInadimplencia({
      empresa,
      fatura: { ...fatura, status: decisaoFatura.statusFinal },
    });
    if (decisaoSusp.deveSuspender) {
      return {
        deveAtualizar: true,
        novoStatus: decisaoSusp.novoStatus,
        razao: decisaoSusp.razao,
        deveSuspender: true,
      };
    }
  }

  return null;
}

module.exports = {
  normalizarStatusAsaas,
  normalizarEventoAsaas,
  decidirAtualizacaoFatura,
  decidirTransicaoContaPorPagamento,
  decidirTransicaoFaturaEvento,
  avaliarElegibilidadeSuspensao,
  decidirSuspensaoPorInadimplencia,
  STATUS_ASAAS,
  EVENTOS_ASAAS,
  EVENTOS_SEM_TRANSICAO,
  EVENTOS_RECONHECIDOS,
};

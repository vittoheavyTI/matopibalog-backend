// backend/services/asaasInvoiceSyncService.js
// Sincronização de cobranças da assinatura Asaas com a tabela local faturas.
//
// Responsabilidades:
//   1. Receber empresa autorizada com asaas_subscription_id.
//   2. Consultar GET /v3/subscriptions/{id}/payments no Asaas.
//   3. Fazer upsert local pelo asaas_id (payment.id).
//   4. Nunca duplicar, nunca apagar faturas locais.
//   5. Preservar cobranças manuais (sem asaas_subscription_id ou criadas pelo
//      POST /pagamentos/cobrancas).
//   6. Retornar resumo sanitizado (sem PII, sem IDs Asaas).
//
// Injeção de dependências (supabase, http, config) para testabilidade.
// NÃO loga nem retorna: apiKey, Authorization, CPF/CNPJ, e-mail, telefone.

const STATUS_MAP = {
  PENDING: 'pendente',
  AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'pago',
  CONFIRMED: 'pago',
  RECEIVED_IN_CASH: 'pago',
  OVERDUE: 'vencido',
  DELETED: 'cancelado',
  REFUNDED: 'estornado',
  REFUND_REQUESTED: 'estornado',
  REFUND_IN_PROGRESS: 'estornado',
};

function normalizarStatus(raw) {
  if (typeof raw !== 'string') return 'pendente';
  return STATUS_MAP[raw.trim().toUpperCase()] || 'pendente';
}

function headers(apiKey) {
  return { access_token: apiKey, 'Content-Type': 'application/json' };
}

function erroAsaas(err) {
  const status = err?.response?.status;
  const e = new Error('Falha ao consultar cobranças no Asaas.');
  e.httpStatus = status && status >= 400 && status < 500 ? 422 : 500;
  return e;
}

async function buscarPayments(http, config, subscriptionId) {
  try {
    const { data } = await http.get(
      `${config.baseURL}/subscriptions/${subscriptionId}/payments`,
      { headers: headers(config.apiKey) }
    );
    return data?.data || [];
  } catch (err) {
    throw erroAsaas(err);
  }
}

async function upsertFatura(supabase, empresaId, subscriptionId, payment) {
  const asaasId = payment.id;
  if (!asaasId) return { acao: 'ignorado' };

  const rawStatus = String(payment.status || '').toUpperCase();
  const statusLocal = normalizarStatus(rawStatus);

  const faturaData = {
    empresa_id: empresaId,
    asaas_id: asaasId,
    asaas_subscription_id: subscriptionId,
    asaas_raw_status: rawStatus,
    asaas_description: payment.description || null,
    valor: Number(payment.value) || 0,
    tipo_pagamento: (payment.billingType === 'BOLETO' || payment.billingType === 'PIX' || payment.billingType === 'CREDIT_CARD')
      ? payment.billingType : 'BOLETO',
    status: statusLocal,
    invoice_url: payment.invoiceUrl || null,
    bank_slip_url: payment.bankSlipUrl || null,
    due_date: payment.dueDate || payment.nextDueDate || null,
    last_synced_at: new Date().toISOString(),
  };

  // Se já recebido/confirmado, preenche pago_em na primeira detecção
  if ((rawStatus === 'RECEIVED' || rawStatus === 'CONFIRMED' || rawStatus === 'RECEIVED_IN_CASH') && payment.paymentDate) {
    faturaData.pago_em = payment.paymentDate;
  }

  // Upsert pelo asaas_id: encontra existente ou insere
  const { data: existente } = await supabase
    .from('faturas')
    .select('id, status, invoice_url, bank_slip_url, pago_em')
    .eq('asaas_id', asaasId)
    .maybeSingle();

  if (existente) {
    // Atualiza status, URLs e data de pagamento se mudaram
    const update = { last_synced_at: faturaData.last_synced_at };

    if (existente.status !== statusLocal) update.status = statusLocal;
    if (existente.invoice_url !== faturaData.invoice_url) update.invoice_url = faturaData.invoice_url;
    if (existente.bank_slip_url !== faturaData.bank_slip_url) update.bank_slip_url = faturaData.bank_slip_url;
    if (faturaData.pago_em && !existente.pago_em) update.pago_em = faturaData.pago_em;

    // Só grava se algo mudou
    if (Object.keys(update).length > 1 || update.last_synced_at) {
      await supabase.from('faturas').update(update).eq('id', existente.id);
      return { acao: 'atualizada' };
    }
    return { acao: 'inalterada' };
  }

  // Nova fatura
  await supabase.from('faturas').insert(faturaData);
  return { acao: 'criada' };
}

/**
 * Sincroniza as cobranças da assinatura Asaas com a tabela local faturas.
 *
 * @param {object} deps
 * @param {string} deps.empresaId   - UUID da empresa
 * @param {object} deps.config      - { apiKey, baseURL }
 * @param {object} deps.supabase    - cliente Supabase
 * @param {object} deps.http        - axios ou similar
 * @param {string} deps.subscriptionId - asaas_subscription_id (se já conhecida)
 * @returns {{ empresa_id: string, encontradas: number, criadas: number, atualizadas: number, inalteradas: number }}
 */
async function sincronizarCobrancas({ empresaId, config, supabase, http, subscriptionId }) {
  let subId = subscriptionId;

  // Se não foi passada, busca no banco
  if (!subId) {
    const { data: empresa } = await supabase
      .from('empresas')
      .select('asaas_subscription_id')
      .eq('id', empresaId)
      .single();

    if (!empresa?.asaas_subscription_id) {
      return {
        empresa_id: empresaId,
        encontradas: 0,
        criadas: 0,
        atualizadas: 0,
        inalteradas: 0,
        mensagem: 'Nenhuma assinatura configurada.',
      };
    }
    subId = empresa.asaas_subscription_id;
  }

  const payments = await buscarPayments(http, config, subId);
  const resultados = await Promise.all(
    payments.map((p) => upsertFatura(supabase, empresaId, subId, p))
  );

  const encontradas = payments.length;
  const criadas = resultados.filter((r) => r.acao === 'criada').length;
  const atualizadas = resultados.filter((r) => r.acao === 'atualizada').length;
  const inalteradas = resultados.filter((r) => r.acao === 'inalterada').length;

  return {
    empresa_id: empresaId,
    encontradas,
    criadas,
    atualizadas,
    inalteradas,
  };
}

module.exports = { sincronizarCobrancas, normalizarStatus };

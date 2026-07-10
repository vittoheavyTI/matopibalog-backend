// backend/services/asaasWebhookEventRepository.js
// Repository de eventos do webhook Asaas.
// Responsável apenas por persistência e recuperação de eventos;
// NÃO contém regra financeira (processamento fica no asaasWebhookService.js).
//
// Injeção de dependência: recebe supabase como parâmetro para testabilidade.

const { calcularPayloadHash } = require('../utils/webhookHash');

// Limite de tempo (ms) para considerar um processing abandonado.
const PROCESSING_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

const STATUS = {
  RECEIVED: 'received',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  IGNORED: 'ignored',
  FAILED: 'failed',
};

/**
 * Normaliza o objeto do evento extraindo campos mínimos para hash.
 * Retorna objeto normalizado { event_id, event_type, payment_id, payment }
 * sem payload bruto, sem PII, sem cartão, sem documento.
 */
function normalizarParaHash(body) {
  const payment = body.payment || {};
  return {
    event_id: String(body.id || ''),
    event_type: String(body.event || ''),
    payment_id: payment.id ? String(payment.id) : '',
    payment: {
      id: payment.id ? String(payment.id) : undefined,
      status: payment.status ? String(payment.status) : undefined,
      billingType: payment.billingType ? String(payment.billingType) : undefined,
      dueDate: payment.dueDate ? String(payment.dueDate) : undefined,
      paymentDate: payment.paymentDate ? String(payment.paymentDate) : undefined,
      confirmedDate: payment.confirmedDate ? String(payment.confirmedDate) : undefined,
      subscription: payment.subscription || undefined,
    },
  };
}

/**
 * Tenta inserir um novo evento no banco.
 *
 * @param {object} supabase - Cliente Supabase (service_role)
 * @param {object} body - Payload bruto do webhook Asaas
 * @param {object} normalizado - Objeto normalizado (de normalizarParaHash)
 * @returns {Promise<{evento?: object, status: string, code: string}>}
 *   code: 'inserted' | 'conflict_processed' | 'conflict_ignored' | 'conflict_processing' |
 *         'conflict_failed_claimed' | 'conflict_received_claimed' | 'conflict_stale_claimed'
 */
async function inserirOuReivindicar(supabase, body, normalizado) {
  if (!normalizado) {
    normalizado = normalizarParaHash(body);
  }

  const payloadHash = calcularPayloadHash(normalizado);
  const eventId = normalizado.event_id;
  const eventType = normalizado.event_type;
  const asaasPaymentId = normalizado.payment_id || null;

  // 1. Tentativa de INSERT direto. O índice UNIQUE em event_id é a autoridade.
  const { data: inserido, error: insertError } = await supabase
    .from('asaas_webhook_events')
    .insert({
      event_id: eventId,
      event_type: eventType,
      asaas_payment_id: asaasPaymentId,
      payload_hash: payloadHash,
      status: STATUS.PROCESSING,
      attempts: 1,
      processing_started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (!insertError) {
    // INSERT bem-sucedido: evento novo, pode processar.
    return { evento: inserido, status: STATUS.PROCESSING, code: 'inserted' };
  }

  // 2. Conflito de event_id (23505). Carrega o evento existente.
  if (insertError.code !== '23505') {
    // Erro real de banco (permissão, conexão, etc)
    return { code: 'db_error', error: insertError };
  }

  return await reivindicarOuRetornar(supabase, eventId, payloadHash);
}

/**
 * Carrega evento existente e decide se pode reivindicar.
 */
async function reivindicarOuRetornar(supabase, eventId, payloadHash) {
  const { data: existente, error: loadError } = await supabase
    .from('asaas_webhook_events')
    .select('*')
    .eq('event_id', eventId)
    .single();

  if (loadError || !existente) {
    return { code: 'db_error', error: loadError || new Error('Evento não encontrado após conflito') };
  }

  // 3. Processed ou ignored: resposta idempotente.
  // Verificar antes do hash: se já processado, retorna idempotente mesmo com hash divergente.
  if (existente.status === STATUS.PROCESSED) {
    return {
      evento: existente,
      status: STATUS.PROCESSED,
      code: 'conflict_processed',
    };
  }

  if (existente.status === STATUS.IGNORED) {
    return {
      evento: existente,
      status: STATUS.IGNORED,
      code: 'conflict_ignored',
    };
  }

  // 4. Hash divergente em eventos não-terminais: não processa, não sobrescreve.
  if (payloadHash && existente.payload_hash && payloadHash !== existente.payload_hash) {
    return {
      evento: existente,
      status: existente.status,
      code: 'conflict_hash_mismatch',
    };
  }

  // 5. Processing recente: não reivindica.
  if (existente.status === STATUS.PROCESSING) {
    const processingStarted = existente.processing_started_at
      ? new Date(existente.processing_started_at).getTime()
      : 0;
    const agora = Date.now();
    if (agora - processingStarted < PROCESSING_STALE_TIMEOUT_MS) {
      return {
        evento: existente,
        status: STATUS.PROCESSING,
        code: 'conflict_processing',
      };
    }
    // Stale: cai no compare-and-swap abaixo para reclaim.
  }

  // 6. Compare-and-swap para reivindicar processing/failed/received/stale.
  const novasTentativas = (existente.attempts || 0) + 1;
  const agoraISO = new Date().toISOString();

  const { data: atualizado, error: casError } = await supabase
    .from('asaas_webhook_events')
    .update({
      status: STATUS.PROCESSING,
      attempts: novasTentativas,
      processing_started_at: agoraISO,
      last_error: null,
    })
    .eq('id', existente.id)
    .eq('status', existente.status) // ninguém mais mudou o status desde que carregamos
    .eq('attempts', existente.attempts) // ninguém mais incrementou
    .select()
    .single();

  if (casError || !atualizado) {
    // Alguém ganhou a corrida. Retorna como processing (não reivindicado).
    const { data: atual } = await supabase
      .from('asaas_webhook_events')
      .select('*')
      .eq('id', existente.id)
      .single();

    return {
      evento: atual || existente,
      status: atual?.status || existente.status,
      code: 'conflict_lost_cas',
    };
  }

  // Reivindicou com sucesso.
  return { evento: atualizado, status: STATUS.PROCESSING, code: 'claimed' };
}

/**
 * Marca evento como processed.
 */
async function marcarProcessado(supabase, eventId, { faturaId, empresaId, lastError } = {}) {
  const update = {
    status: STATUS.PROCESSED,
    processed_at: new Date().toISOString(),
    last_error: lastError ? sanitizar(lastError) : null,
  };
  if (faturaId) update.fatura_id = faturaId;
  if (empresaId) update.empresa_id = empresaId;

  const { data, error } = await supabase
    .from('asaas_webhook_events')
    .update(update)
    .eq('event_id', eventId)
    .eq('status', STATUS.PROCESSING)
    .select()
    .single();

  if (error) return { code: 'db_error', error };
  return { evento: data, code: 'marked_processed' };
}

/**
 * Marca evento como ignored.
 */
async function marcarIgnorado(supabase, eventId, razao) {
  const update = {
    status: STATUS.IGNORED,
    processed_at: new Date().toISOString(),
    last_error: razao ? sanitizar(razao) : null,
  };

  const { data, error } = await supabase
    .from('asaas_webhook_events')
    .update(update)
    .eq('event_id', eventId)
    .eq('status', STATUS.PROCESSING)
    .select()
    .single();

  if (error) return { code: 'db_error', error };
  return { evento: data, code: 'marked_ignored' };
}

/**
 * Marca evento como failed (permite retry).
 */
async function marcarFalhou(supabase, eventId, razao) {
  const update = {
    status: STATUS.FAILED,
    processed_at: null,
    last_error: razao ? sanitizar(razao) : null,
  };

  const { data, error } = await supabase
    .from('asaas_webhook_events')
    .update(update)
    .eq('event_id', eventId)
    .eq('status', STATUS.PROCESSING)
    .select()
    .single();

  if (error) return { code: 'db_error', error };
  return { evento: data, code: 'marked_failed' };
}

/**
 * Sanitiza mensagem de erro: remove tokens, IDs externos completos, URLs, PII.
 * Mantém apenas informação genérica sobre o tipo de falha.
 */
function sanitizar(msg) {
  if (!msg) return null;
  let s = String(msg);
  // Limita tamanho
  if (s.length > 500) s = s.slice(0, 497) + '...';
  // Remove possíveis tokens (hex longos > 20 chars)
  s = s.replace(/\b[a-fA-F0-9]{20,}\b/g, '[token]');
  // Remove UUIDs
  s = s.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '[uuid]');
  // Remove URLs
  s = s.replace(/https?:\/\/[^\s]+/g, '[url]');
  // Remove e-mails
  s = s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
  return s;
}

/**
 * Carrega um evento pelo event_id.
 */
async function carregarPorEventId(supabase, eventId) {
  const { data, error } = await supabase
    .from('asaas_webhook_events')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return { code: 'db_error', error };
  return { evento: data, code: data ? 'found' : 'not_found' };
}

module.exports = {
  inserirOuReivindicar,
  marcarProcessado,
  marcarIgnorado,
  marcarFalhou,
  carregarPorEventId,
  normalizarParaHash,
  sanitizar,
  STATUS,
  PROCESSING_STALE_TIMEOUT_MS,
};
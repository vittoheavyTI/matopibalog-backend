// backend/services/asaasWebhookService.js
// Serviço de processamento do webhook Asaas.
// Responsável por: validar, persistir, resolver fatura/empresa, aplicar regras de domínio.
// NÃO contém rota Express — a rota em pagamentos.js chama este serviço.

const { normalizarParaHash, inserirOuReivindicar, marcarProcessado, marcarIgnorado, marcarFalhou, sanitizar } = require('./asaasWebhookEventRepository');
const { decidirTransicaoFaturaEvento, lerDiasCarenciaSuspensao } = require('./paymentDomainService');
const { aplicarUpgradePago } = require('./upgradeApplyService');

// Eventos obrigatórios conhecidos e seguros (não geram transição financeira, mas
// são reconhecidos para não poluir logs com "desconhecido").
const EVENTOS_VALIDOS = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_RESTORED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

// Eventos que exigem payment.id.
const EVENTOS_COM_PAYMENT_ID = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_RESTORED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

function obterPaymentStatus(body) {
  return body?.payment?.status ? String(body.payment.status) : null;
}

function obterPagoEm(body) {
  return body?.payment?.paymentDate || body?.payment?.confirmedDate || null;
}

function leaseDoEvento(evento) {
  return {
    attempts: evento?.attempts,
    processing_started_at: evento?.processing_started_at,
  };
}

function erroJaMarcado(razao) {
  const err = new Error(razao);
  err.failedAlready = true;
  return err;
}

async function garantirMarcacao(resultado, razao) {
  if (!resultado || resultado.code === 'db_error') {
    throw new Error(razao);
  }
}

async function marcarFalhaERetentar(supabase, evento, razao) {
  await marcarFalhou(supabase, evento.event_id, razao, { lease: leaseDoEvento(evento) });
  throw erroJaMarcado(razao);
}

/**
 * Valida estrutura mínima do payload do webhook.
 * Retorna { valido: boolean, razao?: string }
 */
function validarBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valido: false, razao: 'body_invalido', httpStatus: 400 };
  }

  if (typeof body.id !== 'string' || !body.id.trim()) {
    return { valido: false, razao: 'id_ausente', httpStatus: 400 };
  }

  if (typeof body.event !== 'string' || !body.event.trim()) {
    return { valido: false, razao: 'event_ausente', httpStatus: 400 };
  }

  const eventType = body.event.trim().toUpperCase();

  // Se o evento exige payment.id, valida
  if (EVENTOS_COM_PAYMENT_ID.has(eventType)) {
    const payment = body.payment;
    if (!payment || typeof payment !== 'object' || typeof payment.id !== 'string' || !payment.id.trim()) {
      return { valido: false, razao: 'payment_id_ausente', httpStatus: 400 };
    }
  }

  return { valido: true, razao: 'ok' };
}

/**
 * Autentica o webhook Asaas via token fixo no header.
 * Comparação em tempo constante para evitar vazamento.
 *
 * @param {object} headers - Headers da requisição
 * @param {string} expectedToken - Token esperado (env var)
 * @returns {boolean}
 */
function autenticar(headers, expectedToken) {
  if (!expectedToken) return false;
  const received = headers?.['asaas-access-token'];
  if (!received) return false;

  // Comparação em tempo constante via sha256
  const crypto = require('crypto');
  const ah = crypto.createHash('sha256').update(String(received)).digest();
  const bh = crypto.createHash('sha256').update(String(expectedToken)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Processa um evento de webhook Asaas: valida, persiste, processa e marca.
 *
 * @param {object} deps
 * @param {object} deps.supabase - Cliente Supabase (service_role)
 * @param {object} deps.body - Payload bruto do webhook
 * @param {object} deps.headers - Headers da requisição (para log)
 * @returns {Promise<{ httpStatus: number, resultado: object }>}
 */
async function processarWebhook({ supabase, body }) {
  // 1. Validar body
  const validacao = validarBody(body);
  if (!validacao.valido) {
    return {
      httpStatus: validacao.httpStatus,
      resultado: { message: validacao.razao === 'body_invalido' ? 'Payload inválido.' : 'Payload inválido.' },
    };
  }

  const eventType = body.event.trim().toUpperCase();

  // 2. Evento totalmente desconhecido (não está no conjunto reconhecido)
  if (!EVENTOS_VALIDOS.has(eventType)) {
    return {
      httpStatus: 200,
      resultado: { received: true, event_type: eventType, ignored: true, razao: 'evento_desconhecido' },
    };
  }

  // 3. Persistir/reivindicar evento
  const normalizado = normalizarParaHash(body);
  const persistencia = await inserirOuReivindicar(supabase, body, normalizado);

  if (persistencia.code === 'db_error') {
    console.error('[webhook] Erro de banco ao persistir evento', { event_type: eventType });
    return { httpStatus: 500, resultado: { message: 'Erro interno ao processar evento.' } };
  }

  // 4. Respostas idempotentes para eventos já processados/ignorados
  if (['conflict_processed', 'conflict_ignored'].includes(persistencia.code)) {
    return {
      httpStatus: 200,
      resultado: { received: true, idempotente: true, code: persistencia.code },
    };
  }

  if (persistencia.code === 'conflict_hash_mismatch') {
    console.warn('[webhook] Hash divergente em evento existente', { event_type: eventType, code: 'hash_mismatch' });
    return {
      httpStatus: 200,
      resultado: { received: true, idempotente: true, warning: 'hash_mismatch' },
    };
  }

  // 5. Evento em processamento por outra instância (não é retry)
  if (persistencia.code === 'conflict_processing') {
    return {
      httpStatus: 200,
      resultado: { received: true, idempotente: true, code: 'em_processamento' },
    };
  }

  if (persistencia.code === 'conflict_lost_cas') {
    return {
      httpStatus: 200,
      resultado: { received: true, idempotente: true, code: 'perdeu_cas' },
    };
  }

  // 6. Evento novo ou reivindicado — processar
  const evento = persistencia.evento;
  if (!evento) {
    return { httpStatus: 500, resultado: { message: 'Erro interno: evento nulo.' } };
  }

  try {
    await executarProcessamento({ supabase, body, eventType, evento, normalizado });
    return { httpStatus: 200, resultado: { received: true, processed: true } };
  } catch (err) {
    const mensagemSanitizada = sanitizar(`erro_processamento:${err.message || 'desconhecido'}`);
    if (!err.failedAlready) {
      await marcarFalhou(supabase, evento.event_id, mensagemSanitizada, { lease: leaseDoEvento(evento) });
    }
    console.error('[webhook] Falha ao processar evento', {
      event_type: eventType,
      razao: mensagemSanitizada,
    });
    return { httpStatus: 500, resultado: { message: 'Erro ao processar evento.' } };
  }
}

/**
 * Executa o processamento financeiro do evento (após persistência bem-sucedida).
 */
async function executarProcessamento({ supabase, body, eventType, evento, normalizado }) {
  const eventId = evento.event_id;
  const isPaymentEvent = EVENTOS_COM_PAYMENT_ID.has(eventType);
  const asaasPaymentId = normalizado.payment_id || body?.payment?.id || null;

  // 7. Se não é evento de pagamento, marca ignorado e retorna
  if (!isPaymentEvent || !asaasPaymentId) {
    await garantirMarcacao(
      await marcarIgnorado(supabase, eventId, 'evento_sem_pagamento', { lease: leaseDoEvento(evento) }),
      'erro_marcar_ignorado'
    );
    return;
  }

  // 8. Resolver fatura local por asaas_id (NUNCA por externalReference)
  const { data: fatura, error: fetchError } = await supabase
    .from('faturas')
    .select('id, empresa_id, status, pago_em, due_date, invoice_url, bank_slip_url')
    .eq('asaas_id', asaasPaymentId)
    .maybeSingle();

  if (fetchError) {
    throw new Error('erro_consulta_fatura');
  }

  // 9. Cobrança não gerenciada localmente — ignora sem criar resíduo
  if (!fatura) {
    await garantirMarcacao(
      await marcarIgnorado(supabase, eventId, 'payment_not_managed', { lease: leaseDoEvento(evento) }),
      'erro_marcar_ignorado'
    );
    return;
  }

  // 10. Resolver empresa (apenas após fatura confirmada localmente).
  //     suspensao_prazo_ate: extensão manual de prazo (respeitada pela suspensão).
  const { data: empresa, error: empresaError } = await supabase
    // `*` (deploy-safe): traz suspensao_prazo_ate só se a coluna existir (antes
    // da migration 047 ela some do retorno, sem erro).
    .from('empresas')
    .select('*')
    .eq('id', fatura.empresa_id)
    .single();

  if (empresaError || !empresa) {
    // Fatura existe mas empresa não — erro de consistência, sinaliza failed
    await marcarFalhaERetentar(supabase, evento, 'empresa_nao_encontrada');
  }

  // 11. Aplicar regra de domínio: decidir transição da fatura e empresa
  const paymentStatus = obterPaymentStatus(body);
  const pagoEmDetectado = obterPagoEm(body);

  // Carência de suspensão (config; default 3 no domínio se ausente/erro).
  let diasCarencia;
  try {
    const { data: cfgCar } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
    diasCarencia = lerDiasCarenciaSuspensao(cfgCar && cfgCar.dados);
  } catch (_) { diasCarencia = undefined; }

  const decisao = decidirTransicaoFaturaEvento({
    eventType,
    fatura,
    empresa,
    paymentStatus,
    pagoEmDetectado,
    diasCarencia,
  });

  if (!decisao.conhecido) {
    await garantirMarcacao(
      await marcarIgnorado(supabase, eventId, decisao.razao || 'evento_nao_reconhecido', { lease: leaseDoEvento(evento) }),
      'erro_marcar_ignorado'
    );
    return;
  }

  if (!decisao.acaoFinanceira) {
    // Evento conhecido mas sem transição financeira (criação, chargeback, estorno parcial)
    await garantirMarcacao(
      await marcarProcessado(supabase, eventId, {
        faturaId: fatura.id,
        empresaId: fatura.empresa_id,
        lastError: `sem_transicao_${eventType.toLowerCase()}`,
        lease: leaseDoEvento(evento),
      }),
      'erro_marcar_processado'
    );
    return;
  }

  // 12. Aplicar atualizações na fatura
  const decisaoFatura = decisao.fatura;
  if (decisaoFatura && !decisaoFatura.ignorar && decisaoFatura.update) {
    // Inclui asaas_raw_status para sincronismo
    decisaoFatura.update.asaas_raw_status = paymentStatus || body?.payment?.status || null;
    decisaoFatura.update.last_synced_at = new Date().toISOString();

    const { data: faturaAtualizada, error: updateFaturaError } = await supabase
      .from('faturas')
      .update(decisaoFatura.update)
      .eq('id', fatura.id)
      .eq('status', fatura.status)
      .select('id, status')
      .maybeSingle();

    if (updateFaturaError || !faturaAtualizada) {
      await marcarFalhaERetentar(supabase, evento, 'erro_atualizar_fatura');
    }
  }

  // 13. Aplicar atualizações na empresa
  const decisaoEmpresa = decisao.empresa;
  if (decisaoEmpresa && decisaoEmpresa.deveAtualizar) {
    const empresaUpdate = {};

    if (decisaoEmpresa.novoStatus) {
      empresaUpdate.status = decisaoEmpresa.novoStatus;
    }

    // Se deve limpar metadados de suspensão (reativação financeira)
    if (decisaoEmpresa.deveLimparSuspensao) {
      empresaUpdate.suspension_reason = null;
      empresaUpdate.suspension_source = null;
      empresaUpdate.suspended_at = null;
      empresaUpdate.suspended_by = null;
    }

    // Se deve suspender (inadimplência financeira)
    if (decisaoEmpresa.deveSuspender) {
      empresaUpdate.suspension_reason = 'financial';
      empresaUpdate.suspension_source = 'automatic';
      empresaUpdate.suspended_at = new Date().toISOString();
      empresaUpdate.suspended_by = null;
    }

    if (Object.keys(empresaUpdate).length > 0) {
      const { error: updateEmpresaError } = await supabase
        .from('empresas')
        .update(empresaUpdate)
        .eq('id', empresa.id);

      if (updateEmpresaError) {
        // Falha ao atualizar empresa — evento fica failed para retry
        await marcarFalhaERetentar(supabase, evento, 'erro_atualizar_empresa');
      }
    }
  }

  // 13.5. Aplicar UPGRADE de plano (Frente #8-C / PR 3) — bloco ADITIVO e
  // condicional, sem alterar o caminho acima. Só quando a fatura virou 'pago'.
  // Fatura comum (sem solicitação de upgrade vinculada) NÃO é afetada. Erro
  // técnico (DB) → marcarFalhaERetentar (retry idempotente); inconsistência de
  // negócio NÃO quebra o webhook (o serviço decide sem lançar). NÃO cria fatura,
  // NÃO chama Asaas, NÃO altera limite_motoristas (derivado do plano_id).
  if (decisao.fatura && decisao.fatura.statusFinal === 'pago') {
    let upgrade;
    try {
      upgrade = await aplicarUpgradePago({
        supabase,
        faturaId: fatura.id,
        empresaId: fatura.empresa_id,
        asaasPaymentId,
      });
    } catch (_) {
      // Falha técnica na aplicação do plano → evento fica failed para retry.
      await marcarFalhaERetentar(supabase, evento, 'erro_aplicar_upgrade');
    }
    if (upgrade && upgrade.resultado === 'aplicado') {
      console.log('[webhook][upgrade] plano aplicado', { empresa_id: fatura.empresa_id, plano_novo_id: upgrade.planoNovoId });
    } else if (upgrade && upgrade.resultado !== 'sem_solicitacao') {
      console.warn('[webhook][upgrade] plano nao aplicado', { resultado: upgrade.resultado, motivo: upgrade.motivo });
    }
  }

  // 14. Marcar como processado com vínculos
  await garantirMarcacao(
    await marcarProcessado(supabase, eventId, {
      faturaId: fatura.id,
      empresaId: fatura.empresa_id,
      lastError: null,
      lease: leaseDoEvento(evento),
    }),
    'erro_marcar_processado'
  );
}

module.exports = {
  processarWebhook,
  validarBody,
  autenticar,
  EVENTOS_VALIDOS,
};

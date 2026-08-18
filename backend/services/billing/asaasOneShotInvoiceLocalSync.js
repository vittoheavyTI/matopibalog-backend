// Núcleo (testável, sem I/O) do SYNC LOCAL IDEMPOTENTE da cobrança one-shot (F5B-1A).
//
// Objetivo: fazer a cobrança REAL já existente no Asaas (pay_...) aparecer na
// página "Minhas Faturas", criando/atualizando UMA linha local em `faturas`
// vinculada por `asaas_id`. NÃO cria cobrança, NÃO chama Asaas com escrita.
//
// SEGURANÇA (fail-closed, dry-run por padrão):
//   - dry-run é o DEFAULT: sem --execute-local-sync + --confirm-local-invoice-upsert,
//     apenas LÊ (Supabase SELECT + Asaas GET) e imprime o plano; NÃO escreve;
//   - upsert por `asaas_id`: acha existente (update) ou insere (1 linha); nunca duplica;
//   - status: normalizarStatusAsaas (PENDING→pendente; RECEIVED/CONFIRMED→pago) — NUNCA
//     marca pago se o Asaas ainda diz PENDING;
//   - escopo: allowlist EXATAMENTE 1 = a empresa alvo (Foxtrot); charge_id/externalRef/
//     valor/billingType precisam bater, senão aborta antes de qualquer escrita.

const { parseAllowlist } = require('./billingProductionGate');
const { canonicalCustomerReference, canonicalImplantationChargeReference } = require('./asaasProviderSafety');
const { normalizarStatusAsaas } = require('../paymentDomainService');

const VALOR_PADRAO_CENTAVOS = 500; // R$5,00 (valor da 1ª cobrança real)
const STATUS_ESPERADO_PADRAO = 'PENDING';
const ORIGEM = 'homologacao_one_shot';

function sanitizar(v) {
  if (v == null) return null;
  return String(v)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/access_token['":\s]+[^"',\s}]+/gi, 'access_token [redacted]')
    .replace(/\$?aact_[A-Za-z0-9_$-]+/g, '[redacted_api_key]')
    .replace(/https?:\/\/(?!www\.asaas)\S+/gi, '[url]')
    .slice(0, 500);
}

function ehUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

function clientRequestId(chargeId) {
  return `matopiba:local-sync:one-shot:${chargeId}`;
}

function parseArgs(argv = []) {
  const raw = new Map();
  for (const t of argv) {
    if (typeof t !== 'string' || !t.startsWith('--')) continue;
    const s = t.slice(2);
    const i = s.indexOf('=');
    if (i === -1) raw.set(s, 'true'); else raw.set(s.slice(0, i), s.slice(i + 1));
  }
  const valorRaw = raw.get('expected-value-centavos');
  return {
    empresaId: raw.has('empresa-id') ? String(raw.get('empresa-id')).trim() : null,
    chargeId: raw.has('charge-id') ? String(raw.get('charge-id')).trim() : null,
    expectedValueCentavos: valorRaw != null ? Number(valorRaw) : VALOR_PADRAO_CENTAVOS,
    expectedStatus: raw.has('expected-status') ? String(raw.get('expected-status')).trim().toUpperCase() : STATUS_ESPERADO_PADRAO,
    executeLocalSync: raw.get('execute-local-sync') === 'true',
    confirmLocalInvoiceUpsert: raw.get('confirm-local-invoice-upsert') === 'true',
    syncCustomerLocal: raw.get('sync-customer-local') === 'true',
    permitirCustomerDiferente: raw.get('permitir-customer-diferente') === 'true',
  };
}

// Validações fail-closed. `charge` é o objeto do Asaas (ou null).
function avaliarSync({ args, env = {}, empresa, charge }) {
  const erros = [];
  const allowlist = parseAllowlist(env.BILLING_PRODUCTION_ALLOWLIST);

  if (!args.empresaId) erros.push('empresa_id_ausente');
  else if (!ehUuid(args.empresaId)) erros.push('empresa_id_invalido');
  if (!args.chargeId) erros.push('charge_id_ausente');

  // Escopo/tenant: allowlist EXATAMENTE 1 = alvo.
  if (allowlist.length !== 1) erros.push('allowlist_nao_unica');
  if (args.empresaId && allowlist.length >= 1 && !allowlist.includes(String(args.empresaId))) erros.push('empresa_fora_allowlist');

  if (!empresa) erros.push('empresa_nao_encontrada');

  if (!charge) {
    erros.push('charge_asaas_nao_encontrada');
  } else {
    if (args.chargeId && charge.id !== args.chargeId) erros.push('charge_id_divergente');
    const refEsperada = canonicalImplantationChargeReference(args.empresaId);
    if (charge.externalReference && charge.externalReference !== refEsperada) erros.push('external_reference_divergente');
    const valorEsperado = Number(args.expectedValueCentavos) / 100;
    if (charge.value != null && Number(charge.value) !== valorEsperado) erros.push('valor_divergente');
    if (charge.billingType && charge.billingType !== 'PIX') erros.push('billing_type_divergente');
  }
  return { erros, allowlist_size: allowlist.length };
}

// Monta o plano de upsert da fatura + do customer local (o que SERIA escrito).
function montarPlano({ args, charge, faturaExistente, empresa, agora = new Date() }) {
  const rawStatus = String(charge && charge.status ? charge.status : '').toUpperCase();
  const statusLocal = normalizarStatusAsaas(rawStatus).status; // 'pendente' | 'pago' | ...
  const fatura = {
    empresa_id: args.empresaId,
    asaas_id: charge ? charge.id : null,
    valor: charge ? charge.value : null,
    tipo_pagamento: 'PIX',
    status: statusLocal,
    asaas_raw_status: rawStatus || null,
    due_date: charge ? (charge.dueDate || null) : null,
    invoice_url: charge ? (charge.invoiceUrl || null) : null,
    bank_slip_url: charge ? (charge.bankSlipUrl || null) : null,
    client_request_id: charge ? clientRequestId(charge.id) : null,
    origem: ORIGEM,
    last_synced_at: agora.toISOString(),
  };
  // pago_em só quando o Asaas confirma pagamento (nunca inventa).
  if (statusLocal === 'pago' && charge && charge.paymentDate) fatura.pago_em = charge.paymentDate;

  const customerAsaas = charge ? (charge.customer || null) : null;
  const customerLocalAtual = empresa ? (empresa.asaas_customer_id || null) : null;
  const customerPlan = {
    current: customerLocalAtual,
    planned: customerAsaas,
    will_update: args.syncCustomerLocal && !!customerAsaas && customerLocalAtual !== customerAsaas,
    conflito: !!customerLocalAtual && !!customerAsaas && customerLocalAtual !== customerAsaas,
  };

  return {
    fatura,
    will_insert: !faturaExistente,
    will_update: !!faturaExistente,
    fatura_existente_id: faturaExistente ? faturaExistente.id : null,
    status_local: statusLocal,
    customer: customerPlan,
    client_request_id: fatura.client_request_id,
  };
}

// deps: {
//   carregarEmpresa: async (empresaId) => empresa|null
//   buscarChargeAsaas: async ({ chargeId, env }) => { secret_present, charge }
//   buscarFaturaPorAsaasId: async (asaasId) => fatura|null
//   upsertFaturaLocal?: async ({ plano }) => resultado   (SÓ no execute)
//   atualizarCustomerLocal?: async ({ empresaId, asaasCustomerId }) => void (SÓ no execute)
//   agora?: Date · log?: (obj)=>void
// }
async function sincronizarFaturaLocal({ argv = [], env = process.env, deps = {} } = {}) {
  const agora = deps.agora instanceof Date ? deps.agora : new Date();
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const args = parseArgs(argv);

  const empresa = (args.empresaId && typeof deps.carregarEmpresa === 'function')
    ? await deps.carregarEmpresa(args.empresaId) : null;

  let charge = null;
  let semSegredo = false;
  if (env.ASAAS_API_KEY && args.chargeId && typeof deps.buscarChargeAsaas === 'function') {
    const r = await deps.buscarChargeAsaas({ chargeId: args.chargeId, env });
    if (r && r.secret_present === false) semSegredo = true; else charge = r ? r.charge : null;
  } else {
    semSegredo = !env.ASAAS_API_KEY;
  }

  const faturaExistente = (charge && charge.id && typeof deps.buscarFaturaPorAsaasId === 'function')
    ? await deps.buscarFaturaPorAsaasId(charge.id) : null;

  const { erros, allowlist_size } = avaliarSync({ args, env, empresa, charge });
  const plano = montarPlano({ args, charge, faturaExistente, empresa, agora });

  const base = {
    empresa_id: args.empresaId,
    charge_id: args.chargeId,
    read_only: true,
    allowlist_size,
    asaas_charge: charge ? { found: true, status: charge.status, value: charge.value, billingType: charge.billingType } : { found: false },
    local_invoice: { found: !!faturaExistente, will_insert: plano.will_insert, will_update: plano.will_update, status: plano.status_local, valor: plano.fatura.valor },
    local_customer: { current: plano.customer.current, planned: plano.customer.planned, will_update: plano.customer.will_update, conflito: plano.customer.conflito },
    client_request_id: plano.client_request_id,
    requires_execute_flags: ['execute-local-sync', 'confirm-local-invoice-upsert'],
  };

  if (semSegredo) {
    const r = { ...base, modo: 'dry-run', read_only: true, result: 'NEEDS_OWNER_RAILWAY_RUN', observacao: 'Sync precisa do ASAAS_API_KEY no ambiente. Rodar via railway run (dry-run, sem flags de escrita).' };
    log(r); return r;
  }

  // ---------- DRY-RUN (default): não escreve ----------
  const modoExecute = args.executeLocalSync && args.confirmLocalInvoiceUpsert;
  if (!modoExecute) {
    const r = {
      ...base,
      modo: 'dry-run',
      writes_planned: { supabase: (plano.will_insert || plano.will_update ? 1 : 0) + (plano.customer.will_update ? 1 : 0), asaas: 0 },
      validacoes_que_bloqueariam: erros,
      falta_flags: !args.executeLocalSync ? ['execute-local-sync'] : (!args.confirmLocalInvoiceUpsert ? ['confirm-local-invoice-upsert'] : []),
      observacao: 'DRY-RUN: nenhuma escrita local ou Asaas executada.',
    };
    log(r); return r;
  }

  // ---------- EXECUÇÃO LOCAL (só com as 2 flags): fail-closed ----------
  if (erros.length > 0) {
    const r = { ...base, modo: 'execute-local-sync', ok: false, abortado: true, motivos: erros };
    log(r);
    const e = new Error(`LOCAL_SYNC_ABORTADO: ${erros.join(',')}`); e.code = 'LOCAL_SYNC_ABORTADO'; e.motivos = erros; throw e;
  }
  if (plano.customer.conflito && !args.permitirCustomerDiferente) {
    const r = { ...base, modo: 'execute-local-sync', ok: false, abortado: true, motivos: ['customer_local_diferente'] };
    log(r);
    const e = new Error('LOCAL_SYNC_ABORTADO: customer_local_diferente'); e.code = 'LOCAL_SYNC_ABORTADO'; throw e;
  }
  if (typeof deps.upsertFaturaLocal !== 'function') {
    const e = new Error('LOCAL_SYNC_SEM_UPSERT: deps.upsertFaturaLocal ausente.'); e.code = 'LOCAL_SYNC_SEM_UPSERT'; throw e;
  }

  const resUpsert = await deps.upsertFaturaLocal({ plano });
  let customerAtualizado = false;
  if (plano.customer.will_update && typeof deps.atualizarCustomerLocal === 'function') {
    await deps.atualizarCustomerLocal({ empresaId: args.empresaId, asaasCustomerId: plano.customer.planned });
    customerAtualizado = true;
  }

  const r = { ...base, modo: 'execute-local-sync', ok: true, acao: plano.will_insert ? 'inserted' : 'updated', fatura_id: resUpsert && resUpsert.id ? resUpsert.id : plano.fatura_existente_id, customer_local_atualizado: customerAtualizado };
  log(r); return r;
}

module.exports = {
  VALOR_PADRAO_CENTAVOS,
  STATUS_ESPERADO_PADRAO,
  ORIGEM,
  sanitizar,
  ehUuid,
  clientRequestId,
  parseArgs,
  avaliarSync,
  montarPlano,
  sincronizarFaturaLocal,
};

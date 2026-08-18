// Núcleo (testável, sem I/O) do HARNESS DE CERTIFICAÇÃO read-only (F5A).
//
// Transforma os checks manuais em um relatório único e determinístico do estado
// do PRIMEIRO pagamento real Asaas production. É ESTRITAMENTE read-only:
//   - Supabase: só SELECT (billing_outbox, empresa, faturas);
//   - Asaas: só GET (customer/charges/subscriptions por externalReference);
//   - env/gate: só leitura de flags (sem expor segredo).
// NUNCA aceita --execute, NUNCA cria/edita nada. Divergência perigosa → exit != 0.

const { parseAllowlist } = require('./billingProductionGate');
const { canonicalImplantationChargeReference, canonicalSubscriptionReference } = require('./asaasProviderSafety');

const VALOR_PADRAO_CENTAVOS = 500; // R$5,00 (mínimo Asaas; valor da 1ª cobrança real)
const STATUS_PADRAO = 'PENDING';
// Status considerados "avanço legítimo" do PIX (não são divergência perigosa).
const STATUS_PERMITIDOS = ['PENDING', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

function sanitizar(v) {
  if (v == null) return null;
  return String(v)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/access_token['":\s]+[^"',\s}]+/gi, 'access_token [redacted]')
    .replace(/\$?aact_[A-Za-z0-9_$-]+/g, '[redacted_api_key]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 500);
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
    expectedStatus: raw.has('expected-status') ? String(raw.get('expected-status')).trim().toUpperCase() : STATUS_PADRAO,
    expectedCustomerId: raw.has('expected-customer-id') ? String(raw.get('expected-customer-id')).trim() : null,
    // --execute NUNCA é aceito aqui (harness é read-only). Se vier, é ignorado/registrado.
    executeRejeitado: raw.get('execute') === 'true',
  };
}

// Avalia todos os checks. Retorna { divergencias, avisos } — divergência = perigo (FAIL).
function avaliarCertificacao({ args, env = {}, local = {}, asaas = {}, gate = {} }) {
  const divergencias = [];
  const avisos = [];
  const allowlist = parseAllowlist(env.BILLING_PRODUCTION_ALLOWLIST);

  // Nunca aceitar --execute neste harness.
  if (args.executeRejeitado) divergencias.push('execute_nao_permitido_no_harness');

  // A) Supabase local (read-only)
  if (Number(local.billing_outbox_count) !== 0) divergencias.push('billing_outbox_nao_zero');
  if (local.pilot_subscription_id) divergencias.push('subscription_local_indevida');
  // asaas_customer_id local null é ESPERADO (sem integração local ainda) → não é divergência.

  // B) Gate / env (ARMED esperado, escrita bloqueada)
  if (String(gate.provider_mode || '') !== 'asaas_production') avisos.push(`provider_mode_inesperado:${sanitizar(gate.provider_mode)}`);
  if (gate.runner_enabled === true) divergencias.push('outbox_enabled_persistente'); // ARMED exige outbox=false
  if (gate.state && gate.state === 'PRODUCTION_ACTIVE') divergencias.push('gate_active_inesperado');
  if (allowlist.length !== 1) divergencias.push('allowlist_nao_unica');
  if (args.empresaId && allowlist.length >= 1 && !allowlist.includes(String(args.empresaId))) divergencias.push('empresa_fora_allowlist');

  // C) Asaas (read-only)
  if (asaas.secret_present === false) return { divergencias, avisos, sem_segredo: true };
  if (!asaas.customer) {
    divergencias.push('customer_asaas_nao_encontrado');
  } else if (args.expectedCustomerId && asaas.customer.id !== args.expectedCustomerId) {
    divergencias.push('customer_id_divergente');
  }
  if (Number(asaas.charges_count) === 0) divergencias.push('charge_asaas_nao_encontrada');
  if (Number(asaas.charges_count) > 1) divergencias.push('charge_duplicada');
  if (Number(asaas.subscriptions_count) > 0) divergencias.push('subscription_asaas_indevida');

  const c = asaas.charge;
  if (c) {
    if (args.chargeId && c.id !== args.chargeId) divergencias.push('charge_id_divergente');
    const valorEsperadoReais = Number(args.expectedValueCentavos) / 100;
    if (c.value != null && Number(c.value) !== valorEsperadoReais) divergencias.push('valor_divergente');
    if (c.billingType && c.billingType !== 'PIX') divergencias.push('billing_type_divergente');
    if (c.status && c.status !== args.expectedStatus) {
      if (STATUS_PERMITIDOS.includes(c.status)) avisos.push(`status_avancou:${c.status}`);
      else divergencias.push(`status_inesperado:${c.status}`);
    }
  }

  return { divergencias, avisos, sem_segredo: false };
}

// deps: {
//   consultarLocal: async () => { billing_outbox_count, pilot_local_customer_id, pilot_subscription_id, pilot_faturas_count, global_faturas_count, empresa_existe }
//   consultarAsaas: async ({ empresaId, chargeRef, subscriptionRef, env }) => { secret_present, customer, charges_count, charge, subscriptions_count }
//   gateResumo: () => { state, provider_mode, runner_enabled, production_enabled, allowlist_count, production_secret_present }
//   log?: (obj) => void
// }
async function certificarPagamento({ argv = [], env = process.env, deps = {} } = {}) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const args = parseArgs(argv);
  const chargeRef = canonicalImplantationChargeReference(args.empresaId);
  const subscriptionRef = canonicalSubscriptionReference(args.empresaId);

  const gate = typeof deps.gateResumo === 'function' ? deps.gateResumo() : {};
  const local = typeof deps.consultarLocal === 'function' ? await deps.consultarLocal() : {};

  let asaas = { secret_present: false };
  if (env.ASAAS_API_KEY && typeof deps.consultarAsaas === 'function') {
    try {
      asaas = await deps.consultarAsaas({ empresaId: args.empresaId, chargeRef, subscriptionRef, env });
    } catch (err) {
      const r = montarSaida({ args, env, local, gate, asaas: { secret_present: true }, avaliacao: { divergencias: ['asaas_consulta_erro'], avisos: [], sem_segredo: false }, chargeRef, resultado: 'FAIL', erro: sanitizar(err && err.message) });
      log(r);
      return r;
    }
  }

  const avaliacao = avaliarCertificacao({ args, env, local, asaas, gate });

  let resultado;
  if (avaliacao.sem_segredo) {
    resultado = 'NEEDS_OWNER_RAILWAY_RUN';
  } else if (avaliacao.divergencias.length > 0) {
    resultado = `FAIL:${avaliacao.divergencias.join(',')}`;
  } else {
    const status = asaas.charge && asaas.charge.status;
    resultado = (status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH')
      ? 'PASS_PAYMENT_CONFIRMED'
      : 'PASS_PAYMENT_CREATED_PENDING_NO_LOCAL_INTEGRATION';
  }

  const r = montarSaida({ args, env, local, gate, asaas, avaliacao, chargeRef, resultado });
  log(r);
  return r;
}

function montarSaida({ args, env, local, gate, asaas, avaliacao, chargeRef, resultado, erro = null }) {
  const allowlist = parseAllowlist(env.BILLING_PRODUCTION_ALLOWLIST);
  return {
    modo: 'certify-payment-state',
    read_only: true,
    empresa_id: args.empresaId,
    external_reference_charge: chargeRef,
    customer: {
      found: !!(asaas && asaas.customer),
      id: asaas && asaas.customer ? asaas.customer.id : null,
    },
    charge: {
      found: !!(asaas && asaas.charge),
      count: asaas ? (asaas.charges_count ?? null) : null,
      id: asaas && asaas.charge ? asaas.charge.id : null,
      status: asaas && asaas.charge ? asaas.charge.status : null,
      value: asaas && asaas.charge ? asaas.charge.value : null,
      billingType: asaas && asaas.charge ? asaas.charge.billingType : null,
    },
    subscription_found: !!(asaas && Number(asaas.subscriptions_count) > 0),
    local_state: {
      billing_outbox_count: local.billing_outbox_count ?? null,
      pilot_local_customer_id: local.pilot_local_customer_id ?? null,
      pilot_subscription_local: local.pilot_subscription_id ? true : false,
      pilot_faturas_count: local.pilot_faturas_count ?? null,
      global_faturas_count: local.global_faturas_count ?? null,
    },
    gate: {
      persistent_state: gate.state ?? null,
      provider_mode: gate.provider_mode != null ? sanitizar(gate.provider_mode) : null,
      outbox_enabled: gate.runner_enabled === true,
      runner_enabled: gate.runner_enabled === true,
      production_secret_present: gate.production_secret_present === true,
      allowlist_count: allowlist.length,
    },
    divergencias: avaliacao.divergencias,
    avisos: avaliacao.avisos,
    erro,
    result: resultado,
  };
}

// exit code: 0 se PASS/NEEDS_OWNER; 1 se FAIL.
function exitCodePara(resultado) {
  return String(resultado || '').startsWith('FAIL') ? 1 : 0;
}

module.exports = {
  VALOR_PADRAO_CENTAVOS,
  STATUS_PADRAO,
  STATUS_PERMITIDOS,
  sanitizar,
  parseArgs,
  avaliarCertificacao,
  certificarPagamento,
  exitCodePara,
};

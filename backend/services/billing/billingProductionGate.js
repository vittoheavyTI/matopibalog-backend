// Gate cumulativo para Asaas production.
//
// A presenca de segredo, provider mode ou runner isoladamente nunca habilita
// escrita financeira real. O gate exige todas as travas abaixo e uma empresa
// explicitamente allowlisted. Sem isso, qualquer tentativa de provider production
// falha fechada antes de construir o adapter HTTP.

const { parseBoolEstrito } = require('./billingRunnerConfig');

const PROVIDER_PRODUCTION = 'asaas_production';
const ENV_ALLOWLIST = 'BILLING_PRODUCTION_ALLOWLIST';
const ENV_ENABLED = 'BILLING_PRODUCTION_ENABLED';
const ENV_PROVIDER = 'BILLING_PROVIDER_MODE';
const ENV_OUTBOX = 'BILLING_OUTBOX_ENABLED';
const ENV_SECRET = 'ASAAS_API_KEY';
const BASE_ASAAS_PRODUCTION = 'https://api.asaas.com/v3';

const OPERACOES_ELEGIVEIS = new Set([
  'billing_orchestrator',
  'customer',
  'subscription',
  'charge',
  'cancel_subscription',
  'update_subscription',
  'component',
]);

function parseAllowlist(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseBoolGate(env, nome, fallback) {
  try {
    return { value: parseBoolEstrito(env[nome], fallback, nome), error: null };
  } catch (err) {
    return { value: fallback, error: err.message };
  }
}

function estadoGlobalBillingProducao(env = process.env) {
  const providerMode = String(env[ENV_PROVIDER] || 'fake').trim().toLowerCase();
  const outbox = parseBoolGate(env, ENV_OUTBOX, false);
  const production = parseBoolGate(env, ENV_ENABLED, false);
  const outboxEnabled = outbox.value;
  const productionEnabled = production.value;
  const allowlist = parseAllowlist(env[ENV_ALLOWLIST]);
  const secretPresent = Boolean(env[ENV_SECRET]);

  if (providerMode === 'sandbox') return 'SANDBOX';
  if (providerMode !== PROVIDER_PRODUCTION) return 'PRODUCTION_DISABLED';
  if (outbox.error || production.error) return 'PRODUCTION_BLOCKED';
  if (!productionEnabled || !secretPresent || allowlist.length === 0) return 'PRODUCTION_BLOCKED';
  if (!outboxEnabled) return 'PRODUCTION_ARMED';
  return 'PRODUCTION_ACTIVE';
}

function avaliarBillingProductionGate({ empresaId, operation = 'billing_orchestrator', env = process.env } = {}) {
  const providerMode = String(env[ENV_PROVIDER] || 'fake').trim().toLowerCase();
  const outbox = parseBoolGate(env, ENV_OUTBOX, false);
  const production = parseBoolGate(env, ENV_ENABLED, false);
  const outboxEnabled = outbox.value;
  const productionEnabled = production.value;
  const allowlist = parseAllowlist(env[ENV_ALLOWLIST]);
  const secretPresent = Boolean(env[ENV_SECRET]);
  const empresaAllowlisted = Boolean(empresaId && allowlist.includes(String(empresaId)));
  const operationEligible = OPERACOES_ELEGIVEIS.has(operation);
  const configErrors = [outbox.error, production.error].filter(Boolean);

  const checks = Object.freeze({
    provider_mode: providerMode,
    outbox_enabled: outboxEnabled,
    production_enabled: productionEnabled,
    allowlist_size: allowlist.length,
    empresa_allowlisted: empresaAllowlisted,
    secret_present: secretPresent,
    operation_eligible: operationEligible,
  });

  const failures = [];
  if (providerMode !== PROVIDER_PRODUCTION) failures.push('provider_mode_not_production');
  if (!outboxEnabled) failures.push('outbox_disabled');
  if (!productionEnabled) failures.push('production_disabled');
  if (allowlist.length === 0) failures.push('allowlist_empty');
  if (!empresaAllowlisted) failures.push('empresa_not_allowlisted');
  if (!secretPresent) failures.push('production_secret_absent');
  if (!operationEligible) failures.push('operation_not_eligible');
  for (const error of configErrors) failures.push(`config_invalid:${error}`);

  return Object.freeze({
    allowed: failures.length === 0,
    state: estadoGlobalBillingProducao(env),
    failures,
    checks,
    secret_authority: 'ASAAS_API_KEY_ENV_ONLY',
    allowlist_authority: ENV_ALLOWLIST,
    baseURL: BASE_ASAAS_PRODUCTION,
  });
}

function resumoBillingProductionGate(env = process.env) {
  const providerMode = String(env[ENV_PROVIDER] || 'fake').trim().toLowerCase();
  const outbox = parseBoolGate(env, ENV_OUTBOX, false);
  const production = parseBoolGate(env, ENV_ENABLED, false);
  const outboxEnabled = outbox.value;
  const productionEnabled = production.value;
  const allowlist = parseAllowlist(env[ENV_ALLOWLIST]);
  return Object.freeze({
    state: estadoGlobalBillingProducao(env),
    provider_mode: providerMode,
    runner_enabled: outboxEnabled,
    production_enabled: productionEnabled,
    allowlist_count: allowlist.length,
    production_secret_present: Boolean(env[ENV_SECRET]),
    production_secret_authority: 'ASAAS_API_KEY_ENV_ONLY',
    production_allowlist_authority: ENV_ALLOWLIST,
    config_errors: [outbox.error, production.error].filter(Boolean),
  });
}

module.exports = {
  PROVIDER_PRODUCTION,
  BASE_ASAAS_PRODUCTION,
  parseAllowlist,
  estadoGlobalBillingProducao,
  avaliarBillingProductionGate,
  resumoBillingProductionGate,
};

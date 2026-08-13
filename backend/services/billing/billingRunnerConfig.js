// Configuração do runner automático do outbox de billing (macrofrente 3A-2, §6/§3).
//
// Parsing ESTRITO / FAIL-CLOSED. Para billing automático, configuração inválida
// deve FALHAR claramente (nunca clamp/fallback silencioso). Ausente → default
// documentado; presente e inválida → lança BillingRunnerConfigurationError.

class BillingRunnerConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BillingRunnerConfigurationError';
  }
}

const DEFAULTS = Object.freeze({
  enabled: false,          // OFF por padrão (produção proibida nesta frente)
  intervalSeconds: 30,     // cadência do runner in-process
  batchSize: 10,           // eventos por rodada
});

const LIMITES = Object.freeze({
  intervalSeconds: { min: 5, max: 3600 },
  batchSize: { min: 1, max: 50 },
});

// Boolean estrito: SOMENTE 'true'/'false' (trim + case-insensitive). Ausente →
// default. Qualquer outro valor (1, 0, yes, no, sim, nao, abc, ...) → ERRO.
function parseBoolEstrito(v, fallback, nome = 'boolean') {
  if (v == null || String(v).trim() === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  throw new BillingRunnerConfigurationError(`Config inválida em ${nome}: esperado "true" ou "false", recebido "${v}".`);
}

// Inteiro estrito em faixa: ausente → default; presente deve ser inteiro válido
// DENTRO da faixa. Não-inteiro OU fora da faixa → ERRO (sem clamp).
function parseIntEmFaixa(v, fallback, min, max, nome = 'inteiro') {
  if (v == null || String(v).trim() === '') return fallback;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) {
    throw new BillingRunnerConfigurationError(`Config inválida em ${nome}: esperado inteiro, recebido "${v}".`);
  }
  const n = Number(s);
  if (n < min || n > max) {
    throw new BillingRunnerConfigurationError(`Config inválida em ${nome}: ${n} fora da faixa [${min}, ${max}].`);
  }
  return n;
}

function resolveRunnerConfig(env = process.env) {
  return Object.freeze({
    enabled: parseBoolEstrito(env.BILLING_OUTBOX_ENABLED, DEFAULTS.enabled, 'BILLING_OUTBOX_ENABLED'),
    intervalSeconds: parseIntEmFaixa(env.BILLING_OUTBOX_INTERVAL_SECONDS, DEFAULTS.intervalSeconds, LIMITES.intervalSeconds.min, LIMITES.intervalSeconds.max, 'BILLING_OUTBOX_INTERVAL_SECONDS'),
    batchSize: parseIntEmFaixa(env.BILLING_OUTBOX_BATCH_SIZE, DEFAULTS.batchSize, LIMITES.batchSize.min, LIMITES.batchSize.max, 'BILLING_OUTBOX_BATCH_SIZE'),
  });
}

module.exports = { DEFAULTS, LIMITES, resolveRunnerConfig, parseBoolEstrito, parseIntEmFaixa, BillingRunnerConfigurationError };

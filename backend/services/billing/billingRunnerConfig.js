// Configuração do runner automático do outbox de billing (macrofrente 3A-2, §6).
//
// Parsing ESTRITO, sem segredo. Desabilitado por padrão: ambientes que não devem
// processar (ex.: produção nesta frente) ficam OFF a menos que ligados
// explicitamente. Valores sanos e limitados.

const DEFAULTS = Object.freeze({
  enabled: false,          // OFF por padrão (produção proibida nesta frente)
  intervalSeconds: 30,     // cadência do runner in-process
  batchSize: 10,           // eventos por rodada
});

function parseBoolEstrito(v, fallback) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return fallback;
}

function parseIntEmFaixa(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveRunnerConfig(env = process.env) {
  return Object.freeze({
    enabled: parseBoolEstrito(env.BILLING_OUTBOX_ENABLED, DEFAULTS.enabled),
    intervalSeconds: parseIntEmFaixa(env.BILLING_OUTBOX_INTERVAL_SECONDS, DEFAULTS.intervalSeconds, 5, 3600),
    batchSize: parseIntEmFaixa(env.BILLING_OUTBOX_BATCH_SIZE, DEFAULTS.batchSize, 1, 50),
  });
}

module.exports = { DEFAULTS, resolveRunnerConfig, parseBoolEstrito, parseIntEmFaixa };

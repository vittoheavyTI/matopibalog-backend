// Políticas comerciais/financeiras CONFIGURÁVEIS do billing (macrofrente 3A-2).
//
// Nenhuma decisão financeira fica "escondida" em hardcode. Toda regra sensível
// (quando cobrar implantação, prazo de graça, modo do provedor) sai daqui, com
// default EXPLÍCITO e sobrescrevível por env/config. Fixtures de teste devem
// escolher a política explicitamente (§15/§32).
//
// IMPORTANTE: o modo do provedor NUNCA é 'production' por padrão. Writes em Asaas
// produção são proibidos nesta frente; o modo real permitido é apenas 'sandbox',
// e mesmo assim gated por ambiente inequívoco (ver billingProvider).

const POLITICAS_IMPLANTACAO = Object.freeze([
  'imediato', // cobra a implantação assim que o billing é garantido
  'fim_trial', // cobra a implantação no fim do trial
  'primeira_fatura', // anexa a implantação à primeira mensalidade exigível
  'nao_cobrar', // não cobra implantação (ex.: "grátis no lançamento")
]);

const MODOS_PROVIDER = Object.freeze(['fake', 'sandbox']); // 'production' proibido aqui

const DEFAULTS = Object.freeze({
  // Sem configuração explícita, NÃO cobramos implantação automaticamente — é a
  // opção mais conservadora e coerente com o "grátis no lançamento" atual. Deve
  // ser sobrescrita por decisão comercial explícita.
  implantacao_timing: 'nao_cobrar',
  // Prazo de graça pós-vencimento antes de suspender (dias). Default explícito e
  // conservador; produção deve confirmar. Sandbox/fixtures escolhem o valor.
  grace_period_days: 5,
  // Modo do provedor de billing. 'fake' por padrão (offline, testes). 'sandbox'
  // só quando o ambiente for inequivocamente sandbox.
  provider_mode: 'fake',
  // Ciclo de cobrança padrão.
  billing_cycle: 'MONTHLY',
});

function parseIntSeguro(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// Resolve a política efetiva. Precedência: override explícito > env > default.
// `overrides` permite que fixtures/testes definam a política de forma explícita.
function resolvePolicy(overrides = {}, env = process.env) {
  const implantacaoTiming = overrides.implantacao_timing
    || env.BILLING_IMPLANTACAO_TIMING
    || DEFAULTS.implantacao_timing;

  const providerMode = overrides.provider_mode
    || env.BILLING_PROVIDER_MODE
    || DEFAULTS.provider_mode;

  const graceDays = overrides.grace_period_days != null
    ? parseIntSeguro(overrides.grace_period_days, DEFAULTS.grace_period_days)
    : parseIntSeguro(env.BILLING_GRACE_DAYS, DEFAULTS.grace_period_days);

  const policy = {
    implantacao_timing: POLITICAS_IMPLANTACAO.includes(implantacaoTiming)
      ? implantacaoTiming
      : DEFAULTS.implantacao_timing,
    grace_period_days: graceDays,
    provider_mode: MODOS_PROVIDER.includes(providerMode) ? providerMode : DEFAULTS.provider_mode,
    billing_cycle: overrides.billing_cycle || DEFAULTS.billing_cycle,
  };
  return Object.freeze(policy);
}

module.exports = {
  POLITICAS_IMPLANTACAO,
  MODOS_PROVIDER,
  DEFAULTS,
  resolvePolicy,
};

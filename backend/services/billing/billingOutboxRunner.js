// Runner automático do outbox de billing (macrofrente 3A-2, §4/§5/§7).
//
// Chama processarOutbox() periodicamente SEM intervenção humana. Duas formas:
//   - one-shot: `executarUmaRodada()` (para script/cron do Railway);
//   - in-process: `iniciarRunner()`/`pararRunner()` (setInterval, opt-in por env).
//
// MULTI-RÉPLICA (§5/§19): o setInterval local NÃO é a garantia de exclusividade.
// A exclusividade vem do CLAIM CAS do outbox (reivindicarProximo) + dedupe_key
// UNIQUE. Portanto o runner pode existir em todas as réplicas: cada evento é
// processado uma vez logicamente. Provado em teste (2 runners concorrentes).
//
// Robustez: erro de uma rodada NÃO derruba o servidor; provider por política
// (fake|sandbox; produção fail-closed); logs sanitizados; shutdown limpo.

const { processarOutbox } = require('./billingOutboxWorker');
const { resolveRunnerConfig } = require('./billingRunnerConfig');

// Executa UMA rodada. Nunca lança (captura e reporta). Retorna o resumo.
async function executarUmaRodada({ supabase, provider, policyOverrides, deps, outboxRepo, batchSize, agora } = {}) {
  try {
    const cfg = resolveRunnerConfig();
    const limite = batchSize || cfg.batchSize;
    return await processarOutbox({ supabase, provider, policyOverrides, deps, outboxRepo, limite, agora });
  } catch (err) {
    // Sanitização mínima: não vaza segredo/stack.
    const msg = String(err && err.message ? err.message : err).slice(0, 200);
    return { processados: 0, falhados: 0, mortos: 0, vazios: 0, erro_rodada: msg };
  }
}

// Runner in-process. Retorna um controlador { parar }.
//   deps injetáveis para teste (setIntervalFn/clearIntervalFn/onTick).
function iniciarRunner({ supabase, provider, policyOverrides, config, setIntervalFn = setInterval, clearIntervalFn = clearInterval, onTick } = {}) {
  const cfg = config || resolveRunnerConfig();
  if (!cfg.enabled) {
    return { ativo: false, parar: () => {}, motivo: 'runner_desabilitado' };
  }
  let rodando = false;
  const tick = async () => {
    if (rodando) return; // evita sobreposição de rodadas
    rodando = true;
    try {
      const resumo = await executarUmaRodada({ supabase, provider, policyOverrides, batchSize: cfg.batchSize });
      if (onTick) onTick(resumo);
    } finally {
      rodando = false;
    }
  };
  const handle = setIntervalFn(tick, cfg.intervalSeconds * 1000);
  if (handle && typeof handle.unref === 'function') handle.unref(); // não segura o processo
  return {
    ativo: true,
    parar: () => { try { clearIntervalFn(handle); } catch { /* noop */ } },
    _tick: tick, // exposto para teste
  };
}

module.exports = { executarUmaRodada, iniciarRunner };

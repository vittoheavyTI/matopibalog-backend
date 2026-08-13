// Worker do outbox de billing (macrofrente 3A-2, §6/§17/§18).
//
// Reivindica eventos pendentes (claim CAS) e roda ensureBillingState com o
// provider (fake|sandbox, nunca produção). Idempotente e com retry limitado:
// erro transitório → failed (retry com backoff); esgotou → dead (manual_attention).
//
// NÃO chama Asaas diretamente: delega ao billingOrchestratorService, que usa o
// provider injetado. O worker pode ser acionado por job/cron OU por endpoint de
// contingência — mesma lógica (sem caminhos divergentes).

const outboxReal = require('./billingOutboxRepository');
const { ensureBillingStateComDeps } = require('./billingOrchestratorService');
const { criarDepsSupabase } = require('./billingSupabaseDeps');

// Processa até `limite` eventos. Recebe:
//   supabase, provider (injetado), policyOverrides, deps (opcional; default supabase),
//   outboxRepo (opcional; default repositório Supabase — testes injetam in-memory),
//   limite, agora.
async function processarOutbox({ supabase, provider, policyOverrides = {}, deps, outboxRepo, limite = 10, agora = new Date() } = {}) {
  const outbox = outboxRepo || outboxReal;
  const usarDeps = deps || criarDepsSupabase(supabase);
  const resumo = { processados: 0, falhados: 0, mortos: 0, vazios: 0, detalhes: [] };

  for (let i = 0; i < limite; i += 1) {
    const claim = await outbox.reivindicarProximo(supabase, { agora });
    if (claim.code === 'empty' || claim.code === 'lost_all') { resumo.vazios += 1; break; }
    if (claim.code === 'db_error' || !claim.evento) { resumo.vazios += 1; break; }

    const evento = claim.evento;
    try {
      const r = await ensureBillingStateComDeps({
        empresaId: evento.empresa_id,
        deps: usarDeps,
        provider,
        policyOverrides,
        agora,
      });
      await outbox.marcarProcessado(supabase, evento.id, { agora });
      resumo.processados += 1;
      resumo.detalhes.push({ id: evento.id, tipo: evento.event_type, acoes: (r.resultados || []).length });
    } catch (err) {
      const fail = await outbox.marcarFalhou(supabase, evento, err && err.message, { agora });
      if (fail.code === 'dead') resumo.mortos += 1; else resumo.falhados += 1;
      const sanitizar = outbox.sanitizarErro || outboxReal.sanitizarErro;
      resumo.detalhes.push({ id: evento.id, tipo: evento.event_type, erro: sanitizar(err && err.message) });
    }
  }

  return resumo;
}

module.exports = { processarOutbox };

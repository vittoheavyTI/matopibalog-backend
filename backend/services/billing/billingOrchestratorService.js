// Orquestrador de billing (I/O) — macrofrente 3A-2.
//
// Compõe o cérebro PURO (billingOrchestratorDomainService.planejarBilling) com um
// PROVIDER injetável (fake/sandbox, ou production somente atrás do gate) e persiste o
// resultado de forma idempotente. É o ponto único de automação: chamado quando o
// estado comercial muda (ensureBillingState) e também pela contingência manual —
// mesmo motor, sem lógica duplicada (§23/§24/§37).
//
// Padrão seguro (§26): estado local pending → chamada externa → persistir resultado
// → reconciliação idempotente. Nunca segura transação SQL longa em volta do Asaas.

const { planejarBilling } = require('./billingOrchestratorDomainService');
const { resolvePolicy } = require('./billingPolicyConfig');
const { FakeAsaasProvider } = require('./fakeAsaasProvider');
const { AsaasSandboxProvider, ehSandbox } = require('./asaasSandboxProvider');
const { AsaasProductionProvider } = require('./asaasProductionProvider');
const { PROVIDER_PRODUCTION, avaliarBillingProductionGate } = require('./billingProductionGate');

// Lock cooperativo por empresa: serializa ensureBillingState concorrentes para a
// MESMA empresa, garantindo idempotência (10 chamadas concorrentes → 1 customer).
const _locks = new Map();
async function comLock(chave, fn) {
  const anterior = _locks.get(chave) || Promise.resolve();
  let liberar;
  const atual = new Promise((r) => { liberar = r; });
  _locks.set(chave, anterior.then(() => atual));
  try {
    await anterior.catch(() => {});
    return await fn();
  } finally {
    liberar();
    if (_locks.get(chave) === anterior.then(() => atual)) _locks.delete(chave);
  }
}

// Retry só para erros TRANSITÓRIOS (timeout/429/5xx). 4xx de negócio não repete (§22).
function ehTransitorio(err) {
  const s = err && (err.httpStatus ?? err.status);
  if (s === 0 || err?.code === 'ETIMEDOUT') return true;
  if (s === 429) return true;
  if (typeof s === 'number' && s >= 500) return true;
  return false;
}

async function comRetry(fn, { tentativas = 3, baseMs = 5, onRetry } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (!ehTransitorio(err) || i === tentativas - 1) throw err;
      if (onRetry) onRetry(i + 1, err);
      const espera = Math.min(2000, baseMs * 2 ** i);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimo;
}

// Seleciona o provider conforme a política. Produção só é construída atrás
// do gate cumulativo + allowlist; qualquer lacuna falha antes do adapter HTTP.
//   opts.providerOverride : injeta um provider pronto (testes usam o fake).
//   opts.asaasConfig      : { environment, baseURL, apiKey } para o sandbox real.
//   opts.http             : cliente HTTP (axios) para o adapter sandbox.
function selecionarProvider(policy, { providerOverride, asaasConfig, http, empresaId, env = process.env } = {}) {
  if (providerOverride) return providerOverride;

  // Produção exige provider_mode dedicado e gate cumulativo.
  if (policy.provider_mode === 'production' || String(asaasConfig?.environment || '').toLowerCase() === 'production') {
    throw new Error('Asaas produção é PROIBIDO sem provider_mode=asaas_production e gate cumulativo (fail-closed).');
  }

  if (policy.provider_mode === 'fake') return new FakeAsaasProvider();

  if (policy.provider_mode === PROVIDER_PRODUCTION) {
    const gate = avaliarBillingProductionGate({ empresaId, operation: 'billing_orchestrator', env });
    if (!gate.allowed) {
      throw new Error(`Asaas production bloqueado: ${gate.failures.join(',')}`);
    }
    return new AsaasProductionProvider({
      config: { environment: 'production', baseURL: gate.baseURL, apiKey: env.ASAAS_API_KEY },
      http,
    });
  }

  if (policy.provider_mode === 'sandbox') {
    // Só constrói o adapter real se o ambiente for INEQUIVOCAMENTE sandbox e a
    // credencial estiver presente. Caso contrário, falha explicitamente (nunca
    // cai silenciosamente em produção).
    if (!asaasConfig || !ehSandbox(asaasConfig)) {
      throw new Error('provider sandbox recusado: prova de ambiente sandbox ausente/insuficiente.');
    }
    if (!asaasConfig.apiKey) {
      throw new Error('provider sandbox recusado: credencial sandbox ausente.');
    }
    return new AsaasSandboxProvider({ config: asaasConfig, http });
  }

  throw new Error(`provider_mode inválido: ${policy.provider_mode}`);
}

// Executa o plano de ações de forma IDEMPOTENTE. Recebe callbacks de persistência
// para ser testável sem banco. Devolve { patch, resultados }.
//   empresa  : { id, nome, cnpj, email_contato, asaas_customer_id, asaas_subscription_id, implantacao_cobrada }
//   provider : contrato do provider (fake|real)
//   persist  : async (patch) => void  (grava colunas de billing na empresa)
async function executarPlano({ acoes = [], empresa = {}, snapshot = {}, provider, persist, retry = comRetry }) {
  const patch = {};
  const resultados = [];
  // Estado corrente combina o que veio + o que já aplicamos nesta execução.
  const estado = { ...empresa };

  for (const a of acoes) {
    if (a.tipo === 'garantir_customer') {
      if (estado.asaas_customer_id) { resultados.push({ tipo: a.tipo, skip: true }); continue; }
      const r = await retry(() => provider.createCustomer({ empresa: estado }));
      estado.asaas_customer_id = r.id;
      patch.asaas_customer_id = r.id;
      resultados.push({ tipo: a.tipo, created: true, id: r.id });
      if (persist) await persist({ asaas_customer_id: r.id });
    } else if (a.tipo === 'garantir_assinatura') {
      if (estado.asaas_subscription_id) { resultados.push({ tipo: a.tipo, skip: true }); continue; }
      const r = await retry(() => provider.createSubscription({
        customerId: estado.asaas_customer_id,
        value: a.valor_mensal,
        nextDueDate: a.primeiro_vencimento,
        cycle: a.billing_cycle,
        externalReference: estado.id,
      }));
      estado.asaas_subscription_id = r.id;
      estado.billing_valor_mensal = a.valor_mensal;
      patch.asaas_subscription_id = r.id;
      patch.next_due_date = a.primeiro_vencimento;
      patch.billing_valor_mensal = a.valor_mensal;
      resultados.push({ tipo: a.tipo, created: true, id: r.id, next_due_date: a.primeiro_vencimento });
      if (persist) await persist({ asaas_subscription_id: r.id, next_due_date: a.primeiro_vencimento, billing_valor_mensal: a.valor_mensal });
    } else if (a.tipo === 'atualizar_assinatura_valor') {
      // Convergência de plano alterado (§1.3): idempotente (skip se já no valor).
      if (Number(estado.billing_valor_mensal) === Number(a.valor_mensal)) { resultados.push({ tipo: a.tipo, skip: true }); continue; }
      await retry(() => provider.updateSubscription({ subscriptionId: a.subscription_id, value: a.valor_mensal }));
      estado.billing_valor_mensal = a.valor_mensal;
      patch.billing_valor_mensal = a.valor_mensal;
      resultados.push({ tipo: a.tipo, updated: true, valor: a.valor_mensal });
      if (persist) await persist({ billing_valor_mensal: a.valor_mensal });
    } else if (a.tipo === 'cancelar_assinatura') {
      // Convergência de cancelamento (§1.5): idempotente.
      if (estado.assinatura_cancelada === true) { resultados.push({ tipo: a.tipo, skip: true }); continue; }
      await retry(() => provider.cancelSubscription({ subscriptionId: a.subscription_id }));
      estado.assinatura_cancelada = true;
      patch.assinatura_cancelada = true;
      patch.billing_status = 'cancelada';
      resultados.push({ tipo: a.tipo, cancelled: true });
      if (persist) await persist({ assinatura_cancelada: true, billing_status: 'cancelada' });
    } else if (a.tipo === 'remover_addon') {
      // Convergência de add-on removido (§1.4).
      await retry(() => provider.cancelComponent({ componentId: a.componente }));
      resultados.push({ tipo: a.tipo, removed: true, addon_id: a.addon_id });
      if (persist) await persist({ __addon_removido: { addon_id: a.addon_id } });
    } else if (a.tipo === 'cobrar_implantacao') {
      if (estado.implantacao_cobrada) { resultados.push({ tipo: a.tipo, skip: true }); continue; }
      const r = await retry(() => provider.createCharge({
        customerId: estado.asaas_customer_id,
        value: a.valor,
        dueDate: a.vencimento,
        description: 'Implantação',
        externalReference: `${estado.id}:implantacao`,
      }));
      estado.implantacao_cobrada = true;
      patch.implantacao_cobrada = true;
      resultados.push({ tipo: a.tipo, created: true, id: r.id, valor: a.valor });
      if (persist) await persist({ implantacao_cobrada: true });
    } else if (a.tipo === 'garantir_addon') {
      if (a.componente) { resultados.push({ tipo: a.tipo, skip: true, addon_id: a.addon_id }); continue; }
      const r = await retry(() => provider.createCharge({
        customerId: estado.asaas_customer_id,
        value: (a.preco_mensal_centavos || 0) / 100,
        dueDate: patch.next_due_date || estado.next_due_date || null,
        description: `Add-on ${a.funcionalidade_id || ''}`.trim(),
        externalReference: `${estado.id}:addon:${a.addon_id}`,
      }));
      resultados.push({ tipo: a.tipo, created: true, id: r.id, addon_id: a.addon_id });
      if (persist) await persist({ __addon: { addon_id: a.addon_id, billing_component_id: r.id } });
    } else {
      resultados.push({ tipo: a.tipo, skip: true, motivo: 'acao_desconhecida' });
    }
  }

  return { patch, resultados };
}

// Versão pura/injetável para testes: recebe deps explícitas (sem supabase real).
//   deps.carregarSituacao(empresaId) -> situacao
//   deps.carregarEmpresaBilling(empresaId) -> empresa (colunas billing)
//   deps.carregarSnapshot(empresaId) -> snapshot comercial
//   deps.carregarAddOns(empresaId) -> [empresa_funcionalidades]
//   deps.persist(empresaId, patch) -> void
//   provider, policyOverrides, agora
async function ensureBillingStateComDeps({ empresaId, deps, provider, policyOverrides = {}, agora = new Date(), asaasConfig, http, env }) {
  return comLock(`ensure:${empresaId}`, async () => {
    const policy = resolvePolicy(policyOverrides);
    const prov = provider || selecionarProvider(policy, { asaasConfig, http, empresaId, env });

    const situacao = await deps.carregarSituacao(empresaId);
    const empresa = await deps.carregarEmpresaBilling(empresaId);
    const snapshot = await deps.carregarSnapshot(empresaId);
    const addOns = deps.carregarAddOns ? await deps.carregarAddOns(empresaId) : [];

    const plano = planejarBilling({ situacao, empresaBilling: empresa, snapshot, addOns, policy, agora });

    if (!plano.requer_billing || plano.acoes.length === 0) {
      return { empresaId, requer_billing: plano.requer_billing, acoes: [], resultados: [], motivo: plano.motivo, policy };
    }

    const persist = deps.persist ? (patch) => deps.persist(empresaId, patch) : null;
    const { patch, resultados } = await executarPlano({ acoes: plano.acoes, empresa: { id: empresaId, ...empresa }, snapshot, provider: prov, persist });
    return { empresaId, requer_billing: true, acoes: plano.acoes, resultados, patch, motivo: plano.motivo, policy };
  });
}

module.exports = {
  comLock,
  ehTransitorio,
  comRetry,
  selecionarProvider,
  executarPlano,
  ensureBillingStateComDeps,
};

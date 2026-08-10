// Orquestrador de billing (I/O) — macrofrente 3A-2.
//
// Compõe o cérebro PURO (billingOrchestratorDomainService.planejarBilling) com um
// PROVIDER injetável (fake em teste; sandbox no gate; NUNCA produção) e persiste o
// resultado de forma idempotente. É o ponto único de automação: chamado quando o
// estado comercial muda (ensureBillingState) e também pela contingência manual —
// mesmo motor, sem lógica duplicada (§23/§24/§37).
//
// Padrão seguro (§26): estado local pending → chamada externa → persistir resultado
// → reconciliação idempotente. Nunca segura transação SQL longa em volta do Asaas.

const { planejarBilling } = require('./billingOrchestratorDomainService');
const { resolvePolicy } = require('./billingPolicyConfig');
const { FakeAsaasProvider } = require('./fakeAsaasProvider');

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

// Seleciona o provider conforme a política. NUNCA retorna adapter de produção.
function selecionarProvider(policy, { providerOverride } = {}) {
  if (providerOverride) return providerOverride; // testes injetam o fake
  if (policy.provider_mode === 'fake') return new FakeAsaasProvider();
  if (policy.provider_mode === 'sandbox') {
    // Guarda dura: o adapter real de sandbox é plugado no gate, com prova de
    // ambiente. Enquanto não plugado/aprovado, falha explicitamente — nunca cai
    // silenciosamente em produção.
    throw new Error('provider sandbox não plugado neste ambiente (gate 3A-2); use fake ou injete o adapter.');
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
      patch.asaas_subscription_id = r.id;
      patch.next_due_date = a.primeiro_vencimento;
      resultados.push({ tipo: a.tipo, created: true, id: r.id, next_due_date: a.primeiro_vencimento });
      if (persist) await persist({ asaas_subscription_id: r.id, next_due_date: a.primeiro_vencimento });
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
async function ensureBillingStateComDeps({ empresaId, deps, provider, policyOverrides = {}, agora = new Date() }) {
  return comLock(`ensure:${empresaId}`, async () => {
    const policy = resolvePolicy(policyOverrides);
    const prov = provider || selecionarProvider(policy);

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

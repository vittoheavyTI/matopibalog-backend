// Cérebro PURO da orquestração de billing (macrofrente 3A-2).
//
// Dado o estado comercial canônico (situacaoComercialDomainService) + o estado de
// billing local (mapeamentos Asaas já existentes na empresa) + a política
// configurável, decide a LISTA IDEMPOTENTE de ações de billing a executar.
//
// NÃO fala com banco nem com Asaas. NÃO tem efeito colateral. O executor (I/O)
// aplica as ações via provedor injetável (fake em teste, sandbox no gate).
//
// Regras canônicas honradas aqui:
//   - TRIAL não é cancelado por pagamento/contrato/assinatura (§13). Enquanto o
//     trial é válido, NENHUMA mensalidade é exigível antes de trial_end (§14): a
//     assinatura é criada com primeiro vencimento = trial_end.
//   - Implantação segue a POLÍTICA configurável (§15) — nunca hardcode.
//   - Idempotência (§10): ações já satisfeitas (customer/subscription existentes)
//     NÃO são repetidas.
//   - Bloqueio comercial (suspensa/bloqueada/cancelada) → nenhuma cobrança nova.

// Situações em que faz sentido garantir a estrutura de billing (customer/assinatura).
const SITUACOES_COM_BILLING = new Set([
  'trial_ativo',
  'trial_expirando',
  'trial_expirado_aguardando_decisao',
  'conversao_aguardando_pagamento',
  'ativa',
]);

// Situações em que NÃO se cria cobrança nova (só consulta/contingência).
const SITUACOES_SEM_COBRANCA_NOVA = new Set([
  'suspensa_financeiramente',
  'bloqueada_administrativamente',
  'cancelada',
  'trial_encerrado_sem_contratacao',
]);

function acao(tipo, payload = {}) {
  return { tipo, ...payload };
}

// Deriva o primeiro vencimento da mensalidade: nunca antes de trial_end.
function primeiroVencimentoMensalidade({ trialEndsAt, agora }) {
  const hoje = agora instanceof Date ? agora : new Date(agora || Date.now());
  const fimTrial = trialEndsAt ? new Date(trialEndsAt) : null;
  if (fimTrial && !Number.isNaN(fimTrial.getTime()) && fimTrial.getTime() > hoje.getTime()) {
    return fimTrial.toISOString().slice(0, 10);
  }
  // Sem trial futuro → primeira exigibilidade a partir de hoje.
  return hoje.toISOString().slice(0, 10);
}

// Decide se/quando a implantação entra, conforme política. Devolve a ação de
// implantação (ou null). Não cobra se já foi cobrada (implantacaoJaCobrada).
function planejarImplantacao({ situacao, policy, snapshot, trialEndsAt, agora, implantacaoJaCobrada }) {
  const valor = Number(snapshot?.valor_implantacao || 0);
  if (!(valor > 0)) return null; // sem valor → nada a cobrar
  if (implantacaoJaCobrada) return null; // idempotência
  if (policy.implantacao_timing === 'nao_cobrar') return null;

  if (policy.implantacao_timing === 'imediato') {
    return acao('cobrar_implantacao', { valor, quando: 'imediato', vencimento: (agora instanceof Date ? agora : new Date()).toISOString().slice(0, 10) });
  }
  if (policy.implantacao_timing === 'fim_trial') {
    return acao('cobrar_implantacao', { valor, quando: 'fim_trial', vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }) });
  }
  if (policy.implantacao_timing === 'primeira_fatura') {
    // Anexa à primeira mensalidade (mesmo vencimento). O executor decide unir.
    return acao('cobrar_implantacao', { valor, quando: 'primeira_fatura', vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }) });
  }
  return null;
}

// Planeja add-ons faturáveis (empresa_funcionalidades ativas com preço/origem
// adicional). Idempotente: cada add-on vira um componente identificável.
function planejarAddOns({ addOns }) {
  const lista = Array.isArray(addOns) ? addOns : [];
  const acoes = [];
  for (const a of lista) {
    if (!a || a.status !== 'ativa') continue;
    const preco = Number(a.preco_mensal_centavos || 0);
    if (!(preco > 0)) continue;
    acoes.push(acao('garantir_addon', {
      addon_id: a.id,
      funcionalidade_id: a.funcionalidade_id,
      preco_mensal_centavos: preco,
      componente: a.billing_component_id || null,
    }));
  }
  return acoes;
}

// Núcleo. Recebe:
//   input.situacao  : saída do situacaoComercialDomainService (situacao, ...)
//   input.empresaBilling : { asaas_customer_id, asaas_subscription_id, billing_status,
//                            next_due_date, implantacao_cobrada }
//   input.snapshot  : snapshot comercial (valor_mensal, valor_implantacao, trial_dias)
//   input.addOns    : empresa_funcionalidades faturáveis
//   input.policy    : resolvePolicy(...)
//   input.agora     : Date
// Devolve { acoes: [...], motivo, requer_billing }.
function planejarBilling(input = {}) {
  const situ = input.situacao || {};
  const billing = input.empresaBilling || {};
  const snapshot = input.snapshot || {};
  const policy = input.policy || {};
  const agora = input.agora instanceof Date ? input.agora : new Date(input.agora || Date.now());
  const trialEndsAt = situ.trial_ends_at || snapshot.trial_ends_at || null;

  const situacao = situ.situacao || null;
  const base = { acoes: [], motivo: null, requer_billing: false, situacao };

  // Estados sem cobrança nova: nada a fazer automaticamente (contingência pode reconciliar).
  if (SITUACOES_SEM_COBRANCA_NOVA.has(situacao)) {
    return { ...base, motivo: `sem_cobranca_nova:${situacao}` };
  }

  // Estados que ainda não têm billing (ex.: aguardando assinatura de contrato):
  // não criamos estrutura financeira antes da hora.
  if (!SITUACOES_COM_BILLING.has(situacao)) {
    return { ...base, motivo: `billing_nao_aplicavel:${situacao || 'desconhecida'}` };
  }

  base.requer_billing = true;
  const acoes = [];

  // 1) Customer Asaas (idempotente).
  if (!billing.asaas_customer_id) {
    acoes.push(acao('garantir_customer'));
  }

  // 2) Assinatura mensal (idempotente). Primeiro vencimento nunca antes de trial_end.
  if (!billing.asaas_subscription_id) {
    acoes.push(acao('garantir_assinatura', {
      valor_mensal: Number(snapshot.valor_mensal || 0),
      primeiro_vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }),
      billing_cycle: policy.billing_cycle || 'MONTHLY',
      respeita_trial: Boolean(trialEndsAt),
    }));
  }

  // 3) Implantação conforme política (§15).
  const implantacao = planejarImplantacao({
    situacao,
    policy,
    snapshot,
    trialEndsAt,
    agora,
    implantacaoJaCobrada: billing.implantacao_cobrada === true,
  });
  if (implantacao) acoes.push(implantacao);

  // 4) Add-ons faturáveis (§16).
  for (const a of planejarAddOns({ addOns: input.addOns })) acoes.push(a);

  return {
    ...base,
    acoes,
    motivo: acoes.length === 0 ? 'nada_a_fazer_idempotente' : `planejado:${situacao}`,
  };
}

module.exports = {
  SITUACOES_COM_BILLING,
  SITUACOES_SEM_COBRANCA_NOVA,
  primeiroVencimentoMensalidade,
  planejarImplantacao,
  planejarAddOns,
  planejarBilling,
};

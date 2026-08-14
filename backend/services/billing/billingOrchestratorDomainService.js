// Cerebro puro da orquestracao de billing (macrofrente 3A-2).
//
// Decide a lista idempotente de acoes a partir do estado comercial canonico,
// estado local de billing, snapshot comercial, add-ons e policy. Nao fala com
// banco nem com Asaas; o executor I/O aplica as acoes via provider injetavel.

const SITUACOES_COM_BILLING = new Set([
  'trial_ativo',
  'trial_expirando',
  'trial_expirado_aguardando_decisao',
  'conversao_aguardando_pagamento',
  'ativa',
]);

const SITUACOES_SEM_COBRANCA_NOVA = new Set([
  'suspensa_financeiramente',
  'bloqueada_administrativamente',
  'cancelada',
  'trial_encerrado_sem_contratacao',
]);

const ADDON_BILLING_CONTRACT_STATUSES = new Set([
  'plenamente_assinado',
  'assinado',
  'aceito_manualmente',
]);

function acao(tipo, payload = {}) {
  return { tipo, ...payload };
}

function statusContratoBilling(a = {}) {
  return String(a.contrato_billing_status || a.contrato_status || '').trim().toLowerCase();
}

function statusAditivoBilling(a = {}) {
  return String(a.aditivo_billing_status || a.aditivo_status || '').trim().toLowerCase();
}

function addonAceitoParaBilling(a = {}) {
  const contratoConcluido = a.contrato_id && ADDON_BILLING_CONTRACT_STATUSES.has(statusContratoBilling(a));
  const aditivoConcluido = a.aditivo_id && ADDON_BILLING_CONTRACT_STATUSES.has(statusAditivoBilling(a));
  return Boolean(contratoConcluido || aditivoConcluido);
}

function addonVigenteParaBilling(a = {}, agora = new Date()) {
  const hoje = agora instanceof Date ? agora : new Date(agora || Date.now());
  const inicio = a.vigencia_inicio || null;
  const fim = a.vigencia_fim || null;
  if (inicio) {
    const d = new Date(inicio);
    if (!Number.isNaN(d.getTime()) && d.getTime() > hoje.getTime()) return false;
  }
  if (fim) {
    const d = new Date(fim);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= hoje.getTime()) return false;
  }
  return true;
}

function addonQuantidadeValida(a = {}) {
  if (a.quantidade == null) return true;
  const n = Number(a.quantidade);
  return Number.isInteger(n) && n >= 1;
}

function addonValorMensalCentavos(a = {}) {
  const preco = Number(a?.preco_mensal_centavos || 0);
  if (!(preco > 0)) return 0;
  if (!addonQuantidadeValida(a)) return 0;
  // preco_mensal_centavos e o valor mensal TOTAL negociado do add-on. A
  // quantidade e escopo/auditoria e nao multiplica o preco neste modelo.
  return preco;
}

function calcularValorMensalComposicao({ snapshot, addOns, agora }) {
  const base = Number(snapshot?.valor_mensal || 0);
  const lista = Array.isArray(addOns) ? addOns : [];
  const addonCentavos = lista.reduce((total, a) => {
    const ativo = a?.status === 'ativa';
    const preco = addonValorMensalCentavos(a);
    if (!ativo || !(preco > 0)) return total;
    if (!addonAceitoParaBilling(a)) return total;
    if (!addonVigenteParaBilling(a, agora)) return total;
    return total + preco;
  }, 0);
  return Math.round((base + addonCentavos / 100) * 100) / 100;
}

function primeiroVencimentoMensalidade({ trialEndsAt, agora }) {
  const hoje = agora instanceof Date ? agora : new Date(agora || Date.now());
  const fimTrial = trialEndsAt ? new Date(trialEndsAt) : null;
  if (fimTrial && !Number.isNaN(fimTrial.getTime()) && fimTrial.getTime() > hoje.getTime()) {
    return fimTrial.toISOString().slice(0, 10);
  }
  return hoje.toISOString().slice(0, 10);
}

function planejarImplantacao({ policy, snapshot, trialEndsAt, agora, implantacaoJaCobrada }) {
  const valor = Number(snapshot?.valor_implantacao || 0);
  if (!(valor > 0)) return null;
  if (implantacaoJaCobrada) return null;
  if (policy.implantacao_timing === 'nao_cobrar') return null;

  if (policy.implantacao_timing === 'imediato') {
    return acao('cobrar_implantacao', {
      valor,
      quando: 'imediato',
      vencimento: (agora instanceof Date ? agora : new Date()).toISOString().slice(0, 10),
    });
  }
  if (policy.implantacao_timing === 'fim_trial') {
    return acao('cobrar_implantacao', {
      valor,
      quando: 'fim_trial',
      vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }),
    });
  }
  if (policy.implantacao_timing === 'primeira_fatura') {
    return acao('cobrar_implantacao', {
      valor,
      quando: 'primeira_fatura',
      vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }),
    });
  }
  return null;
}

// Add-on mensal nao cria payment avulso. Ele so entra na composicao mensal da
// subscription quando houver aceite comercial explicito. Sem aceite, sinaliza
// fail-closed para auditoria e cobra zero add-on.
function planejarAddOns({ addOns }) {
  const lista = Array.isArray(addOns) ? addOns : [];
  const acoes = [];
  for (const a of lista) {
    if (!a) continue;
    const ativo = a.status === 'ativa';
    const preco = Number(a.preco_mensal_centavos || 0);
    if (ativo && preco > 0 && !addonAceitoParaBilling(a)) {
      acoes.push(acao('addon_sem_aceite_billing', {
        addon_id: a.id,
        funcionalidade_id: a.funcionalidade_id,
      }));
    } else if (ativo && preco > 0 && !addonQuantidadeValida(a)) {
      acoes.push(acao('addon_quantidade_invalida_billing', {
        addon_id: a.id,
        funcionalidade_id: a.funcionalidade_id,
      }));
    }
  }
  return acoes;
}

function planejarBilling(input = {}) {
  const situ = input.situacao || {};
  const billing = input.empresaBilling || {};
  const snapshot = input.snapshot || {};
  const policy = input.policy || {};
  const agora = input.agora instanceof Date ? input.agora : new Date(input.agora || Date.now());
  const trialEndsAt = situ.trial_ends_at || snapshot.trial_ends_at || null;

  const situacao = situ.situacao || null;
  const base = { acoes: [], motivo: null, requer_billing: false, situacao };
  const CANCELADAS = new Set(['cancelada', 'cancelado']);

  if (CANCELADAS.has(situacao)) {
    const acoesCancel = [];
    if (billing.asaas_subscription_id && billing.assinatura_cancelada !== true) {
      acoesCancel.push(acao('cancelar_assinatura', { subscription_id: billing.asaas_subscription_id }));
    }
    return {
      ...base,
      requer_billing: acoesCancel.length > 0,
      acoes: acoesCancel,
      motivo: acoesCancel.length ? 'cancelar_assinatura' : 'cancelada_sem_assinatura',
    };
  }

  if (SITUACOES_SEM_COBRANCA_NOVA.has(situacao)) {
    return { ...base, motivo: `sem_cobranca_nova:${situacao}` };
  }

  if (!SITUACOES_COM_BILLING.has(situacao)) {
    return { ...base, motivo: `billing_nao_aplicavel:${situacao || 'desconhecida'}` };
  }

  base.requer_billing = true;
  const acoes = [];

  if (!billing.asaas_customer_id) {
    acoes.push(acao('garantir_customer'));
  }

  const valorEsperado = calcularValorMensalComposicao({ snapshot, addOns: input.addOns, agora });

  if (!billing.asaas_subscription_id) {
    acoes.push(acao('garantir_assinatura', {
      valor_mensal: valorEsperado,
      primeiro_vencimento: primeiroVencimentoMensalidade({ trialEndsAt, agora }),
      billing_cycle: policy.billing_cycle || 'MONTHLY',
      respeita_trial: Boolean(trialEndsAt),
    }));
  } else {
    const valorAtual = billing.billing_valor_mensal != null ? Number(billing.billing_valor_mensal) : null;
    if (valorAtual != null && Number.isFinite(valorEsperado) && Math.abs(valorAtual - valorEsperado) > 0.001) {
      acoes.push(acao('atualizar_assinatura_valor', {
        subscription_id: billing.asaas_subscription_id,
        valor_mensal: valorEsperado,
      }));
    }
  }

  const implantacao = planejarImplantacao({
    policy,
    snapshot,
    trialEndsAt,
    agora,
    implantacaoJaCobrada: billing.implantacao_cobrada === true,
  });
  if (implantacao) acoes.push(implantacao);

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
  ADDON_BILLING_CONTRACT_STATUSES,
  statusContratoBilling,
  statusAditivoBilling,
  addonAceitoParaBilling,
  addonVigenteParaBilling,
  addonQuantidadeValida,
  addonValorMensalCentavos,
  calcularValorMensalComposicao,
  planejarAddOns,
  planejarBilling,
};

// Visão administrativa PURA do billing por empresa (macrofrente 3A-2, §36).
//
// Monta a linha de "estado financeiro" que o Super Admin vê, a partir de dados já
// carregados (empresa + faturas + situação comercial + último webhook + última
// reconciliação). Não fala com banco. Não expõe segredos/IDs sensíveis completos.

const { avaliarInadimplencia } = require('./billingInadimplenciaDomainService');

// Mascara IDs externos para exibição (mostra prefixo + últimos 4).
function mascararId(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function ultimaCobranca(faturas) {
  const lista = (Array.isArray(faturas) ? faturas : []).filter(Boolean);
  if (lista.length === 0) return null;
  const ordenada = lista.slice().sort((a, b) => {
    const ta = new Date(a.created_at || a.criado_em || 0).getTime();
    const tb = new Date(b.created_at || b.criado_em || 0).getTime();
    return tb - ta;
  });
  const f = ordenada[0];
  return { status: f.status || null, valor: f.valor != null ? Number(f.valor) : null, vencimento: f.vencimento || f.due_date || null };
}

// Recebe:
//   empresa   : { id, nome, status, plano_id, trial_ends_at, asaas_customer_id,
//                 asaas_subscription_id, billing_status, next_due_date, billing_updated_at }
//   plano     : { nome } | null
//   faturas   : [{ status, valor, vencimento, created_at }]
//   situacao  : saída do situacaoComercialDomainService
//   ultimoWebhook : { event_type, status, processed_at } | null
//   gracaDias : da política
//   agora     : Date
function montarLinhaBilling({ empresa = {}, plano = null, faturas = [], situacao = {}, ultimoWebhook = null, gracaDias = 0, agora = new Date() } = {}) {
  const inad = avaliarInadimplencia({
    faturas,
    trialEndsAt: empresa.trial_ends_at || null,
    gracaDias,
    agora,
  });

  return {
    empresa_id: empresa.id || null,
    empresa_nome: empresa.nome || null,
    plano_nome: plano?.nome || null,
    situacao_comercial: situacao.situacao || null,
    trial_ends_at: empresa.trial_ends_at || null,
    // Estado de billing (mapeamentos mascarados — nunca o ID completo na lista).
    asaas_customer: mascararId(empresa.asaas_customer_id),
    tem_customer: Boolean(empresa.asaas_customer_id),
    asaas_subscription: mascararId(empresa.asaas_subscription_id),
    tem_assinatura: Boolean(empresa.asaas_subscription_id),
    billing_status: empresa.billing_status || null,
    proxima_cobranca: empresa.next_due_date || null,
    ultima_cobranca: ultimaCobranca(faturas),
    // Inadimplência derivada (autoridade comercial), trial preservado.
    inadimplente: inad.inadimplente,
    suspender: inad.suspender,
    em_graca: inad.em_graca,
    dias_atraso: inad.dias_atraso,
    trial_protege: inad.trial_protege,
    // Observabilidade.
    ultimo_webhook: ultimoWebhook ? { tipo: ultimoWebhook.event_type || null, status: ultimoWebhook.status || null, em: ultimoWebhook.processed_at || null } : null,
    billing_updated_at: empresa.billing_updated_at || null,
  };
}

module.exports = { montarLinhaBilling, mascararId, ultimaCobranca };

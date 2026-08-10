// Decisor PURO da reconciliação periódica (macrofrente 3A-2, §11/§15/§16).
//
// Safety net temporal e de recuperação: identifica empresas que precisam de um
// evento `reconciliacao` mesmo que NINGUÉM abra uma tela e mesmo que um gatilho
// de negócio tenha falhado (fail-open). Cobre especialmente:
//   - TRIAL FINALIZADO por RELÓGIO (§11): trial_ends_at passou e a conta ainda não
//     foi reconciliada recentemente → recalcular billing/situação;
//   - MAPEAMENTO AUSENTE: conta do fluxo novo, apta a billing, sem customer/assinatura;
//   - EVENTO PERDIDO: gatilho fail-open falhou → o periódico reenfileira.
//
// Puro: recebe linhas já carregadas e devolve a lista de { empresaId, motivo }.
// A dedupe_key por competência (dia) evita enfileirar repetido no mesmo período.

function toDate(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Considera "recém-vencido" um trial cujo fim está no passado dentro da janela.
function trialRecemVencido(trialEndsAt, agora, janelaDias) {
  const fim = toDate(trialEndsAt);
  if (!fim) return false;
  const diffDias = (agora.getTime() - fim.getTime()) / (24 * 60 * 60 * 1000);
  return diffDias >= 0 && diffDias <= janelaDias;
}

const STATUS_APTO_BILLING = ['ativo', 'trial', 'suspenso'];
function ehAptaBilling(row) {
  return row.commercial_flow_version === 'v2' && STATUS_APTO_BILLING.includes(String(row.status || ''));
}
function ehCancelada(row) {
  return ['cancelada', 'cancelado'].includes(String(row.status || ''));
}

// Conta do fluxo novo apta a billing sem CUSTOMER persistido.
function mapeamentoAusente(row) {
  return ehAptaBilling(row) && !row.asaas_customer_id;
}
// Apta, com customer, mas SEM assinatura (§1.2).
function assinaturaAusente(row) {
  return ehAptaBilling(row) && Boolean(row.asaas_customer_id) && !row.asaas_subscription_id;
}
// Cancelada com assinatura ainda ativa → precisa cancelar (§1.5).
function cancelamentoPendente(row) {
  return ehCancelada(row) && Boolean(row.asaas_subscription_id) && row.assinatura_cancelada !== true;
}
// Apta e COM assinatura → revalidar por convergência (§1.1/§1.3/§1.4): o
// orquestrador é uma função de convergência (atualiza valor/add-ons se divergirem,
// no-op se convergente). Assim plano/add-on alterados perdidos convergem sem
// depender do histórico de eventos. A dedupe diária evita reprocessar no mesmo dia.
function precisaRevalidar(row) {
  return ehAptaBilling(row) && Boolean(row.asaas_subscription_id) && row.assinatura_cancelada !== true;
}

// Recebe:
//   empresas : [{ id, status, commercial_flow_version, trial_ends_at,
//                 asaas_customer_id, asaas_subscription_id, assinatura_cancelada }]
//   agora    : Date
//   janelaTrialDias : quantos dias após o fim do trial ainda reconciliar (default 3)
// Devolve [{ empresaId, motivo }].
function selecionarParaReconciliar({ empresas = [], agora = new Date(), janelaTrialDias = 3 } = {}) {
  const hoje = toDate(agora) || new Date();
  const selecionadas = [];
  for (const row of (Array.isArray(empresas) ? empresas : [])) {
    if (!row || !row.id) continue;
    const motivos = [];
    if (trialRecemVencido(row.trial_ends_at, hoje, janelaTrialDias)) motivos.push('trial_finalizado');
    if (mapeamentoAusente(row)) motivos.push('customer_ausente');
    else if (assinaturaAusente(row)) motivos.push('subscription_ausente');
    if (cancelamentoPendente(row)) motivos.push('cancelamento_pendente');
    // Revalidação por convergência só quando NÃO caiu nos criteria de criação/cancel
    // acima (evita ruído; o create/cancel já força a reconciliação).
    if (motivos.length === 0 && precisaRevalidar(row)) motivos.push('revalidar');
    if (motivos.length > 0) selecionadas.push({ empresaId: row.id, motivo: motivos.join('+') });
  }
  return selecionadas;
}

// Competência do dia para dedupe (reconciliação no máximo 1x/dia por empresa).
function competenciaDia(agora = new Date()) {
  return (toDate(agora) || new Date()).toISOString().slice(0, 10);
}

module.exports = { selecionarParaReconciliar, trialRecemVencido, mapeamentoAusente, assinaturaAusente, cancelamentoPendente, precisaRevalidar, competenciaDia };

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

// Conta do fluxo novo apta a billing sem mapeamento persistido.
function mapeamentoAusente(row) {
  const fluxoNovo = row.commercial_flow_version === 'v2';
  const statusApto = ['ativo', 'trial', 'suspenso'].includes(String(row.status || ''));
  return fluxoNovo && statusApto && !row.asaas_customer_id;
}

// Recebe:
//   empresas : [{ id, status, commercial_flow_version, trial_ends_at, asaas_customer_id, asaas_subscription_id }]
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
    if (mapeamentoAusente(row)) motivos.push('mapeamento_ausente');
    if (motivos.length > 0) selecionadas.push({ empresaId: row.id, motivo: motivos.join('+') });
  }
  return selecionadas;
}

// Competência do dia para dedupe (reconciliação no máximo 1x/dia por empresa).
function competenciaDia(agora = new Date()) {
  return (toDate(agora) || new Date()).toISOString().slice(0, 10);
}

module.exports = { selecionarParaReconciliar, trialRecemVencido, mapeamentoAusente, competenciaDia };

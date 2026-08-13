// Decisão PURA de inadimplência → estado comercial (macrofrente 3A-2, §30/§31/§32).
//
// Traduz o estado financeiro (faturas vencidas) em uma recomendação que ALIMENTA a
// autoridade comercial (situacaoComercialDomainService), em vez de espalhar
// `if (overdue) bloqueia` por controllers/app (§30).
//
// Regras canônicas:
//   - TRIAL válido preserva a operação: inadimplência NÃO encerra o trial (§31).
//   - Após o trial, aplica o PRAZO DE GRAÇA configurável (§32). Sem configuração
//     explícita, o default vem da política (billingPolicyConfig) — nunca um número
//     "mágico" escondido aqui.
//   - Só recomenda suspender quando o atraso ultrapassa a graça.

function toDate(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasEntre(de, ate) {
  return Math.floor((ate.getTime() - de.getTime()) / (24 * 60 * 60 * 1000));
}

// Recebe:
//   faturas   : [{ status, vencimento|due_date }]
//   trialEndsAt : ISO/Date | null
//   gracaDias : inteiro (da política)
//   agora     : Date
// Devolve { inadimplente, suspender, em_graca, dias_atraso, trial_protege, motivo }.
function avaliarInadimplencia({ faturas = [], trialEndsAt = null, gracaDias = 0, agora = new Date() } = {}) {
  const hoje = toDate(agora) || new Date();
  const fimTrial = toDate(trialEndsAt);

  const vencidas = (Array.isArray(faturas) ? faturas : []).filter((f) => {
    if (!f) return false;
    const status = String(f.status || '').toLowerCase();
    if (['pago', 'confirmado', 'recebido', 'cancelado', 'estornado'].includes(status)) return false;
    const venc = toDate(f.vencimento || f.due_date || f.dueDate);
    if (!venc) return status === 'vencido';
    return venc.getTime() < hoje.getTime();
  });

  const inadimplente = vencidas.length > 0;

  // Maior atraso entre as faturas vencidas.
  let diasAtraso = 0;
  for (const f of vencidas) {
    const venc = toDate(f.vencimento || f.due_date || f.dueDate);
    if (venc) diasAtraso = Math.max(diasAtraso, diasEntre(venc, hoje));
  }

  // Trial ainda válido protege a operação — não suspende por inadimplência.
  const trialProtege = Boolean(fimTrial && fimTrial.getTime() > hoje.getTime());
  if (trialProtege) {
    return { inadimplente, suspender: false, em_graca: false, dias_atraso: diasAtraso, trial_protege: true, motivo: 'trial_valido_preserva_operacao' };
  }

  if (!inadimplente) {
    return { inadimplente: false, suspender: false, em_graca: false, dias_atraso: 0, trial_protege: false, motivo: 'sem_pendencia_vencida' };
  }

  const graca = Number.isInteger(gracaDias) && gracaDias >= 0 ? gracaDias : 0;
  const emGraca = diasAtraso <= graca;
  return {
    inadimplente: true,
    suspender: !emGraca,
    em_graca: emGraca,
    dias_atraso: diasAtraso,
    trial_protege: false,
    motivo: emGraca ? `dentro_da_graca(${graca}d)` : `atraso_excede_graca(${diasAtraso}>${graca})`,
  };
}

module.exports = { avaliarInadimplencia };

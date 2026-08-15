const MS_DIA = 24 * 60 * 60 * 1000;

function dataValida(valor) {
  const d = valor instanceof Date ? valor : new Date(valor || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function diasTrialDoPlano(plano) {
  const dias = Number(plano?.dias_trial);
  return Number.isFinite(dias) && dias >= 0 ? dias : 0;
}

// Marco canonico do trial v2:
// email confirmado + login valido + aceite de todos os termos aplicaveis.
// O chamador garante os termos; este servico apenas grava as datas uma unica vez.
async function iniciarTrialV2PorAceiteTermos({ supabase, empresaId, agora = new Date() } = {}) {
  if (!supabase || !empresaId) return { iniciado: false, motivo: 'empresa_indisponivel' };

  try {
    const { data: empresa, error: empresaError } = await supabase
      .from('empresas')
      .select('id, commercial_flow_version, trial_started_at, plano_id')
      .eq('id', empresaId)
      .maybeSingle();

    if (empresaError || !empresa) return { iniciado: false, motivo: 'empresa_indisponivel' };
    if (empresa.commercial_flow_version !== 'v2') return { iniciado: false, motivo: 'nao_v2' };
    if (empresa.trial_started_at) return { iniciado: false, motivo: 'ja_iniciado' };

    let plano = null;
    if (empresa.plano_id) {
      const { data: planoRow, error: planoError } = await supabase
        .from('planos')
        .select('id, dias_trial')
        .eq('id', empresa.plano_id)
        .maybeSingle();
      if (!planoError) plano = planoRow || null;
    }

    const inicio = dataValida(agora);
    const dias = diasTrialDoPlano(plano);
    const fim = new Date(inicio.getTime() + dias * MS_DIA);

    const patch = {
      status: 'trial',
      trial_started_at: inicio.toISOString(),
      trial_ends_at: fim.toISOString(),
    };

    const { data: atualizado, error: updateError } = await supabase
      .from('empresas')
      .update(patch)
      .eq('id', empresaId)
      .is('trial_started_at', null)
      .select('id')
      .maybeSingle();

    if (updateError) return { iniciado: false, motivo: 'erro_update' };
    return {
      iniciado: Boolean(atualizado),
      motivo: atualizado ? 'ok' : 'corrida_ja_iniciado',
      trial_started_at: patch.trial_started_at,
      trial_ends_at: patch.trial_ends_at,
      trial_dias: dias,
    };
  } catch (_) {
    return { iniciado: false, motivo: 'excecao' };
  }
}

module.exports = {
  iniciarTrialV2PorAceiteTermos,
  diasTrialDoPlano,
};

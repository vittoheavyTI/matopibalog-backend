const MS_DIA = 24 * 60 * 60 * 1000;

function dataValida(valor) {
  const d = valor instanceof Date ? valor : new Date(valor || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function diasTrialDoPlano(plano) {
  const dias = Number(plano?.dias_trial);
  return Number.isFinite(dias) && dias >= 0 ? dias : 0;
}

function avaliarDiasTrialDoPlano(plano) {
  if (!plano || !plano.id) return { ok: false, motivo: 'plano_indisponivel' };
  if (plano.ativo === false) return { ok: false, motivo: 'plano_invalido' };
  const dias = Number(plano.dias_trial);
  if (!Number.isInteger(dias) || dias < 0) return { ok: false, motivo: 'trial_config_indisponivel' };
  return { ok: true, dias };
}

function usuarioPodeIniciarTrial({ usuario, empresa }) {
  if (!usuario || !empresa) return false;
  if (usuario.is_super_admin === true) return false;
  if (usuario.empresa_id && String(usuario.empresa_id) !== String(empresa.id)) return false;

  const role = usuario.role || usuario.tipo;
  if (role === 'admin') return true;
  return empresa.tipo === 'autonomo' && role === 'motorista';
}

// Marco canonico do trial v2:
// email confirmado + login valido + aceite de todos os termos aplicaveis.
// O chamador garante os termos; este servico apenas grava as datas uma unica vez.
async function iniciarTrialV2PorAceiteTermos({ supabase, empresaId, usuario = null, agora = new Date() } = {}) {
  if (!supabase || !empresaId) return { iniciado: false, motivo: 'empresa_indisponivel' };

  try {
    const { data: empresa, error: empresaError } = await supabase
      .from('empresas')
      .select('id, tipo, commercial_flow_version, trial_started_at, plano_id')
      .eq('id', empresaId)
      .maybeSingle();

    if (empresaError || !empresa) return { iniciado: false, motivo: 'empresa_indisponivel' };
    if (empresa.commercial_flow_version !== 'v2') return { iniciado: false, motivo: 'nao_v2' };
    if (empresa.trial_started_at) return { iniciado: false, motivo: 'ja_iniciado' };
    if (!usuarioPodeIniciarTrial({ usuario, empresa })) return { iniciado: false, motivo: 'usuario_sem_autoridade' };
    if (!empresa.plano_id) return { iniciado: false, motivo: 'plano_indisponivel' };

    const { data: plano, error: planoError } = await supabase
      .from('planos')
      .select('id, dias_trial, ativo')
      .eq('id', empresa.plano_id)
      .maybeSingle();
    if (planoError) return { iniciado: false, motivo: 'plano_indisponivel' };

    const trial = avaliarDiasTrialDoPlano(plano);
    if (!trial.ok) return { iniciado: false, motivo: trial.motivo };

    const inicio = dataValida(agora);
    const dias = trial.dias;
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
  avaliarDiasTrialDoPlano,
  usuarioPodeIniciarTrial,
};

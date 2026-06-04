const supabase = require('../config/supabase');

// Gera código de convite no formato MATO-XXXXXX
function gerarCodigoConvite() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'MATO-';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

// Aliases curtos vindos do formulário público → nome real do plano
const PLANOS_ALIAS = {
  basico: 'Plano Básico',
  profissional: 'Plano Profissional',
  empresarial: 'Plano Enterprise',
};

/**
 * Cria uma empresa com trial automático.
 * Centraliza a lógica usada pelo cadastro público e pelo painel admin.
 *
 * @param {Object} opts
 * @param {string} opts.nome - Nome da empresa (obrigatório)
 * @param {string} [opts.cnpj]
 * @param {string} [opts.email_contato]
 * @param {string} [opts.telefone]
 * @param {string} [opts.plano_id] - UUID do plano (precedência sobre planoAlias)
 * @param {string} [opts.planoAlias] - "basico" / "profissional" / "empresarial" ou nome do plano
 * @param {string} [opts.tipo] - 'transportadora' (default) ou 'autonomo'
 * @returns {Promise<{ empresa: Object|null, error: string|null }>}
 */
async function criarEmpresaCompleta(opts) {
  const {
    nome,
    cnpj = '',
    email_contato = '',
    telefone = '',
    plano_id,
    planoAlias,
    tipo = 'transportadora',
  } = opts;

  if (!nome || !nome.trim()) {
    return { empresa: null, error: 'Nome da empresa é obrigatório.' };
  }

  // 1. Resolver plano
  let plano = null;
  if (plano_id) {
    const { data, error } = await supabase
      .from('planos')
      .select('id, dias_trial')
      .eq('id', plano_id)
      .maybeSingle();
    if (error) {
      console.error('[empresaService] Erro ao buscar plano por id:', error);
      return { empresa: null, error: 'Plano informado inválido.' };
    }
    plano = data;
  }
  if (!plano) {
    const nomePlano =
      (planoAlias && PLANOS_ALIAS[planoAlias]) || planoAlias || 'Plano Básico';
    const { data, error } = await supabase
      .from('planos')
      .select('id, dias_trial')
      .eq('nome', nomePlano)
      .maybeSingle();
    if (error) {
      console.error('[empresaService] Erro ao buscar plano por nome:', error);
    }
    plano = data; // pode ficar null — empresa nasce sem plano vinculado
  }

  // 2. Gerar código de convite único
  let codigoUnico = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const candidato = gerarCodigoConvite();
    const { data: existente } = await supabase
      .from('empresas')
      .select('id')
      .eq('codigo_convite', candidato)
      .maybeSingle();
    if (!existente) {
      codigoUnico = candidato;
      break;
    }
  }
  if (!codigoUnico) {
    console.error('[empresaService] Não foi possível gerar codigo_convite único após 5 tentativas');
    return { empresa: null, error: 'Falha ao gerar código de convite.' };
  }

  // 3. Calcular trial
  const diasTrial = plano?.dias_trial || 7;
  const agora = new Date();
  const trialEnd = new Date(agora.getTime() + diasTrial * 24 * 60 * 60 * 1000);

  // 4. Inserir empresa
  const { data: empresa, error: insertError } = await supabase
    .from('empresas')
    .insert({
      nome: nome.trim(),
      cnpj: cnpj || '',
      email_contato: email_contato || '',
      telefone_contato: telefone || '',
      plano_id: plano?.id || null,
      status: 'trial',
      trial_started_at: agora.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      codigo_convite: codigoUnico,
      tipo,
    })
    .select()
    .single();

  if (insertError) {
    console.error('[empresaService] Erro ao inserir empresa:', insertError);
    return { empresa: null, error: insertError.message || 'Erro ao criar empresa.' };
  }

  console.log(
    `[empresaService] Empresa criada: ${empresa.id} (${empresa.nome}) — código ${empresa.codigo_convite}`
  );
  return { empresa, error: null };
}

module.exports = { criarEmpresaCompleta, gerarCodigoConvite };

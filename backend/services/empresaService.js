const supabase = require('../config/supabase');
const { conflitoUnico } = require('../utils/pgError');

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
    // Fluxo comercial v2 (macrofrente fechamento comercial): quando true, a conta
    // NÃO inicia o trial na criação. O trial só começa quando o contrato estiver
    // plenamente assinado (assinaturaEletronicaInternaService). Contas legadas
    // (default false) mantêm o comportamento atual: trial inicia aqui.
    commercialFlowV2 = false,
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

  // 3. Calcular trial (só para o fluxo LEGADO — v2 não inicia trial na criação).
  const diasTrial = plano?.dias_trial || 7;
  const agora = new Date();
  const trialEnd = new Date(agora.getTime() + diasTrial * 24 * 60 * 60 * 1000);

  // No v2 o trial NÃO começa aqui: nasce sem datas de trial e marcado como v2.
  // O trial só é iniciado quando o contrato ficar plenamente assinado.
  const camposTrial = commercialFlowV2
    ? { status: 'trial', trial_started_at: null, trial_ends_at: null, commercial_flow_version: 'v2' }
    : { status: 'trial', trial_started_at: agora.toISOString(), trial_ends_at: trialEnd.toISOString() };

  // 4. Inserir empresa
  const { data: empresa, error: insertError } = await supabase
    .from('empresas')
    .insert({
      nome: nome.trim(),
      cnpj: cnpj && cnpj.trim() ? cnpj.trim() : null,
      email_contato: email_contato && email_contato.trim() ? email_contato.trim() : null,
      telefone_contato: telefone && telefone.trim() ? telefone.trim() : null,
      plano_id: plano?.id || null,
      codigo_convite: codigoUnico,
      tipo,
      ...camposTrial,
    })
    .select()
    .single();

  if (insertError) {
    console.error('[empresaService] Erro ao inserir empresa:', insertError);
    // Conflito de unicidade (ex.: CNPJ/CPF já cadastrado) → mensagem amigável e
    // status 409, sem vazar constraint/SQL. Demais erros → genérico 500.
    const conflito = conflitoUnico(insertError);
    if (conflito) return { empresa: null, error: conflito.message, status: conflito.status };
    return { empresa: null, error: 'Erro ao criar empresa.', status: 500 };
  }

  // Marca durável de "plano já utilizado" (base do critério de exclusão de plano
  // — frente #6). Ponto único de atribuição de empresas.plano_id. Não-fatal:
  // falha aqui não desfaz o cadastro (a rede de segurança do DELETE recontagem
  // por empresas cobre eventual dessincronia).
  if (plano?.id) {
    try {
      await supabase.from('planos').update({ ja_utilizado: true }).eq('id', plano.id);
    } catch (e) {
      console.error('[empresaService] Falha ao marcar plano.ja_utilizado (não-fatal):', e.message || e);
    }
  }

  console.log(
    `[empresaService] Empresa criada: ${empresa.id} (${empresa.nome}) — código ${empresa.codigo_convite}`
  );
  return { empresa, error: null };
}

module.exports = { criarEmpresaCompleta, gerarCodigoConvite };

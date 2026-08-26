'use strict';

// partnerIdentityService — identidade do Partner Lite no Supabase Auth.
//
// `PARTNER_LITE_IDENTITY_PROVIDER=SUPABASE_AUTH`.
//
// POR QUE ISTO REUSA O SERVIÇO DO PORTAL DO EMBARCADOR EM VEZ DE COPIAR.
// A política de prova de identidade externa já existe endurecida em
// `shipperIdentityService`, e o comentário lá registra o motivo de ela viver num
// lugar só: *"Ter isso em duas cópias foi exatamente o que abriu o furo no branch
// de corrida: um dos caminhos provava, o outro não."* Duplicar aqui repetiria o
// mesmo erro com outro nome.
//
// O que é compartilhado é a prova de posse de uma conta Auth — que não tem nada
// de específico de embarcador. O que NÃO é compartilhado é o domínio: a
// organização parceira, o relacionamento e a sessão são deste módulo, e um
// usuário de portal do embarcador nunca vira parceiro por isso.
//
// A regra, em uma frase: **a posse da conta precisa ser provada antes do
// vínculo**, valha ela para uma conta nova, para uma conta que já existia, para
// um usuário interno ou para alguém do outro portal.

const identidadeExterna = require('../shipperPortal/shipperIdentityService');
const { PartnerNetworkError } = require('./partnerNetworkService');

const SENHA_MINIMA = 8;

// Traduz o erro do serviço compartilhado para o vocabulário desta frente, sem
// perder o código nem o status — a política é a mesma, a mensagem é nossa.
function traduzirErro(err) {
  const codigo = err?.code || 'identidade_externa_falhou';
  const status = err?.status || 401;
  const mensagens = {
    existing_account_password_required:
      'Este e-mail já tem uma conta no Matopiba Log. Informe a senha dessa conta para ativar seu acesso de parceiro.',
    existing_account_password_invalid:
      'Senha incorreta para a conta já existente com este e-mail. Informe a senha atual dessa conta.',
    auth_identity_mismatch:
      'Não foi possível confirmar sua conta. Tente novamente ou peça um novo convite à transportadora.',
    weak_password: `Escolha uma senha com pelo menos ${SENHA_MINIMA} caracteres.`,
    invalid_email: 'Informe um e-mail válido.',
    invalid_credentials: 'E-mail ou senha inválidos.',
    missing_credentials: 'Informe e-mail e senha.',
    auth_create_failed: 'Não foi possível criar seu acesso agora. Tente novamente em instantes.',
  };
  return new PartnerNetworkError(mensagens[codigo] || err?.message || 'Não foi possível concluir.', {
    status, code: codigo,
  });
}

/**
 * Resolve (ou cria) a identidade Auth do parceiro, provando posse quando a conta
 * já existe.
 *
 * Nunca redefine a senha de uma conta preexistente: ela é **verificada**. Sem a
 * senha correta, a ativação é negada — e quem chama precisa garantir que o
 * convite NÃO seja consumido nesse caso (§7).
 */
async function resolverOuCriarIdentidade(supabase, { email, senha, nome }) {
  try {
    return await identidadeExterna.resolverOuCriarIdentidade(supabase, { email, senha, nome });
  } catch (err) {
    throw traduzirErro(err);
  }
}

/**
 * Login recorrente do parceiro. A senha é validada pelo Supabase Auth; o que
 * volta é só o id da identidade.
 *
 * Estar no Auth **não autoriza nada**: quem decide o acesso é o
 * `carregarContextoDoParceiro`, que exige usuário de parceiro ATIVO e
 * relacionamento ativo.
 */
async function autenticarPorSenha({ email, senha }) {
  try {
    return await identidadeExterna.autenticarPorSenha({ email, senha });
  } catch (err) {
    throw traduzirErro(err);
  }
}

/**
 * Contexto do parceiro a partir da identidade Auth.
 *
 * É a autoridade de sessão: o JWT sozinho não basta (HIGH-01). Uma identidade
 * BLOQUEADA perde o acesso mesmo com token ainda válido, porque o estado é
 * relido aqui a cada requisição.
 */
async function carregarContextoDoParceiro(supabase, { authUserId = null, partnerUserId = null }) {
  if (!authUserId && !partnerUserId) {
    throw new PartnerNetworkError('Sessão inválida.', { status: 401, code: 'sessao_invalida' });
  }

  let consulta = supabase
    .from('partner_portal_users')
    .select('id, partner_organization_id, email, nome, status, auth_user_id');
  consulta = partnerUserId ? consulta.eq('id', partnerUserId) : consulta.eq('auth_user_id', authUserId);

  const { data, error } = await consulta.maybeSingle();
  if (error) {
    if (error.code === '42P01') {
      throw new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
        status: 503, code: 'partner_network_schema_missing',
      });
    }
    throw new PartnerNetworkError('Erro ao carregar seu acesso.', { status: 500, code: 'contexto_erro' });
  }
  if (!data) {
    throw new PartnerNetworkError('Você ainda não tem acesso de parceiro. Use o convite recebido.', {
      status: 403, code: 'sem_acesso_de_parceiro',
    });
  }
  if (data.status !== 'ATIVO') {
    // Sem detalhar quem bloqueou nem por quê: é informação da transportadora.
    throw new PartnerNetworkError('Seu acesso foi bloqueado. Fale com a transportadora que o convidou.', {
      status: 403, code: 'parceiro_bloqueado',
    });
  }
  // Coerência do vínculo: a sessão precisa ser da MESMA identidade Auth gravada.
  if (authUserId && data.auth_user_id && data.auth_user_id !== authUserId) {
    throw new PartnerNetworkError('Sessão inválida.', { status: 401, code: 'sessao_invalida' });
  }

  return {
    id: data.id,
    partner_organization_id: data.partner_organization_id,
    email: data.email,
    nome: data.nome,
    auth_user_id: data.auth_user_id,
  };
}

module.exports = {
  SENHA_MINIMA,
  resolverOuCriarIdentidade,
  autenticarPorSenha,
  carregarContextoDoParceiro,
  hashToken: identidadeExterna.hashToken,
  normalizarEmail: identidadeExterna.normalizarEmail,
};

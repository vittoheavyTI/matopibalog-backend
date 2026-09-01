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

// Proveniência da conta criada por convite de parceiro.
//
// O serviço compartilhado gravava `portal_embarcador: true` em QUALQUER conta que
// ele criasse — inclusive nas de parceiro. A marca ficava simplesmente errada:
// dizia "esta conta nasceu no Portal do Embarcador" sobre alguém que nunca viu
// aquele portal. Metadata não autoriza nada (quem decide é
// `partner_portal_users`, relido a cada requisição), mas metadata mentiroso
// contamina exatamente quem for depurar um acesso mais tarde.
const METADATA_DO_PARCEIRO = Object.freeze({ partner_portal: true });

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
async function resolverOuCriarIdentidade(supabase, { email, senha, nome, auth = null }) {
  try {
    return await identidadeExterna.resolverOuCriarIdentidade(supabase, {
      email, senha, nome, auth,
      // A política de prova de posse continua vindo inteira de lá; o que muda é
      // só a etiqueta de domínio.
      userMetadata: METADATA_DO_PARCEIRO,
    });
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
 * TODOS os contextos de parceiro de uma identidade Auth (HIGH-15).
 *
 * `PARTNER_MULTI_NETWORK_LOGIN_V1=EXPLICIT_CONTEXT_SELECTION`.
 *
 * POR QUE ISTO NÃO PODE SER UM `maybeSingle()`. A versão anterior resolvia o
 * login com `.eq('auth_user_id', …).maybeSingle()`, e `maybeSingle` **falha**
 * quando encontra mais de uma linha. Duas linhas para a mesma identidade não são
 * corrupção: são o caso normal de quem é parceiro de duas transportadoras com o
 * mesmo e-mail — cada uma com organização própria, cada uma nascida de um convite
 * explícito. O efeito prático era que aceitar o segundo convite QUEBRAVA o login
 * do primeiro, com erro de servidor e sem explicação.
 *
 * A correção NÃO é tornar `auth_user_id` único (isso proibiria o segundo convite
 * legítimo), nem escolher uma linha em silêncio (a pessoa entraria na rede
 * errada sem saber). É devolver a lista e deixar a escolha explícita.
 *
 * Só volta o que está ATIVO: um vínculo bloqueado não é uma opção a oferecer.
 */
async function listarContextosDoParceiro(supabase, { authUserId }) {
  if (!authUserId) {
    throw new PartnerNetworkError('Sessão inválida.', { status: 401, code: 'sessao_invalida' });
  }

  const { data, error } = await supabase
    .from('partner_portal_users')
    .select('id, partner_organization_id, email, nome, status, auth_user_id, criado_em, '
      + 'partner_organizations!inner(nome)')
    .eq('auth_user_id', authUserId)
    .eq('status', 'ATIVO')
    .order('criado_em', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      throw new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
        status: 503, code: 'partner_network_schema_missing',
      });
    }
    throw new PartnerNetworkError('Erro ao carregar seu acesso.', { status: 500, code: 'contexto_erro' });
  }

  return (data || []).map((u) => {
    const org = Array.isArray(u.partner_organizations) ? u.partner_organizations[0] : u.partner_organizations;
    return {
      id: u.id,
      partner_organization_id: u.partner_organization_id,
      email: u.email,
      nome: u.nome,
      auth_user_id: u.auth_user_id,
      // Deliberadamente o nome da ORGANIZAÇÃO PARCEIRA, nunca o da
      // transportadora que convidou. O portal inteiro é construído sobre "nada
      // do solicitante sai daqui", e uma tela de escolha não é motivo para abrir
      // exceção — ainda mais uma tela que aparece ANTES de haver sessão.
      organizacao: org?.nome || null,
      vinculado_em: u.criado_em,
    };
  });
}

/**
 * Contexto do parceiro a partir do ID de vínculo.
 *
 * É a autoridade de sessão: o JWT sozinho não basta (HIGH-01). Uma identidade
 * BLOQUEADA perde o acesso mesmo com token ainda válido, porque o estado é
 * relido aqui a cada requisição.
 *
 * Resolve SEMPRE por `partnerUserId` — que é chave primária, então `maybeSingle`
 * é honesto aqui. `authUserId`, quando informado, serve só para conferir a
 * coerência do vínculo, nunca para localizar a linha (ver
 * `listarContextosDoParceiro`).
 */
async function carregarContextoDoParceiro(supabase, { authUserId = null, partnerUserId = null }) {
  if (!partnerUserId) {
    throw new PartnerNetworkError('Sessão inválida.', { status: 401, code: 'sessao_invalida' });
  }

  const { data, error } = await supabase
    .from('partner_portal_users')
    .select('id, partner_organization_id, email, nome, status, auth_user_id')
    .eq('id', partnerUserId)
    .maybeSingle();
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
  METADATA_DO_PARCEIRO,
  resolverOuCriarIdentidade,
  autenticarPorSenha,
  listarContextosDoParceiro,
  carregarContextoDoParceiro,
  hashToken: identidadeExterna.hashToken,
  normalizarEmail: identidadeExterna.normalizarEmail,
};

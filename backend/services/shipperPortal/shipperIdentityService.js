'use strict';

// shipperIdentityService — a ponte entre o Supabase Auth (autoridade de senha) e
// a identidade de domínio do portal (`shipper_portal_users`).
//
// Decisão que estrutura este arquivo (§20): NÃO existe tabela de senha própria do
// portal. Quem guarda credencial é o Supabase Auth, exatamente como no login
// interno. Aqui só resolvemos "qual identidade de auth corresponde a este
// e-mail" e emitimos o token de portal.
//
// RISCO CENTRAL — falha parcial entre dois sistemas (§21). A ativação toca dois
// mundos que não compartilham transação: o Auth (criar identidade) e o banco de
// domínio (criar usuário de portal + marcar convite aceito). A convergência é
// desenhada assim:
//
//   fase 1 (Auth, idempotente por e-mail): cria OU reencontra a identidade.
//   fase 2 (banco, atômica): RPC shipper_invitation_activate.
//
// Se a fase 2 falhar, sobra uma identidade de auth sem vínculo de portal — que é
// inofensiva (não autoriza nada; `loadPortalContext` exige linha em
// `shipper_portal_users`) e é reencontrada pela fase 1 na próxima tentativa com o
// MESMO convite. Nenhum estado fica irrecuperável, e nada precisa ser desfeito.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { ShipperPortalError } = require('./shipperBoundaryService');

// Client isolado para autenticação, pelo mesmo motivo documentado no
// authController: a sessão criada no login não pode contaminar o client admin
// usado para DB/Storage (rebaixaria service_role e bateria em RLS).
let authClientMemo = null;
function authClient() {
  if (!authClientMemo) {
    authClientMemo = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authClientMemo;
}

// Hash do token de convite. O token em claro existe apenas no instante da
// criação (para ser entregue) e NUNCA é persistido nem logado (§18/§82) — o
// mesmo idioma das credenciais de rastreamento do SEC-1.
function hashToken(tokenBruto) {
  return crypto.createHash('sha256').update(String(tokenBruto)).digest('hex');
}

function gerarTokenConvite() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function ehEmailJaRegistrado(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === 'email_exists'
    || msg.includes('already been registered')
    || msg.includes('already registered')
    || msg.includes('user already exists');
}

// Localiza uma identidade de auth por e-mail. Usa a mesma API já usada pelo
// adminController; a busca é feita no servidor e o e-mail é comparado
// normalizado, porque o Auth não garante o casing de origem.
async function localizarIdentidadePorEmail(supabase, email) {
  const alvo = normalizarEmail(email);
  let pagina = 1;
  // Limite defensivo: 10 páginas de 1000 cobrem folgadamente qualquer base
  // realista deste produto e evitam varredura ilimitada.
  while (pagina <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) {
      throw new ShipperPortalError('Não foi possível verificar seu acesso agora. Tente novamente em instantes.', {
        status: 503, code: 'auth_lookup_failed',
      });
    }
    const usuarios = data?.users || [];
    const achado = usuarios.find((u) => normalizarEmail(u.email) === alvo);
    if (achado) return achado;
    if (usuarios.length < 1000) return null;
    pagina += 1;
  }
  return null;
}

// Fase 1 da ativação: garante que existe uma identidade de auth para este e-mail.
//
// POLÍTICA CONGELADA (EXISTING_AUTH_IDENTITY_INVITE_POLICY_V1, owner review
// HIGH-01): quando o e-mail JÁ tem conta, o convite sozinho NÃO basta.
//
// A versão anterior fazia a coisa certa pela metade: não redefinia a senha (bom,
// senão seria takeover explícito), mas vinculava a conta existente ao portal e
// emitia sessão só com o token do convite. Quem tivesse o link — que é uma
// credencial ao portador, entregue manualmente — passava a operar em nome de uma
// identidade cuja senha nunca provou conhecer. Se essa identidade fosse a de um
// operador interno da transportadora, o convite viraria um caminho para entrar
// no lugar dele.
//
// Agora exige-se: TOKEN DE CONVITE **e** AUTENTICAÇÃO da conta existente. A
// senha digitada na ativação é interpretada como a senha DAQUELA conta — ela é
// verificada, nunca redefinida. Sem ela, a ativação é negada e o convite
// permanece pendente.
// Prova de controle de uma identidade PREEXISTENTE.
//
// Extraída porque a política vale para QUALQUER caminho que termine usando uma
// conta que já existia — não só para o caminho "encontrei na busca inicial".
// Ter isso em duas cópias foi exatamente o que abriu o furo no branch de
// corrida: um dos caminhos provava, o outro não.
async function provarControleDaIdentidade({ alvo, senha, identidadeEsperada, auth }) {
  if (!senha) {
    throw new ShipperPortalError(
      'Este e-mail já tem uma conta no Matopiba Log. Informe a senha dessa conta para ativar seu acesso ao portal.',
      { status: 401, code: 'existing_account_password_required' },
    );
  }

  const { data, error } = await (auth || authClient())
    .auth.signInWithPassword({ email: alvo, password: String(senha) });
  if (error || !data?.user?.id) {
    throw new ShipperPortalError(
      'Senha incorreta para a conta já existente com este e-mail. Informe a senha atual dessa conta para ativar seu acesso.',
      { status: 401, code: 'existing_account_password_invalid' },
    );
  }

  // Defesa em profundidade: a identidade autenticada tem que ser a MESMA que
  // será vinculada. Se divergir, algo mudou entre a busca e a autenticação —
  // e escolher silenciosamente um dos dois ids seria vincular o portal a uma
  // conta cuja senha talvez não tenha sido provada. Falha fechada.
  if (identidadeEsperada && data.user.id !== identidadeEsperada) {
    throw new ShipperPortalError(
      'Não foi possível confirmar sua conta. Tente novamente ou peça um novo convite à transportadora.',
      { status: 409, code: 'auth_identity_mismatch' },
    );
  }

  return data.user.id;
}

async function resolverOuCriarIdentidade(supabase, { email, senha, nome, auth = null }) {
  const alvo = normalizarEmail(email);
  if (!alvo) {
    throw new ShipperPortalError('Informe um e-mail válido.', { status: 400, code: 'invalid_email' });
  }

  const existente = await localizarIdentidadePorEmail(supabase, alvo);
  if (existente) {
    await provarControleDaIdentidade({ alvo, senha, identidadeEsperada: existente.id, auth });
    // A senha continua sendo a mesma: verificamos, não trocamos.
    return { id: existente.id, jaExistia: true, senhaDefinidaAgora: false };
  }

  if (!senha || String(senha).length < 8) {
    throw new ShipperPortalError('Escolha uma senha com pelo menos 8 caracteres.', {
      status: 400, code: 'weak_password',
    });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: alvo,
    password: String(senha),
    email_confirm: true,
    user_metadata: { nome: nome || null, portal_embarcador: true },
  });

  if (error) {
    // Corrida: entre a busca e a criação, a identidade passou a existir.
    //
    // Este caminho também termina usando uma conta PREEXISTENTE — criada por
    // outra pessoa, não por esta tentativa. Antes ele devolvia a identidade
    // direto, e era um desvio completo da prova de senha: bastava disparar a
    // ativação no instante certo (ou simplesmente depois de alguém já ter
    // criado a conta) para vincular o portal a uma identidade alheia. Agora a
    // mesma prova é exigida aqui.
    if (ehEmailJaRegistrado(error)) {
      const agora = await localizarIdentidadePorEmail(supabase, alvo);
      if (agora) {
        await provarControleDaIdentidade({ alvo, senha, identidadeEsperada: agora.id, auth });
        return { id: agora.id, jaExistia: true, senhaDefinidaAgora: false };
      }
    }
    throw new ShipperPortalError('Não foi possível criar seu acesso agora. Tente novamente em instantes.', {
      status: 503, code: 'auth_create_failed',
    });
  }

  return { id: data.user.id, jaExistia: false, senhaDefinidaAgora: true };
}

// Login do portal. A senha é validada pelo Supabase Auth; o que devolvemos é
// apenas o id da identidade — quem decide se ela tem acesso a alguma coisa é o
// `loadPortalContext`, que exige usuário de portal ativo e relacionamento ativo.
// Estar no Auth, por si só, não autoriza nada.
async function autenticarPorSenha({ email, senha }) {
  const alvo = normalizarEmail(email);
  if (!alvo || !senha) {
    throw new ShipperPortalError('Informe e-mail e senha.', { status: 400, code: 'missing_credentials' });
  }
  const { data, error } = await authClient().auth.signInWithPassword({ email: alvo, password: String(senha) });
  if (error || !data?.user?.id) {
    // Mensagem única para credencial inválida e usuário inexistente: distinguir
    // as duas revelaria quais e-mails têm conta.
    throw new ShipperPortalError('E-mail ou senha inválidos.', { status: 401, code: 'invalid_credentials' });
  }
  return { id: data.user.id, email: data.user.email || alvo };
}

module.exports = {
  hashToken,
  gerarTokenConvite,
  normalizarEmail,
  localizarIdentidadePorEmail,
  provarControleDaIdentidade,
  resolverOuCriarIdentidade,
  autenticarPorSenha,
};

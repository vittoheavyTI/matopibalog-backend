'use strict';

// shipperOnboardingService — entrada do usuário EXTERNO: ativar o convite e
// fazer login no portal.
//
// A ativação é a operação mais delicada do PORTAL-B porque atravessa dois
// sistemas sem transação comum (Supabase Auth + banco de domínio). O desenho
// está descrito em shipperIdentityService; aqui está a sequência concreta e,
// principalmente, o que acontece quando a segunda fase falha.

const { ShipperPortalError, loadPortalContext } = require('./shipperBoundaryService');
const identity = require('./shipperIdentityService');
const { emitirTokenPortal } = require('../../middlewares/shipperPortalAuth');

function mapRpcError(error) {
  const raw = String(error?.message || '');
  const code = raw.split(':')[0].trim();
  const mapa = {
    invitation_not_found: {
      status: 404, code: 'invitation_not_found',
      message: 'Este convite não é válido. Peça um novo convite à transportadora.',
    },
    invitation_expired: {
      status: 410, code: 'invitation_expired',
      message: 'Este convite expirou. Peça um novo convite à transportadora.',
    },
    invitation_already_used: {
      status: 409, code: 'invitation_already_used',
      message: 'Este convite já foi utilizado. Entre com seu e-mail e senha ou peça um novo convite.',
    },
    invitation_not_pending: {
      status: 409, code: 'invitation_not_pending',
      message: 'Este convite não está mais disponível. Peça um novo convite à transportadora.',
    },
    relationship_not_active: {
      status: 403, code: 'relationship_not_active',
      message: 'O acesso deste embarcador está suspenso. Fale com a transportadora.',
    },
    portal_user_other_org: {
      status: 403, code: 'portal_user_other_org',
      message: 'Este e-mail já está vinculado a outra empresa embarcadora.',
    },
    portal_user_disabled: {
      status: 403, code: 'portal_user_disabled',
      message: 'Seu acesso ao portal está desativado. Fale com a transportadora.',
    },
    auth_identity_required: {
      status: 400, code: 'auth_identity_required',
      message: 'Não foi possível concluir a ativação. Tente novamente.',
    },
    existing_account_password_required: {
      status: 401, code: 'existing_account_password_required',
      message: 'Este e-mail já tem uma conta no Matopiba Log. Informe a senha dessa conta para ativar seu acesso ao portal.',
    },
    existing_account_password_invalid: {
      status: 401, code: 'existing_account_password_invalid',
      message: 'Senha incorreta para a conta já existente com este e-mail. Informe a senha atual dessa conta para ativar seu acesso.',
    },
  };
  const known = mapa[code];
  if (known) return new ShipperPortalError(known.message, { status: known.status, code: known.code });
  if (error?.code === '42P01') {
    return new ShipperPortalError('O Portal do Embarcador ainda não está disponível nesta instalação.', {
      status: 503, code: 'shipper_portal_schema_missing',
    });
  }
  return new ShipperPortalError('Não foi possível concluir a ativação agora. Tente novamente em instantes.', {
    status: 500, code: 'shipper_onboarding_database_error', details: { db_code: error?.code },
  });
}

// Leitura pública e MÍNIMA do convite, para a tela de ativação saber para quem
// ela está pedindo senha. Deliberadamente não revela nada além do e-mail
// convidado e do nome da transportadora: quem tem o token já conhece os dois.
async function previewConvite(supabase, { token }) {
  if (!token) {
    throw new ShipperPortalError('Convite inválido.', { status: 400, code: 'invitation_token_required' });
  }
  const { data, error } = await supabase
    .from('shipper_portal_invitations')
    .select('email, nome_convidado, status, expires_at, empresa_id, shipper_org_id')
    .eq('token_hash', identity.hashToken(token))
    .maybeSingle();
  if (error) throw mapRpcError(error);
  if (!data) {
    throw new ShipperPortalError('Este convite não é válido. Peça um novo convite à transportadora.', {
      status: 404, code: 'invitation_not_found',
    });
  }

  const expirado = new Date(data.expires_at).getTime() <= Date.now();
  const utilizavel = data.status === 'PENDING' && !expirado;

  const [{ data: empresa }, { data: org }] = await Promise.all([
    supabase.from('empresas').select('nome').eq('id', data.empresa_id).maybeSingle(),
    supabase.from('shipper_organizations').select('nome').eq('id', data.shipper_org_id).maybeSingle(),
  ]);

  // A tela precisa saber se vai pedir "crie uma senha" ou "informe a senha da
  // sua conta" (HIGH-01). Sem isso a pessoa inventa uma senha nova, a ativação
  // falha, e ela não entende por quê.
  //
  // Sobre revelar a existência da conta: quem chega aqui já tem o token do
  // convite, que a transportadora emitiu para este e-mail específico — não há
  // ganho de informação para um terceiro. Só é consultado com token válido e
  // ainda utilizável.
  let contaExistente = false;
  if (utilizavel) {
    try {
      contaExistente = Boolean(await identity.localizarIdentidadePorEmail(supabase, data.email));
    } catch {
      // Indisponibilidade do Auth não pode quebrar a tela; ela cai no fluxo de
      // conta nova e a ativação decide com autoridade.
      contaExistente = false;
    }
  }

  return {
    email: data.email,
    nome_convidado: data.nome_convidado,
    transportadora: empresa?.nome || null,
    embarcador: org?.nome || null,
    utilizavel,
    conta_existente: contaExistente,
    motivo: utilizavel ? null : (expirado ? 'expirado' : 'indisponivel'),
  };
}

// Ativação. Fase 1 resolve a identidade no Auth; fase 2 é a RPC atômica.
//
// Sobre a falha da fase 2: NÃO desfazemos a identidade de auth. Apagá-la seria
// perigoso quando ela já existia antes (poderia ser um usuário interno da
// transportadora, ou um contato de outro embarcador) — o rollback destruiria uma
// conta legítima. Uma identidade de auth sem vínculo de portal não autoriza
// nada, e a próxima tentativa com o mesmo convite a reencontra e conclui.
async function ativarConvite(supabase, { token, senha, nome }) {
  if (!token) {
    throw new ShipperPortalError('Convite inválido.', { status: 400, code: 'invitation_token_required' });
  }
  const tokenHash = identity.hashToken(token);

  // Lê o convite só para saber para qual e-mail a identidade deve ser resolvida.
  // A validação que vale (pendente, não expirado, relacionamento ativo) é
  // refeita dentro da RPC, sob lock — esta leitura é conveniência, não autoridade.
  const { data: convite, error: conviteError } = await supabase
    .from('shipper_portal_invitations')
    .select('email, nome_convidado, status, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (conviteError) throw mapRpcError(conviteError);
  if (!convite) {
    throw new ShipperPortalError('Este convite não é válido. Peça um novo convite à transportadora.', {
      status: 404, code: 'invitation_not_found',
    });
  }
  if (convite.status !== 'PENDING') {
    throw mapRpcError({ message: convite.status === 'ACCEPTED' ? 'invitation_already_used' : 'invitation_not_pending' });
  }
  if (new Date(convite.expires_at).getTime() <= Date.now()) {
    throw mapRpcError({ message: 'invitation_expired' });
  }

  // Fase 1 — Auth.
  const identidade = await identity.resolverOuCriarIdentidade(supabase, {
    email: convite.email,
    senha,
    nome: nome || convite.nome_convidado,
  });

  // Fase 2 — domínio, atômico.
  const { data, error } = await supabase.rpc('shipper_invitation_activate', {
    p_token_hash: tokenHash,
    p_auth_user_id: identidade.id,
    p_email: convite.email,
    p_nome: nome || convite.nome_convidado || convite.email,
  });
  if (error) throw mapRpcError(error);
  const portalUser = Array.isArray(data) ? data[0] : data;

  const contexto = await loadPortalContext(supabase, { portalUserId: portalUser.id });
  return {
    token: emitirTokenPortal({
      portalUserId: portalUser.id,
      shipperOrgId: portalUser.shipper_org_id,
      email: portalUser.email,
    }),
    usuario: { id: portalUser.id, nome: portalUser.nome, email: portalUser.email },
    // Se a identidade já existia, a senha informada foi VERIFICADA (não
    // redefinida) — ela continua sendo a senha da conta. A tela usa isso para
    // não sugerir que uma senha nova foi criada.
    senha_definida_agora: identidade.senhaDefinidaAgora,
    conta_existente: identidade.jaExistia,
    transportadoras: contexto.relationships.map((r) => ({ relationship_id: r.id })),
  };
}

// Login. Autentica no Auth e só então verifica se aquela identidade tem contexto
// de portal — usuário ativo e ao menos um relacionamento ativo. Um usuário
// desativado, ou cujo acesso foi revogado, não entra mesmo com senha correta
// (§24/§25).
async function login(supabase, { email, senha }) {
  const identidade = await identity.autenticarPorSenha({ email, senha });

  let contexto;
  try {
    contexto = await loadPortalContext(supabase, { portalUserId: identidade.id });
  } catch (err) {
    // Identidade válida no Auth mas sem acesso de portal (por exemplo: um
    // usuário interno da transportadora tentando entrar aqui, §26). Não é erro
    // de credencial — é ausência de contexto externo.
    if (err instanceof ShipperPortalError && err.status === 403) throw err;
    throw err;
  }

  const orgIds = [contexto.shipperOrgId];
  const { data: orgs } = await supabase
    .from('shipper_organizations').select('id, nome').in('id', orgIds);
  const { data: empresas } = await supabase
    .from('empresas').select('id, nome').in('id', contexto.empresaIds);
  const empresaNome = new Map((empresas || []).map((e) => [e.id, e.nome]));

  return {
    token: emitirTokenPortal({
      portalUserId: contexto.portalUser.id,
      shipperOrgId: contexto.shipperOrgId,
      email: contexto.portalUser.email,
    }),
    usuario: {
      id: contexto.portalUser.id,
      nome: contexto.portalUser.nome,
      email: contexto.portalUser.email,
    },
    embarcador: (orgs || [])[0] ? { id: orgs[0].id, nome: orgs[0].nome } : null,
    // Seletor de transportadora (§16): com uma só, a tela escolhe sozinha.
    transportadoras: contexto.relationships.map((r) => ({
      relationship_id: r.id,
      nome: empresaNome.get(r.empresa_id) || 'Transportadora',
    })),
  };
}

// Contexto da sessão do portal, usado pelo shell externo ao montar.
async function contextoAtual(supabase, { portalUserId }) {
  const contexto = await loadPortalContext(supabase, { portalUserId });
  const { data: empresas } = await supabase
    .from('empresas').select('id, nome').in('id', contexto.empresaIds);
  const empresaNome = new Map((empresas || []).map((e) => [e.id, e.nome]));
  const { data: org } = await supabase
    .from('shipper_organizations').select('id, nome').eq('id', contexto.shipperOrgId).maybeSingle();

  return {
    usuario: {
      id: contexto.portalUser.id,
      nome: contexto.portalUser.nome,
      email: contexto.portalUser.email,
    },
    embarcador: org ? { id: org.id, nome: org.nome } : null,
    transportadoras: contexto.relationships.map((r) => ({
      relationship_id: r.id,
      nome: empresaNome.get(r.empresa_id) || 'Transportadora',
    })),
  };
}

module.exports = { previewConvite, ativarConvite, login, contextoAtual, mapRpcError };

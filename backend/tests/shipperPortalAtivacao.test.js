'use strict';

// HIGH-01 — ativação de convite quando o e-mail JÁ tem conta no Supabase Auth.
//
// A pergunta que estes testes respondem: um link de convite, sozinho, dá acesso
// a uma identidade que já existe? A resposta tem que ser NÃO. O convite é uma
// credencial ao portador entregue manualmente; se ele bastasse para operar em
// nome de uma conta existente — inclusive a de um operador interno — o portal
// viraria um caminho de entrada no lugar de outra pessoa.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-shipper-portal';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const identity = require('../services/shipperPortal/shipperIdentityService');
const { ShipperPortalError } = require('../services/shipperPortal/shipperBoundaryService');

// Supabase falso com o mínimo que o serviço usa: listagem de identidades e
// criação. `usuarios` é a base de auth simulada.
function makeSupabase({ usuarios = [], criarFalha = null } = {}) {
  const criados = [];
  return {
    _criados: criados,
    auth: {
      admin: {
        listUsers: () => Promise.resolve({ data: { users: usuarios }, error: null }),
        createUser: ({ email, password }) => {
          if (criarFalha) return Promise.resolve({ data: null, error: criarFalha });
          const novo = { id: `auth-${criados.length + 1}`, email, password };
          criados.push(novo);
          usuarios.push(novo);
          return Promise.resolve({ data: { user: novo }, error: null });
        },
      },
    },
  };
}

// Client de auth falso: aceita a senha correta registrada para o e-mail e
// devolve o id real daquela identidade — o serviço confere se o id autenticado
// é o mesmo que será vinculado, então o stub precisa ser coerente.
function makeAuth(senhasValidas = {}, idsPorEmail = {}) {
  const tentativas = [];
  return {
    _tentativas: tentativas,
    auth: {
      signInWithPassword: ({ email, password }) => {
        tentativas.push({ email, password });
        if (senhasValidas[email] && senhasValidas[email] === password) {
          const id = idsPorEmail[email] || `auth-${email}`;
          return Promise.resolve({ data: { user: { id, email } }, error: null });
        }
        return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
      },
    },
  };
}

const EMAIL = 'contato@embarcador.test';

test('081B HIGH-01: conta NOVA — o convidado escolhe a senha e a identidade é criada', async () => {
  const supabase = makeSupabase({ usuarios: [] });
  const r = await identity.resolverOuCriarIdentidade(supabase, {
    email: EMAIL, senha: 'senha-forte-123', nome: 'Contato',
  });
  assert.equal(r.jaExistia, false);
  assert.equal(r.senhaDefinidaAgora, true);
  assert.equal(supabase._criados.length, 1);
  assert.equal(supabase._criados[0].email, EMAIL);
});

test('081B HIGH-01: conta nova exige senha minimamente forte', async () => {
  const supabase = makeSupabase({ usuarios: [] });
  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, { email: EMAIL, senha: '123', nome: 'C' }),
    (err) => err instanceof ShipperPortalError && err.code === 'weak_password',
  );
  assert.equal(supabase._criados.length, 0, 'nada é criado quando a senha é fraca');
});

test('081B HIGH-01: conta EXISTENTE + senha CORRETA ativa, e a senha NÃO é redefinida', async () => {
  const supabase = makeSupabase({ usuarios: [{ id: 'auth-existente', email: EMAIL }] });
  const auth = makeAuth({ [EMAIL]: 'senha-real-da-conta' }, { [EMAIL]: 'auth-existente' });

  const r = await identity.resolverOuCriarIdentidade(supabase, {
    email: EMAIL, senha: 'senha-real-da-conta', nome: 'Contato', auth,
  });

  assert.equal(r.id, 'auth-existente');
  assert.equal(r.jaExistia, true);
  assert.equal(r.senhaDefinidaAgora, false, 'a senha existente permanece intacta');
  assert.equal(supabase._criados.length, 0, 'nenhuma identidade nova é criada');
  assert.equal(auth._tentativas.length, 1, 'a senha foi de fato verificada');
});

test('081B HIGH-01: conta EXISTENTE + senha ERRADA é NEGADA — o convite sozinho não basta', async () => {
  const supabase = makeSupabase({ usuarios: [{ id: 'auth-existente', email: EMAIL }] });
  const auth = makeAuth({ [EMAIL]: 'senha-real-da-conta' });

  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, {
      email: EMAIL, senha: 'chute-errado', nome: 'Invasor', auth,
    }),
    (err) => err instanceof ShipperPortalError
      && err.status === 401
      && err.code === 'existing_account_password_invalid',
  );
  assert.equal(supabase._criados.length, 0, 'nada é criado');
});

test('081B HIGH-01: conta EXISTENTE sem senha informada é NEGADA com orientação clara', async () => {
  const supabase = makeSupabase({ usuarios: [{ id: 'auth-existente', email: EMAIL }] });
  const auth = makeAuth({ [EMAIL]: 'senha-real' });

  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, { email: EMAIL, senha: '', nome: 'X', auth }),
    (err) => err.code === 'existing_account_password_required'
      && /senha dessa conta/i.test(err.message),
  );
  assert.equal(auth._tentativas.length, 0, 'sem senha, nem tentamos autenticar');
});

test('081B HIGH-01: usuário INTERNO da transportadora — convite não dá acesso sem a senha real', async () => {
  // Cenário mais grave: o e-mail convidado é de um operador interno. Sem a
  // senha dele, o portador do convite não pode se vincular à identidade.
  const INTERNO = 'operador@transportadora.test';
  const supabase = makeSupabase({ usuarios: [{ id: 'auth-operador-interno', email: INTERNO }] });
  const auth = makeAuth({ [INTERNO]: 'senha-do-operador' }, { [INTERNO]: 'auth-operador-interno' });

  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, {
      email: INTERNO, senha: 'nao-sei-a-senha', nome: 'Terceiro', auth,
    }),
    (err) => err.status === 401 && err.code === 'existing_account_password_invalid',
  );

  // Com a senha real, o vínculo de portal é permitido — mas é só contexto
  // externo: o token emitido é de portal, e o auth interno o rejeita.
  const ok = await identity.resolverOuCriarIdentidade(supabase, {
    email: INTERNO, senha: 'senha-do-operador', nome: 'Operador', auth,
  });
  assert.equal(ok.id, 'auth-operador-interno');
  assert.equal(ok.senhaDefinidaAgora, false);
});

// ============================================================================
// RESIDUAL-01 — o branch de CORRIDA também é um caminho que termina usando uma
// conta preexistente, e por isso exige a mesma prova de senha.
//
// O furo que estes testes fecham: bastava a conta já existir no momento do
// `createUser` (por corrida real ou simplesmente porque outra pessoa a criou
// antes) para o fluxo devolver a identidade sem verificar nada.
// ============================================================================

// Monta o cenário de corrida: a busca inicial não acha; o createUser falha com
// "já registrado"; a busca seguinte acha.
function makeSupabaseCorrida({ idExistente = 'auth-corrida' } = {}) {
  let chamada = 0;
  return {
    _criados: [],
    auth: {
      admin: {
        listUsers: () => {
          chamada += 1;
          if (chamada === 1) return Promise.resolve({ data: { users: [] }, error: null });
          return Promise.resolve({ data: { users: [{ id: idExistente, email: EMAIL }] }, error: null });
        },
        createUser: () => Promise.resolve({
          data: null, error: { code: 'email_exists', message: 'User already registered' },
        }),
      },
    },
  };
}

test('081B RESIDUAL-01: corrida + senha CORRETA passa (e não redefine senha)', async () => {
  const supabase = makeSupabaseCorrida();
  const auth = makeAuth({ [EMAIL]: 'senha-da-conta' }, { [EMAIL]: 'auth-corrida' });
  const r = await identity.resolverOuCriarIdentidade(supabase, {
    email: EMAIL, senha: 'senha-da-conta', nome: 'C', auth,
  });
  assert.equal(r.id, 'auth-corrida');
  assert.equal(r.jaExistia, true);
  assert.equal(r.senhaDefinidaAgora, false);
  assert.equal(auth._tentativas.length, 1, 'a senha foi verificada também no caminho de corrida');
});

test('081B RESIDUAL-01: corrida + senha ERRADA é NEGADA (era o bypass)', async () => {
  const supabase = makeSupabaseCorrida();
  const auth = makeAuth({ [EMAIL]: 'senha-da-conta' });
  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, {
      email: EMAIL, senha: 'senha-errada-mas-longa', nome: 'Invasor', auth,
    }),
    (err) => err.status === 401 && err.code === 'existing_account_password_invalid',
  );
});

test('081B RESIDUAL-01: corrida + senha AUSENTE é NEGADA', async () => {
  // Sem senha a criação nem chega ao Auth (weak_password barra antes), mas o
  // ponto é que em NENHUMA hipótese a corrida devolve identidade sem prova.
  const supabase = makeSupabaseCorrida();
  const auth = makeAuth({ [EMAIL]: 'senha-da-conta' });
  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, { email: EMAIL, senha: '', nome: 'X', auth }),
    (err) => err.status === 400 || err.status === 401,
  );
  assert.equal(auth._tentativas.length, 0);
});

test('081B RESIDUAL-01: id divergente entre autenticação e identidade encontrada FALHA FECHADA', async () => {
  // A busca devolve 'auth-corrida', mas o signIn autentica outro id. Escolher
  // um dos dois silenciosamente vincularia o portal a uma conta cuja senha
  // talvez não tenha sido provada.
  const supabase = makeSupabaseCorrida({ idExistente: 'auth-corrida' });
  const auth = {
    _tentativas: [],
    auth: {
      signInWithPassword: ({ email, password }) => {
        auth._tentativas.push({ email, password });
        return Promise.resolve({ data: { user: { id: 'OUTRO-ID', email } }, error: null });
      },
    },
  };
  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, {
      email: EMAIL, senha: 'senha-da-conta', nome: 'C', auth,
    }),
    (err) => err.status === 409 && err.code === 'auth_identity_mismatch',
  );
});

test('081B RESIDUAL-01: id divergente também falha no caminho normal (não só na corrida)', async () => {
  const supabase = makeSupabase({ usuarios: [{ id: 'auth-existente', email: EMAIL }] });
  const auth = {
    _tentativas: [],
    auth: {
      signInWithPassword: ({ email }) => Promise.resolve({ data: { user: { id: 'DIFERENTE', email } }, error: null }),
    },
  };
  await assert.rejects(
    identity.resolverOuCriarIdentidade(supabase, { email: EMAIL, senha: 'x', nome: 'C', auth }),
    (err) => err.code === 'auth_identity_mismatch',
  );
});

// ============================================================================
// A consequência que importa: sem prova de senha, nada de domínio acontece.
// ============================================================================

test('081B RESIDUAL-01: prova falhando, a RPC de ativação NUNCA é chamada', async () => {
  const onboarding = require('../services/shipperPortal/shipperOnboardingService');

  const rpcCalls = [];
  const usuariosAuth = [{ id: 'auth-existente', email: EMAIL }];
  const convite = {
    email: EMAIL, nome_convidado: 'Contato', status: 'PENDING',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: convite, error: null }) }),
      }),
    }),
    rpc: (name, params) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: {
        listUsers: () => Promise.resolve({ data: { users: usuariosAuth }, error: null }),
        createUser: () => Promise.resolve({ data: null, error: { code: 'email_exists' } }),
      },
    },
  };

  // Senha errada → a ativação tem que morrer ANTES de tocar o domínio.
  await assert.rejects(
    onboarding.ativarConvite(supabase, { token: 'token-qualquer', senha: 'errada', nome: 'X' }),
    (err) => err.status === 401,
  );

  const ativacoes = rpcCalls.filter((c) => c.name === 'shipper_invitation_activate');
  assert.equal(ativacoes.length, 0,
    'shipper_invitation_activate não pode ser chamada sem prova de controle da identidade');
});

test('081B HIGH-01: o hash do convite nunca revela o token', () => {
  const token = identity.gerarTokenConvite();
  const hash = identity.hashToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // Mesmo token → mesmo hash (permite localizar); hash não contém o token.
  assert.equal(identity.hashToken(token), hash);
  assert.ok(!hash.includes(token.slice(0, 8)));
});

test('081B HIGH-01: token de convite é longo o bastante para não ser adivinhado', () => {
  const a = identity.gerarTokenConvite();
  const b = identity.gerarTokenConvite();
  assert.notEqual(a, b);
  // 32 bytes em base64url ≈ 43 caracteres.
  assert.ok(a.length >= 40, `token curto demais: ${a.length}`);
});

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

// Client de auth falso: aceita a senha correta registrada para o e-mail.
function makeAuth(senhasValidas = {}) {
  const tentativas = [];
  return {
    _tentativas: tentativas,
    auth: {
      signInWithPassword: ({ email, password }) => {
        tentativas.push({ email, password });
        if (senhasValidas[email] && senhasValidas[email] === password) {
          return Promise.resolve({ data: { user: { id: `auth-${email}`, email } }, error: null });
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
  const auth = makeAuth({ [EMAIL]: 'senha-real-da-conta' });

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
  const auth = makeAuth({ [INTERNO]: 'senha-do-operador' });

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

test('081B HIGH-01: corrida na criação — se a identidade nasceu no meio, reencontra em vez de estourar', async () => {
  const usuarios = [];
  const supabase = makeSupabase({
    usuarios,
    criarFalha: { code: 'email_exists', message: 'User already registered' },
  });
  // Simula: a busca inicial não achou, mas entre a busca e a criação alguém
  // criou. A segunda busca (após o erro) encontra.
  const originalList = supabase.auth.admin.listUsers;
  let chamada = 0;
  supabase.auth.admin.listUsers = () => {
    chamada += 1;
    if (chamada === 1) return Promise.resolve({ data: { users: [] }, error: null });
    return Promise.resolve({ data: { users: [{ id: 'auth-corrida', email: EMAIL }] }, error: null });
  };
  void originalList;

  const r = await identity.resolverOuCriarIdentidade(supabase, {
    email: EMAIL, senha: 'senha-forte-123', nome: 'C',
  });
  assert.equal(r.id, 'auth-corrida');
  assert.equal(r.jaExistia, true);
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

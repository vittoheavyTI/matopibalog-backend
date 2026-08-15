// Frente 1 — ativação real por e-mail nos cadastros self-service.
// Prova:
//   1. register autônomo (sem convite): createUser email_confirm=false + resend(type:signup);
//   2. register com convite: createUser email_confirm=true e NÃO envia confirmação;
//   3. registerEmpresa: createUser email_confirm=false + resend;
//   4. falha no resend é não-fatal (cadastro segue 201);
//   5. login com email_not_confirmed → 403 { naoConfirmado:true };
//   6. login com credenciais inválidas segue 401 (não confundir com não confirmado);
//   7. reenviarConfirmacao → 200 genérico e dispara resend.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/authController');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'chave-de-teste';
// Faz o guard do controller instanciar o supabaseAnon (senão fica null e o resend é pulado).
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-de-teste';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://exemplo.test';

function carregarController(cenario = {}) {
  const chamadas = { createUsers: [], resends: [], inserts: [], deletes: [], trials: [] };

  const supabaseMock = {
    auth: {
      admin: {
        async createUser(args) {
          chamadas.createUsers.push(args);
          if (cenario.createUserError) return { data: null, error: cenario.createUserError };
          return { data: { user: { id: 'uid-' + args.email } }, error: null };
        },
        async deleteUser(id) { chamadas.deletes.push(id); return { error: null }; },
      },
    },
    from(tabela) {
      const chain = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        // usado só no fluxo com convite: lista de empresas para casar o código.
        not() { return Promise.resolve({ data: cenario.empresas || [], error: null }); },
        async maybeSingle() {
          if (tabela === 'planos') {
            return { data: { id: 'plano-1', dias_trial: 7, ativo: true, categoria: 'ambos' }, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          if (tabela === 'usuarios') return { data: cenario.userData || null, error: cenario.userError || null };
          return { data: null, error: null };
        },
        async insert(payload) { chamadas.inserts.push({ tabela, payload }); return { error: null }; },
        async delete() { return { error: null }; },
      };
      return chain;
    },
  };

  const empresaServiceMock = {
    async criarEmpresaCompleta() { return { empresa: { id: 'empresa-1' }, error: null }; },
  };
  const notificacaoMock = {
    criarParaUsuario: () => Promise.resolve(),
    criarParaEmpresa: () => Promise.resolve(),
  };
  // createClient é chamado 2x no controller (supabaseAuth e supabaseAnon). Ambos
  // recebem este auth: resend captura as chamadas; signInWithPassword é parametrizado.
  const supabaseJsMock = {
    createClient: () => ({
      auth: {
        resend: async (args) => { chamadas.resends.push(args); return { error: cenario.resendError || null }; },
        signInWithPassword: async () =>
          cenario.authError
            ? { data: null, error: cenario.authError }
            : { data: { user: { id: 'uid-login' } }, error: null },
      },
    }),
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    if (request === '../services/empresaService') return empresaServiceMock;
    if (request === '../services/notificacaoService') return notificacaoMock;
    if (request === './termosController') return { getTermosPendentes: async () => ({ count: 0 }) };
    if (request === '../services/trialV2Service') return {
      iniciarTrialV2PorAceiteTermos: async (args) => { chamadas.trials.push(args); return { iniciado: true }; },
    };
    if (request === '@supabase/supabase-js') return supabaseJsMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(controllerPath);
  Module._load = originalLoad;
  delete require.cache[controllerPath];
  return { controller, chamadas };
}

function resMock() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    cookie() { return this; },
    clearCookie() { return this; },
  };
}

const BASE_AUTONOMO = {
  nome: 'Autonomo Dono', email: 'dono@example.com', senha: '123456',
  placa_veiculo: 'ABC1D23', documento_billing: '12345678909',
};

test('register autônomo: createUser email_confirm=false e envia confirmação', async () => {
  const { controller, chamadas } = carregarController();
  const res = resMock();
  await controller.register({ body: { ...BASE_AUTONOMO } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.email_confirmacao_pendente, true);
  assert.equal(chamadas.createUsers.length, 1);
  assert.equal(chamadas.createUsers[0].email_confirm, false);
  assert.equal(chamadas.resends.length, 1);
  assert.equal(chamadas.resends[0].type, 'signup');
  assert.equal(chamadas.resends[0].email, 'dono@example.com');
});

test('register com convite: createUser email_confirm=true e NÃO envia confirmação', async () => {
  const empresa = {
    id: 'emp-1', nome: 'Alfa', codigo_convite: 'MATO-ABC123',
    status: 'ativo', tipo: 'transportadora', plano_id: null, trial_ends_at: null,
  };
  const { controller, chamadas } = carregarController({ empresas: [empresa] });
  const res = resMock();
  await controller.register({ body: {
    nome: 'Motorista', email: 'mot@example.com', senha: '123456',
    codigo_convite: 'MATOABC123', placa_veiculo: 'ABC1D23',
  } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.email_confirmacao_pendente, undefined);
  assert.equal(chamadas.createUsers[0].email_confirm, true);
  assert.equal(chamadas.resends.length, 0);
});

test('registerEmpresa: createUser email_confirm=false e envia confirmação', async () => {
  const { controller, chamadas } = carregarController();
  const res = resMock();
  await controller.registerEmpresa({ body: {
    nome: 'Responsavel', email: 'empresa@example.com', senha: '123456', empresa: 'Transportadora X',
  } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.email_confirmacao_pendente, true);
  assert.equal(chamadas.createUsers[0].email_confirm, false);
  assert.equal(chamadas.resends.length, 1);
  assert.equal(chamadas.resends[0].email, 'empresa@example.com');
});

test('register autônomo: falha no resend é não-fatal (segue 201)', async () => {
  const { controller, chamadas } = carregarController({ resendError: { message: 'smtp indisponivel' } });
  const res = resMock();
  await controller.register({ body: { ...BASE_AUTONOMO } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.email_confirmacao_pendente, true);
  assert.equal(chamadas.resends.length, 1);
});

test('login: email_not_confirmed retorna 403 naoConfirmado e nao alcanca gatilho de trial', async () => {
  const { controller, chamadas } = carregarController({ authError: { code: 'email_not_confirmed', message: 'Email not confirmed' } });
  const res = resMock();
  await controller.login({ body: { email: 'x@example.com', senha: '123456' } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.naoConfirmado, true);
  assert.match(res.body.message, /Confirme seu e-mail/i);
  assert.equal(chamadas.trials.length, 0);
});

test('login: credenciais inválidas seguem 401 (não confundir com não confirmado)', async () => {
  const { controller } = carregarController({ authError: { message: 'Invalid login credentials' } });
  const res = resMock();
  await controller.login({ body: { email: 'x@example.com', senha: 'errada' } }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.naoConfirmado, undefined);
});

test('reenviarConfirmacao: resposta genérica 200 e dispara resend', async () => {
  const { controller, chamadas } = carregarController();
  const res = resMock();
  await controller.reenviarConfirmacao({ body: { email: 'x@example.com' } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /cadastro pendente/i);
  assert.equal(chamadas.resends.length, 1);
  assert.equal(chamadas.resends[0].email, 'x@example.com');
});

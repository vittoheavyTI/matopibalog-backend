const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/authController');

// Harness dedicado ao fluxo "Autônomo com administrador". Diferente do harness de
// billing, o createUser aqui é keyed por e-mail: devolve ids distintos para o
// autônomo e o admin, e pode simular "e-mail já cadastrado" no admin.
function carregarController(cenario = {}) {
  const chamadas = { inserts: [], deletes: [], createUsers: [] };

  const supabaseMock = {
    auth: {
      admin: {
        async createUser(args) {
          const email = args?.email;
          chamadas.createUsers.push(email);
          if (cenario.adminConflictEmail && email === cenario.adminConflictEmail) {
            return { data: null, error: { status: 422, message: 'already registered' } };
          }
          return { data: { user: { id: 'uid-' + email } }, error: null };
        },
        async deleteUser(id) {
          chamadas.deletes.push(id);
          return { error: null };
        },
      },
    },
    from(tabela) {
      const chain = {
        select() { return this; },
        eq() { return this; },
        not() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          if (tabela === 'planos') {
            return { data: { id: 'plano-1', dias_trial: 7, ativo: true }, error: null };
          }
          return { data: null, error: null };
        },
        async insert(payload) {
          chamadas.inserts.push({ tabela, payload });
          if (cenario.adminInsertError && tabela === 'usuarios' && payload.tipo === 'admin') {
            return { error: { message: 'insert falhou' } };
          }
          return { error: null };
        },
        async delete() { return { error: null }; },
      };
      return chain;
    },
  };

  const empresaServiceMock = {
    async criarEmpresaCompleta() {
      return { empresa: { id: 'empresa-1' }, error: null };
    },
  };

  const notificacaoMock = {
    criarParaUsuario: () => Promise.resolve(),
    criarParaEmpresa: () => Promise.resolve(),
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    if (request === '../services/empresaService') return empresaServiceMock;
    if (request === '../services/notificacaoService') return notificacaoMock;
    if (request === './termosController') return { getTermosPendentes: async () => ({ count: 0 }) };
    if (request === '@supabase/supabase-js') return { createClient: () => ({ auth: {} }) };
    return originalLoad.call(this, request, parent, isMain);
  };

  const controller = require(controllerPath);
  Module._load = originalLoad;
  return { controller, chamadas };
}

function resMock() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function registrar(body, cenario) {
  const { controller, chamadas } = carregarController(cenario);
  const res = resMock();
  await controller.register({ body }, res);
  delete require.cache[controllerPath];
  return { res, chamadas };
}

const BASE = {
  nome: 'Autonomo Dono',
  email: 'dono@example.com',
  senha: '123456',
  placa_veiculo: 'ABC1D23',
  documento_billing: '12345678909',
};

function adminInsert(chamadas) {
  return chamadas.inserts.find((i) => i.tabela === 'usuarios' && i.payload.tipo === 'admin');
}

test('autonomo com admin: cria admin tipo=admin na mesma empresa_id, senha temporaria retornada uma vez', async () => {
  const { res, chamadas } = await registrar({
    ...BASE,
    administrador: { nome: 'Admin Painel', email: 'admin@example.com' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.administrador.criado, true);
  assert.equal(res.body.administrador.email, 'admin@example.com');
  assert.ok(typeof res.body.administrador.senha_temporaria === 'string' && res.body.administrador.senha_temporaria.length >= 8);

  const admin = adminInsert(chamadas);
  assert.ok(admin, 'deve inserir um usuario tipo admin');
  assert.equal(admin.payload.empresa_id, 'empresa-1'); // derivado do backend
  assert.equal(admin.payload.tipo, 'admin');
  assert.equal(admin.payload.senha_temporaria, true);
  assert.equal(admin.payload.email, 'admin@example.com');
});

test('autonomo com admin: e-mail do admin ja cadastrado -> conta criada, admin nao (nao-fatal)', async () => {
  const { res, chamadas } = await registrar({
    ...BASE,
    administrador: { nome: 'Admin Painel', email: 'existe@example.com' },
  }, { adminConflictEmail: 'existe@example.com' });

  assert.equal(res.statusCode, 201); // autônomo continua criado
  assert.equal(res.body.administrador.criado, false);
  assert.match(res.body.administrador.motivo, /já está cadastrado/i);
  assert.equal(adminInsert(chamadas), undefined); // nenhum admin inserido
});

test('autonomo com admin: falha ao inserir admin -> rollback do Auth, nao-fatal', async () => {
  const { res, chamadas } = await registrar({
    ...BASE,
    administrador: { nome: 'Admin Painel', email: 'admin@example.com' },
  }, { adminInsertError: true });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.administrador.criado, false);
  // rollback: o uid do admin deve ter sido deletado do Auth
  assert.ok(chamadas.deletes.includes('uid-admin@example.com'), 'deve reverter o Auth do admin');
});

test('autonomo com admin: e-mail do admin igual ao do autonomo -> recusa antes de criar', async () => {
  const { res, chamadas } = await registrar({
    ...BASE,
    administrador: { nome: 'Admin Painel', email: 'dono@example.com' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.administrador.criado, false);
  assert.match(res.body.administrador.motivo, /diferente do seu/i);
  // só o createUser do autônomo deve ter ocorrido (não tenta criar admin)
  assert.deepEqual(chamadas.createUsers, ['dono@example.com']);
});

test('autonomo sem administrador: comportamento inalterado (sem campo administrador)', async () => {
  const { res, chamadas } = await registrar({ ...BASE });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.administrador, undefined);
  assert.equal(adminInsert(chamadas), undefined);
});

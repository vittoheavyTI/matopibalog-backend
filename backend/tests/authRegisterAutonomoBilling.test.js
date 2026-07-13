const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/authController');

function carregarController(cenario = {}) {
  const chamadas = {
    criarEmpresaCompleta: [],
    inserts: [],
  };

  const supabaseMock = {
    auth: {
      admin: {
        async createUser() {
          return { data: { user: { id: 'user-1' } }, error: null };
        },
        async deleteUser() {
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
            const plano = Object.prototype.hasOwnProperty.call(cenario, 'plano')
              ? cenario.plano
              : { id: 'plano-1', dias_trial: 7, ativo: true };
            return { data: plano, error: null };
          }
          return { data: null, error: null };
        },
        async insert(payload) {
          chamadas.inserts.push({ tabela, payload });
          return { error: null };
        },
        async delete() {
          return { error: null };
        },
      };
      return chain;
    },
  };

  const empresaServiceMock = {
    async criarEmpresaCompleta(opts) {
      chamadas.criarEmpresaCompleta.push(opts);
      if (cenario.empresaResult) return cenario.empresaResult;
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

test('register autonomo: CPF alimenta empresas.cnpj e motoristas.cpf', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo CPF',
    email: 'cpf@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '123.456.789-09',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.criarEmpresaCompleta[0].cnpj, '12345678909');
  const motorista = chamadas.inserts.find((i) => i.tabela === 'motoristas').payload;
  assert.equal(motorista.cpf, '12345678909');
});

test('register autonomo: CNPJ com CPF do responsavel alimenta billing e motorista', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo MEI',
    email: 'mei@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '11.444.777/0001-61',
    cpf: '123.456.789-09',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.criarEmpresaCompleta[0].cnpj, '11444777000161');
  const motorista = chamadas.inserts.find((i) => i.tabela === 'motoristas').payload;
  // CNPJ vai para o billing; o CPF do motorista e o do responsavel (nunca o CNPJ).
  assert.equal(motorista.cpf, '12345678909');
});

test('register autonomo: CNPJ sem CPF do responsavel retorna 400 antes de criar empresa', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo MEI Sem CPF',
    email: 'mei-sem-cpf@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '11.444.777/0001-61',
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /CPF do motorista responsavel/i);
  assert.equal(chamadas.criarEmpresaCompleta.length, 0);
});

test('register autonomo: app legado com apenas cpf continua alimentando billing', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo Legado',
    email: 'legado@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    cpf: '12345678909',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.criarEmpresaCompleta[0].cnpj, '12345678909');
  const motorista = chamadas.inserts.find((i) => i.tabela === 'motoristas').payload;
  assert.equal(motorista.cpf, '12345678909');
});

test('register autonomo: documento invalido para antes de criar empresa', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo Invalido',
    email: 'invalido@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '123',
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /CPF ou CNPJ valido/i);
  assert.equal(chamadas.criarEmpresaCompleta.length, 0);
});

test('register autonomo: sem plano elegivel a autonomo retorna 400 antes de criar empresa', async () => {
  const { res, chamadas } = await registrar({
    nome: 'Autonomo Sem Plano',
    email: 'semplano@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '12345678909',
  }, { plano: null });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Nenhum plano para aut/i);
  assert.equal(chamadas.criarEmpresaCompleta.length, 0);
});

test('register autonomo: conflito de documento retorna status amigavel do servico', async () => {
  const { res } = await registrar({
    nome: 'Autonomo Duplicado',
    email: 'duplicado@example.com',
    senha: '123456',
    placa_veiculo: 'ABC1D23',
    documento_billing: '12345678909',
  }, {
    empresaResult: {
      empresa: null,
      error: 'Ja existe uma conta cadastrada com este CPF/CNPJ.',
      status: 409,
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Ja existe uma conta cadastrada com este CPF/CNPJ.');
});

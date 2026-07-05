const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const middlewarePath = require.resolve('../middlewares/verificarPlano');

const carregarMiddleware = (supabaseMock) => {
  const originalLoad = Module._load;
  delete require.cache[middlewarePath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(middlewarePath).verificarPlano;
  } finally {
    Module._load = originalLoad;
  }
};

const criarSupabaseMock = (empresa) => {
  const chamadas = { consultas: 0, updates: [] };

  return {
    chamadas,
    from(tabela) {
      assert.equal(tabela, 'empresas');
      return {
        select() {
          chamadas.consultas += 1;
          return this;
        },
        update(payload) {
          chamadas.updates.push(payload);
          return this;
        },
        eq() {
          return this;
        },
        async single() {
          return { data: empresa, error: null };
        }
      };
    }
  };
};

const executar = async ({ method, user = {}, empresa, empresaId = 'empresa-1' }) => {
  const supabase = criarSupabaseMock(empresa);
  const verificarPlano = carregarMiddleware(supabase);
  let nextChamado = 0;
  let resposta = null;

  await verificarPlano(
    { method, user, empresa_id: empresaId },
    {
      status(status) {
        return {
          json(body) {
            resposta = { status, body };
          }
        };
      }
    },
    () => { nextChamado += 1; }
  );

  return { nextChamado, resposta, chamadas: supabase.chamadas };
};

test('super-admin não é bloqueado em POST', async () => {
  const resultado = await executar({
    method: 'POST',
    user: { is_super_admin: true },
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.equal(resultado.chamadas.consultas, 0);
});

test('empresa suspensa pode consultar com GET', async () => {
  const resultado = await executar({
    method: 'GET',
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.equal(resultado.chamadas.consultas, 0);
});

test('empresa suspensa continua bloqueada em POST', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
});

test('empresa bloqueada continua bloqueada em PATCH', async () => {
  const resultado = await executar({
    method: 'PATCH',
    empresa: { status: 'bloqueado', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
});

test('empresa expirada continua bloqueada em DELETE', async () => {
  const resultado = await executar({
    method: 'DELETE',
    empresa: { status: 'expirado', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
});

test('trial vencido pode consultar com GET sem atualizar status', async () => {
  const resultado = await executar({
    method: 'GET',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.deepEqual(resultado.chamadas.updates, []);
});

test('trial vencido é suspenso e bloqueado em POST', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  assert.deepEqual(resultado.chamadas.updates, [{ status: 'suspenso' }]);
});

test('empresa ativa pode escrever', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'ativo', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
});

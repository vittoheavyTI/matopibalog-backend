const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const middlewarePath = require.resolve('../middlewares/verificarPlano');

const carregarMiddleware = (supabaseMock) => {
  const originalLoad = Module._load;
  delete require.cache[middlewarePath];
  // Também limpa o cache do gate service p/ garantir que use o supabase injetado
  delete require.cache[require.resolve('../services/contratoGateService')];
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

// Mock que atende: contratos_comerciais (thenable -> data=contratosMock),
// empresas e faturas (via single/maybeSingle).
const criarSupabaseMock = (empresa, contratosMock = []) => {
  return {
    from(tabela) {
      const builder = {
        select() { return builder; },
        update() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        lt() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve({ data: tabela === 'faturas' ? null : empresa, error: null }); },
        single() { return Promise.resolve({ data: empresa, error: null }); },
      };
      if (tabela === 'contratos_comerciais') {
        builder.then = (resolve) => resolve({ data: contratosMock, error: null });
      }
      return builder;
    },
  };
};

const executar = async ({ method, user = {}, empresa, contratosMock = [], empresaId = 'empresa-1' }) => {
  const supabase = criarSupabaseMock(empresa, contratosMock);
  const verificarPlano = carregarMiddleware(supabase);
  let nextChamado = 0;
  let resposta = null;
  await verificarPlano(
    { method, user, empresa_id: empresaId },
    { status(status) { return { json(body) { resposta = { status, body }; } }; } },
    () => { nextChamado += 1; },
  );
  return { nextChamado, resposta };
};

const PENDENTE_OBRIGATORIO = [{ obrigatorio: true, status: 'aguardando_assinatura_cliente' }];

test('gate contrato: escrita bloqueada quando há contrato obrigatório pendente (empresa ativa)', async () => {
  const r = await executar({ method: 'POST', empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: PENDENTE_OBRIGATORIO });
  assert.equal(r.nextChamado, 0);
  assert.equal(r.resposta.status, 403);
  assert.equal(r.resposta.body.motivo, 'contrato_obrigatorio_pendente');
  assert.match(r.resposta.body.message, /finalize a assinatura do contrato/i);
});

test('gate contrato: GET (histórico) NÃO é bloqueado mesmo com contrato obrigatório pendente', async () => {
  const r = await executar({ method: 'GET', empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: PENDENTE_OBRIGATORIO });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('gate contrato: super-admin NÃO é bloqueado', async () => {
  const r = await executar({ method: 'POST', user: { is_super_admin: true }, empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: PENDENTE_OBRIGATORIO });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('gate contrato: contrato pendente NÃO obrigatório não bloqueia', async () => {
  const r = await executar({ method: 'POST', empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: [{ obrigatorio: false, status: 'aguardando_assinatura_cliente' }] });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('gate contrato: contrato obrigatório já concluído não bloqueia', async () => {
  const r = await executar({ method: 'POST', empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: [{ obrigatorio: true, status: 'plenamente_assinado' }] });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('gate contrato: sem contratos, empresa ativa escreve normalmente', async () => {
  const r = await executar({ method: 'POST', empresa: { status: 'ativo', trial_ends_at: null }, contratosMock: [] });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

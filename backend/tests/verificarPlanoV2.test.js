const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const middlewarePath = require.resolve('../middlewares/verificarPlano');

// Injeta o supabase mockado no middleware (e limpa caches dependentes).
const carregarMiddleware = (supabaseMock) => {
  const originalLoad = Module._load;
  delete require.cache[middlewarePath];
  delete require.cache[require.resolve('../services/contratoGateService')];
  delete require.cache[require.resolve('../services/situacaoComercialService')];
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

// Mock que serve empresas (single), contratos_comerciais (thenable),
// propostas_comerciais (maybeSingle) e faturas (thenable via .in()).
const criarSupabaseMock = ({ empresa, contratos = [], proposta = null, faturas = [] }) => ({
  from(tabela) {
    const builder = {
      select() { return builder; },
      update() { return builder; },
      eq() { return builder; },
      in() { return builder; },
      lt() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        if (tabela === 'propostas_comerciais') return Promise.resolve({ data: proposta, error: null });
        if (tabela === 'faturas') return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: empresa, error: null });
      },
      single() { return Promise.resolve({ data: empresa, error: null }); },
    };
    if (tabela === 'contratos_comerciais') builder.then = (resolve) => resolve({ data: contratos, error: null });
    if (tabela === 'faturas') builder.then = (resolve) => resolve({ data: faturas, error: null });
    return builder;
  },
});

const executar = async ({ method = 'POST', user = {}, empresaId = 'empresa-1', ...dados }) => {
  const supabase = criarSupabaseMock(dados);
  const verificarPlano = carregarMiddleware(supabase);
  let nextChamado = 0;
  let resposta = null;
  await verificarPlano(
    { method, user, empresa_id: empresaId },
    { status(status) { return { json(body) { resposta = { status, body }; return resposta; } }; } },
    () => { nextChamado += 1; },
  );
  return { nextChamado, resposta };
};

const CONTRATO_OK = [{ obrigatorio: true, status: 'plenamente_assinado' }];
const SNAP = { snapshot: { valor_mensal: 299.9, valor_implantacao: 0, trial_dias: 14 } };
const FUTURO = new Date(Date.now() + 5 * 864e5).toISOString();
const PASSADO = new Date(Date.now() - 5 * 864e5).toISOString();

test('v2 trial ativo (contrato assinado) → escrita liberada', async () => {
  const r = await executar({
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: FUTURO },
    contratos: CONTRATO_OK, proposta: SNAP,
  });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('v2 trial expirado sem decisão → escrita bloqueada com motivo estruturado', async () => {
  const r = await executar({
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: PASSADO },
    contratos: CONTRATO_OK, proposta: SNAP,
  });
  assert.equal(r.nextChamado, 0);
  assert.equal(r.resposta.status, 403);
  assert.equal(r.resposta.body.situacao, 'trial_expirado_aguardando_decisao');
  assert.equal(r.resposta.body.motivo, 'trial_vencido_sem_decisao');
});

test('v2 GET (consulta) NÃO é bloqueado mesmo com trial expirado', async () => {
  const r = await executar({
    method: 'GET',
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: PASSADO },
    contratos: CONTRATO_OK, proposta: SNAP,
  });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('v2 super-admin nunca é bloqueado', async () => {
  const r = await executar({
    user: { is_super_admin: true },
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: PASSADO },
    contratos: CONTRATO_OK, proposta: SNAP,
  });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('conta LEGADA (sem flow v2) ativa → segue caminho antigo, não bloqueia', async () => {
  const r = await executar({
    empresa: { status: 'ativo', trial_ends_at: null },
    contratos: [],
  });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('v2 trial ativo + contrato obrigatório pendente → escrita liberada pelo estado comercial', async () => {
  const r = await executar({
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: FUTURO },
    contratos: [{ obrigatorio: true, status: 'aguardando_assinatura' }], proposta: SNAP,
  });
  assert.equal(r.nextChamado, 1);
  assert.equal(r.resposta, null);
});

test('v2 sem trial vigente + contrato obrigatorio pendente aguarda ativacao por termos', async () => {
  const r = await executar({
    empresa: { commercial_flow_version: 'v2', status: 'trial', trial_ends_at: null },
    contratos: [{ obrigatorio: true, status: 'aguardando_assinatura' }], proposta: SNAP,
  });
  assert.equal(r.nextChamado, 0);
  assert.equal(r.resposta.status, 403);
  assert.equal(r.resposta.body.motivo, 'trial_nao_iniciado');
  assert.equal(r.resposta.body.situacao, 'aguardando_ativacao_trial');
});

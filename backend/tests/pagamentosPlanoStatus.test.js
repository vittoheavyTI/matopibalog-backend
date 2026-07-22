// Macrofrente fluxo financeiro — PR-A: contatos de suporte no plano-status.
// Testa a rota GET /pagamentos/me/plano-status com supabase mockado: o bloco
// `regularizacao` deve trazer suporte_email/suporte_whatsapp/suporte_telefone
// com a cadeia de fallback (chaves dedicadas da aba Sistema → contatos públicos
// da aparência do login), e nunca string vazia — ausência sai como null.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');

let verifyToken, verificarEmpresa;
{
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    verifyToken = require('../middlewares/auth').verifyToken;
    verificarEmpresa = require('../middlewares/tenant').verificarEmpresa;
  } finally {
    Module._load = originalLoad;
  }
}

const EMPRESA_ID = 'e5afecd6-2335-4436-86a7-0dfb495b9cbc';

// ── Mock supabase ────────────────────────────────────────────────────────────
// carregarPlanoStatus consulta: empresas (.select().eq().single()),
// usuarios (.select(count head).eq().eq().eq() → thenable) e
// configuracoes (.select().eq().maybeSingle()).
function criarSupabaseMock({ empresa, adminsCount = 1, configDados = null } = {}) {
  function builderEmpresas() {
    const b = {
      select() { return b; },
      eq() { return b; },
      single() { return Promise.resolve({ data: empresa ?? null, error: empresa ? null : new Error('não encontrada') }); },
    };
    return b;
  }
  function builderUsuarios() {
    const b = {
      select() { return b; },
      eq() { return b; },
      then(onF, onR) { return Promise.resolve({ count: adminsCount, error: null }).then(onF, onR); },
    };
    return b;
  }
  function builderConfiguracoes() {
    const b = {
      select() { return b; },
      eq() { return b; },
      maybeSingle() { return Promise.resolve({ data: configDados === null ? null : { dados: configDados }, error: null }); },
    };
    return b;
  }
  return {
    from(tabela) {
      if (tabela === 'empresas') return builderEmpresas();
      if (tabela === 'usuarios') return builderUsuarios();
      if (tabela === 'configuracoes') return builderConfiguracoes();
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
}

function carregarRouter(supabaseMock) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === 'axios') return { async get() { return { data: {} }; }, async post() { return { data: {} }; } };
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
  }
}

const ROTA = '/me/plano-status';
function acharRoute(router) {
  for (const layer of router.stack) {
    const r = layer.route;
    if (r && r.path === ROTA && r.methods.get) return r;
  }
  throw new Error('Rota não encontrada');
}
function getHandler(router) { const r = acharRoute(router); return r.stack[r.stack.length - 1].handle; }
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
async function chamar(cenario, req) {
  const router = carregarRouter(criarSupabaseMock(cenario));
  const res = fakeRes();
  await getHandler(router)(req, res, () => {});
  return res;
}

const EMPRESA_SUSPENSA = { status: 'suspenso', tipo: 'autonomo', trial_ends_at: null, plano_id: 'p1', planos: { nome: 'Plano Básico', preco_mensal: 99, limite_motoristas: 5 } };
const REQ_MOTORISTA = { user: { uid: 'u1', role: 'motorista' }, empresa_id: EMPRESA_ID };

// ── guards ───────────────────────────────────────────────────────────────────
test('rota exige verifyToken e verificarEmpresa', () => {
  const router = carregarRouter(criarSupabaseMock({ empresa: EMPRESA_SUSPENSA }));
  const route = acharRoute(router);
  const handles = route.stack.map((l) => l.handle);
  assert.equal(handles.length, 3, 'esperado [verifyToken, verificarEmpresa, handler]');
  assert.equal(handles[0], verifyToken);
  assert.equal(handles[1], verificarEmpresa);
});

// ── chaves dedicadas têm precedência ─────────────────────────────────────────
test('suspenso com chaves dedicadas → devolve os três contatos', async () => {
  const res = await chamar(
    {
      empresa: EMPRESA_SUSPENSA,
      adminsCount: 0,
      configDados: {
        email_suporte: 'suporte@matopibalog.com.br',
        whatsapp_suporte: '5599999990000',
        telefone_suporte: '(99) 3333-0000',
        contactEmail: 'nao-deve-usar@x.com',
        contactPhone: '(11) 0000-0000',
      },
    },
    REQ_MOTORISTA,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'suspenso');
  assert.equal(res.body.regularizacao.suporte_email, 'suporte@matopibalog.com.br');
  assert.equal(res.body.regularizacao.suporte_whatsapp, '5599999990000');
  assert.equal(res.body.regularizacao.suporte_telefone, '(99) 3333-0000');
});

// ── fallback para contatos da aparência ──────────────────────────────────────
test('sem chaves dedicadas → cai para contactEmail/contactPhone da aparência', async () => {
  const res = await chamar(
    {
      empresa: EMPRESA_SUSPENSA,
      adminsCount: 0,
      configDados: { contactEmail: 'contato@matopibalog.com.br', contactPhone: '(99) 98888-7777' },
    },
    REQ_MOTORISTA,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.regularizacao.suporte_email, 'contato@matopibalog.com.br');
  assert.equal(res.body.regularizacao.suporte_whatsapp, null); // whatsapp não tem fallback
  assert.equal(res.body.regularizacao.suporte_telefone, '(99) 98888-7777');
});

// ── nada configurado → null, nunca string vazia ──────────────────────────────
test('config vazia/ausente → contatos null (nunca string vazia)', async () => {
  for (const configDados of [null, {}, { email_suporte: '   ', contactEmail: '', telefone_suporte: '' }]) {
    const res = await chamar({ empresa: EMPRESA_SUSPENSA, adminsCount: 0, configDados }, REQ_MOTORISTA);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.regularizacao.suporte_email, null);
    assert.equal(res.body.regularizacao.suporte_whatsapp, null);
    assert.equal(res.body.regularizacao.suporte_telefone, null);
  }
});

// ── contrato preservado (campos que o app já consome) ────────────────────────
test('mantém o contrato existente: status, trial, plano e responsavel', async () => {
  const res = await chamar(
    { empresa: EMPRESA_SUSPENSA, adminsCount: 0, configDados: { email_suporte: 's@x.com' } },
    REQ_MOTORISTA,
  );
  assert.equal(res.body.empresa_tipo, 'autonomo');
  assert.equal(res.body.trial_expirado, false);
  assert.equal(res.body.plano_id, 'p1');
  assert.equal(res.body.plano.nome, 'Plano Básico');
  // Autônomo (motorista dono, sem admin ativo) conduz a própria regularização.
  assert.equal(res.body.regularizacao.responsavel, 'autonomo');
});

// ── sem empresa_id → 400 ─────────────────────────────────────────────────────
test('sem empresa_id → 400', async () => {
  const res = await chamar({ empresa: EMPRESA_SUSPENSA }, { user: { uid: 'u1', role: 'motorista' }, empresa_id: null });
  assert.equal(res.statusCode, 400);
});

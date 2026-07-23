// Go-live PR1: trava categoria×tipo nas rotas POST/PUT /painel-admin/empresas.
// Carrega o router com supabase mockado e chama os handlers direto (os guards
// verifyToken/isAdmin/isSuperAdmin não são executados — chamamos o handler final).

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/painel-admin');

// Mock supabase: planos.select().eq('id').maybeSingle() → categoria do plano;
// empresas.select('tipo').eq('id').maybeSingle() → tipo atual (PUT);
// empresas.insert/update → captura payload.
function criarSupabaseMock({ planoCategoria = 'ambos', planoExiste = true, empresaTipoAtual = 'autonomo' } = {}) {
  const reg = { insertEmpresa: null, updateEmpresa: null };
  function from(tabela) {
    const ctx = { tabela, op: 'select', filtros: {}, payload: null };
    const api = {
      select() { return api; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; if (tabela === 'empresas') reg.insertEmpresa = p; return api; },
      update(p) { ctx.op = 'update'; ctx.payload = p; if (tabela === 'empresas') reg.updateEmpresa = p; return api; },
      eq(k, v) { ctx.filtros[k] = v; return api; },
      order() { return api; },
      maybeSingle() {
        if (tabela === 'planos') return Promise.resolve({ data: planoExiste ? { id: ctx.filtros.id, categoria: planoCategoria, dias_trial: 7 } : null, error: null });
        if (tabela === 'empresas') {
          // Checagem de unicidade de código-convite (empresaService) → null = livre.
          if ('codigo_convite' in ctx.filtros) return Promise.resolve({ data: null, error: null });
          // Consulta de tipo atual no PUT (filtro por id).
          return Promise.resolve({ data: { tipo: empresaTipoAtual }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single() { return Promise.resolve({ data: { id: 'nova', ...(ctx.payload || {}) }, error: null }); },
    };
    return api;
  }
  return { __reg: reg, from };
}

// empresaService faz require('../config/supabase') no topo — precisa do mesmo mock.
function carregarRouter(supabaseMock) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  // limpa caches dos módulos que puxam supabase para o mock valer
  for (const k of Object.keys(require.cache)) {
    if (/services[\\/]empresaService|config[\\/]supabase|routes[\\/]painel-admin/.test(k)) delete require.cache[k];
  }
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
  }
}

function acharRoute(router, method, path) {
  for (const layer of router.stack) {
    const r = layer.route;
    if (r && r.path === path && r.methods[method]) return r;
  }
  throw new Error(`Rota ${method} ${path} não encontrada`);
}
function getHandler(router, method, path) {
  const r = acharRoute(router, method, path);
  return r.stack[r.stack.length - 1].handle;
}
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const UUID = '00000000-0000-0000-0000-000000000002';
const superAdmin = { uid: 'sa', is_super_admin: true };

// ── POST: autônomo em plano de empresa → 400, sem inserir ────────────────────
test('POST /empresas: autônomo + plano categoria empresa → 400', async () => {
  const supabase = criarSupabaseMock({ planoCategoria: 'empresa' });
  const router = carregarRouter(supabase);
  const res = fakeRes();
  await getHandler(router, 'post', '/empresas')(
    { user: superAdmin, body: { nome: 'Zé', tipo: 'autonomo', plano_id: UUID } }, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /autônomo/i);
  assert.equal(supabase.__reg.insertEmpresa, null, 'não pode inserir empresa');
});

// ── POST: transportadora em plano autônomo → 400 ─────────────────────────────
test('POST /empresas: transportadora + plano categoria autonomo → 400', async () => {
  const supabase = criarSupabaseMock({ planoCategoria: 'autonomo' });
  const router = carregarRouter(supabase);
  const res = fakeRes();
  await getHandler(router, 'post', '/empresas')(
    { user: superAdmin, body: { nome: 'Transp', tipo: 'transportadora', plano_id: UUID } }, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /empresa/i);
});

// ── POST: categoria ambos → passa (chega a inserir) ──────────────────────────
test('POST /empresas: plano categoria ambos → não barra pela categoria', async () => {
  const supabase = criarSupabaseMock({ planoCategoria: 'ambos' });
  const router = carregarRouter(supabase);
  const res = fakeRes();
  await getHandler(router, 'post', '/empresas')(
    { user: superAdmin, body: { nome: 'Zé', tipo: 'autonomo', plano_id: UUID } }, res, () => {});
  assert.notEqual(res.statusCode, 400);
  assert.ok(supabase.__reg.insertEmpresa, 'deve inserir a empresa');
});

// ── PUT: troca plano incompatível usando tipo do registro atual → 400 ────────
test('PUT /empresas/:id: plano empresa numa empresa autônoma (tipo do banco) → 400', async () => {
  const supabase = criarSupabaseMock({ planoCategoria: 'empresa', empresaTipoAtual: 'autonomo' });
  const router = carregarRouter(supabase);
  const res = fakeRes();
  await getHandler(router, 'put', '/empresas/:id')(
    { user: superAdmin, params: { id: 'e1' }, body: { plano_id: UUID } }, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /autônomo/i);
  assert.equal(supabase.__reg.updateEmpresa, null, 'não pode atualizar empresa');
});

// ── PUT: mesmo plano empresa, mas empresa é transportadora → passa ───────────
test('PUT /empresas/:id: plano empresa numa transportadora → atualiza', async () => {
  const supabase = criarSupabaseMock({ planoCategoria: 'empresa', empresaTipoAtual: 'transportadora' });
  const router = carregarRouter(supabase);
  const res = fakeRes();
  await getHandler(router, 'put', '/empresas/:id')(
    { user: superAdmin, params: { id: 'e1' }, body: { plano_id: UUID } }, res, () => {});
  assert.notEqual(res.statusCode, 400);
  assert.ok(supabase.__reg.updateEmpresa, 'deve atualizar');
});

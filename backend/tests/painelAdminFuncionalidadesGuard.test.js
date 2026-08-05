// Testes HTTP REAIS da autorização dos 9 endpoints admin de Funcionalidades/Matriz
// /Clientes/Auditoria (PR 2C-B/2C-D). Carrega o ROUTER REAL (painel-admin.js) com
// a mesma cadeia router.use(verifyToken, isAdmin, isSuperAdmin), mocando apenas o
// client Supabase. Prova a matriz: sem token→401, token inválido→403, papel
// comum→403, admin de empresa (não super)→403, super-admin→passa (não 401/403).
// Assim nenhuma rota admin fica pública.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

// Resposta configurável da RPC (para exercitar o mapeamento de erros via HTTP).
let rpcResult = { data: { alterado: false }, error: null };

// Stub encadeável do Supabase (nunca conecta). Suporta from(...).select/eq/...
// e rpc(...). Só é alcançado quando o guard deixa passar (super-admin).
function supabaseStub() {
  const thenable = (val = { data: [], error: null }) => {
    const b = {
      select: () => b, eq: () => b, or: () => b, order: () => b, limit: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => b, upsert: () => Promise.resolve({ error: null }),
      then: (res) => res(val),
    };
    return b;
  };
  return { from: () => thenable(), rpc: () => Promise.resolve(rpcResult) };
}

function carregarRouterReal() {
  const supaPath = require.resolve('../config/supabase');
  const originalLoad = Module._load;
  delete require.cache[require.resolve('../routes/painel-admin')];
  delete require.cache[supaPath];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseStub();
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/painel-admin');
  } finally {
    Module._load = originalLoad;
  }
}

// Sobe um app efêmero com o router real montado em /painel-admin.
function subirApp() {
  const app = express();
  app.use(express.json());
  app.use('/painel-admin', carregarRouterReal());
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function token(payload) { return jwt.sign(payload, process.env.JWT_SECRET); }

const SUPER = token({ uid: 'u-super', role: 'admin', is_super_admin: true });
const ADMIN_EMPRESA = token({ uid: 'u-emp', role: 'admin', is_super_admin: false });
const COMUM = token({ uid: 'u-comum', role: 'motorista', is_super_admin: false });

// Os 9 endpoints admin (método + caminho concreto).
const ENDPOINTS = [
  ['GET', '/painel-admin/funcionalidades'],
  ['POST', '/painel-admin/funcionalidades'],
  ['PUT', '/painel-admin/funcionalidades/abc'],
  ['POST', '/painel-admin/funcionalidades/abc/arquivar'],
  ['GET', '/painel-admin/funcionalidades-matriz'],
  ['PUT', '/painel-admin/funcionalidades-matriz'],
  ['GET', '/painel-admin/funcionalidades-auditoria'],
  ['GET', '/painel-admin/empresas/abc/entitlements'],
  ['GET', '/painel-admin/entitlements/simular?empresa_id=abc&codigo=x'],
  ['GET', '/painel-admin/empresas/buscar?q=teste'],
];

async function req(port, method, path, { auth } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['authorization'] = `Bearer ${auth}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: method === 'GET' ? undefined : '{}' });
  return res.status;
}

let ctx;
test.before(async () => { ctx = await subirApp(); });
test.after(() => { ctx.server.close(); });

test('sem token → 401 em TODOS os 9 endpoints', async () => {
  for (const [m, p] of ENDPOINTS) {
    assert.equal(await req(ctx.port, m, p), 401, `${m} ${p}`);
  }
});

test('token inválido → 403 em todos', async () => {
  for (const [m, p] of ENDPOINTS) {
    const res = await fetch(`http://127.0.0.1:${ctx.port}${p}`, { method: m, headers: { authorization: 'Bearer lixo.invalido', 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 403, `${m} ${p}`);
  }
});

test('usuário comum (role≠admin) → 403 em todos', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal(await req(ctx.port, m, p, { auth: COMUM }), 403, `${m} ${p}`);
});

test('admin de empresa (não super-admin) → 403 em todos', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal(await req(ctx.port, m, p, { auth: ADMIN_EMPRESA }), 403, `${m} ${p}`);
});

test('super-admin → passa o guard (nunca 401/403) em todos', async () => {
  for (const [m, p] of ENDPOINTS) {
    const s = await req(ctx.port, m, p, { auth: SUPER });
    assert.ok(s !== 401 && s !== 403, `${m} ${p} retornou ${s} (guard bloqueou super-admin)`);
  }
});

// End-to-end HTTP do PUT /funcionalidades-matriz (route → serviço → mapeamento).
async function putMatriz(body, rpc) {
  rpcResult = rpc;
  const res = await fetch(`http://127.0.0.1:${ctx.port}/painel-admin/funcionalidades-matriz`, {
    method: 'PUT', headers: { authorization: `Bearer ${SUPER}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('PUT matriz: itens vazios → 400 (não chega à RPC)', async () => {
  const r = await putMatriz({ itens: [] }, { data: null, error: null });
  assert.equal(r.status, 400);
});

test('PUT matriz: conflito de versão da RPC → 409 com dados p/ recarregar', async () => {
  const r = await putMatriz(
    { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }], versoes_esperadas: { p1: 1 } },
    { data: null, error: { code: 'P0003', message: 'conflito_versao:p1:1:2' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'conflito_versao');
  assert.equal(r.body.versao_atual, 2);
});

test('PUT matriz: sucesso da RPC → 200 com resultado', async () => {
  const r = await putMatriz(
    { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }], versoes_esperadas: { p1: 1 } },
    { data: { alterado: true, celulas_alteradas: 1 }, error: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.alterado, true);
});

// Autorização + comportamento dos endpoints 3A-2 em routes/pagamentos.js:
//   GET  /pagamentos/billing/overview/:empresa_id
//   POST /pagamentos/billing/ensure-plan/:empresa_id
//   POST /pagamentos/billing/reconciliar-plan/:empresa_id
// Todos super-admin. Carrega o router real com supabase e serviços de situação
// mockados. Prova: sem token 401, comum/admin-empresa 403, super passa; e que os
// endpoints NÃO executam writes (dry).

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

let empresaRow = { id: 'e1', nome: 'Alfa', status: 'ativo', plano_id: 'p1', trial_ends_at: null, asaas_customer_id: null, asaas_subscription_id: null, billing_status: null, next_due_date: null, billing_updated_at: null, planos: { nome: 'Empresa Start' } };

function supabaseStub() {
  function builder(tabela) {
    const rowsFor = () => {
      if (tabela === 'empresas') return empresaRow;
      return null;
    };
    const b = {
      select: () => b,
      eq: () => b,
      or: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert: () => b,
      maybeSingle: () => Promise.resolve({ data: rowsFor(), error: null }),
      then: (res) => res({ data: tabela === 'faturas' ? [] : [], error: null }),
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

function carregarRouterReal() {
  const supaPath = require.resolve('../config/supabase');
  const situPath = require.resolve('../services/situacaoComercialService');
  const originalLoad = Module._load;
  delete require.cache[require.resolve('../routes/pagamentos')];
  delete require.cache[supaPath];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseStub();
    if (request === '../services/situacaoComercialService') {
      return { carregarSituacaoComercial: async () => ({ situacao: 'trial_ativo', trial_ends_at: null }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/pagamentos');
  } finally {
    Module._load = originalLoad;
  }
}

function subirApp() {
  const app = express();
  app.use(express.json());
  app.use('/pagamentos', carregarRouterReal());
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function token(p) { return jwt.sign(p, process.env.JWT_SECRET); }
const SUPER = token({ uid: 'u-super', role: 'admin', is_super_admin: true });
const ADMIN_EMPRESA = token({ uid: 'u-emp', role: 'admin', is_super_admin: false });
const COMUM = token({ uid: 'u-comum', role: 'motorista', is_super_admin: false });

const ENDPOINTS = [
  ['GET', '/pagamentos/billing/overview/e1'],
  ['POST', '/pagamentos/billing/ensure-plan/e1'],
  ['POST', '/pagamentos/billing/reconciliar-plan/e1'],
  ['POST', '/pagamentos/billing/processar-outbox'],
  ['GET', '/pagamentos/billing/jobs'],
];

async function req(port, method, path, auth) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['authorization'] = `Bearer ${auth}`;
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: method === 'GET' ? undefined : '{}' });
}

let ctx;
test.before(async () => { ctx = await subirApp(); });
test.after(() => { ctx.server.close(); });

test('sem token → 401', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p)).status, 401, `${m} ${p}`);
});
test('token inválido → 403', async () => {
  for (const [m, p] of ENDPOINTS) {
    const r = await fetch(`http://127.0.0.1:${ctx.port}${p}`, { method: m, headers: { authorization: 'Bearer lixo', 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});
test('usuário comum → 403', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p, COMUM)).status, 403, `${m} ${p}`);
});
test('admin de empresa (não super) → 403', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p, ADMIN_EMPRESA)).status, 403, `${m} ${p}`);
});
test('super-admin passa o guard (nunca 401/403)', async () => {
  for (const [m, p] of ENDPOINTS) {
    const s = (await req(ctx.port, m, p, SUPER)).status;
    assert.ok(s !== 401 && s !== 403, `${m} ${p} retornou ${s}`);
  }
});

test('ensure-plan devolve plano dry (executado=false)', async () => {
  const r = await req(ctx.port, 'POST', '/pagamentos/billing/ensure-plan/e1', SUPER);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.executado, false);
  assert.ok(body.plano);
});

test('reconciliar-plan devolve reconciliação dry (executado=false)', async () => {
  const r = await req(ctx.port, 'POST', '/pagamentos/billing/reconciliar-plan/e1', SUPER);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.executado, false);
  assert.ok(body.reconciliacao);
});

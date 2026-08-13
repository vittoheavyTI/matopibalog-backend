// Testes HTTP REAIS dos endpoints admin de Contratos da macrofrente 3A-1:
//   GET /painel-admin/contratos        (lista agregada cross-tenant, §18)
//   GET /painel-admin/contratos/:id     (detalhe, §5)
// Carrega o ROUTER REAL (painel-admin.js) com a cadeia
// router.use(verifyToken, isAdmin, isSuperAdmin), mocando só o client Supabase.
// Prova a matriz de autorização (§23) + comportamento (mapeamento, 404, UUID inválido).

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

// Dados configuráveis por teste.
let listaRows = [];
let detalheRow = null;
let detalheError = null;

function supabaseStub() {
  // Builder para a LISTA: termina em thenable (await) após order/limit.
  function listaBuilder() {
    const b = {
      select: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: listaRows, error: null }),
    };
    return b;
  }
  // Builder para o DETALHE: select().eq().maybeSingle().
  function detalheBuilder() {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: detalheRow, error: detalheError }),
    };
    return b;
  }
  return {
    from: (tabela) => {
      // Ambos os endpoints usam 'contratos_comerciais'; distinguimos pelo método
      // chamado. Devolvemos um objeto que suporta os dois caminhos.
      const lista = listaBuilder();
      const detalhe = detalheBuilder();
      return {
        select: (...args) => {
          // O detalhe encadeia .eq() logo após .select(); a lista encadeia .order().
          const sel = {
            order: (...a) => lista.order(...a),
            limit: (...a) => lista.limit(...a),
            eq: (...a) => detalhe.eq(...a),
          };
          void tabela; void args;
          return sel;
        },
      };
    },
  };
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

const UUID = '11111111-1111-1111-1111-111111111111';
const ENDPOINTS = [
  ['GET', '/painel-admin/contratos'],
  ['GET', `/painel-admin/contratos/${UUID}`],
];

async function req(port, method, path, { auth } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['authorization'] = `Bearer ${auth}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
  return res;
}

let ctx;
test.before(async () => { ctx = await subirApp(); });
test.after(() => { ctx.server.close(); });

test('sem token → 401', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p)).status, 401, `${m} ${p}`);
});

test('token inválido → 403', async () => {
  for (const [m, p] of ENDPOINTS) {
    const res = await fetch(`http://127.0.0.1:${ctx.port}${p}`, { method: m, headers: { authorization: 'Bearer lixo.invalido' } });
    assert.equal(res.status, 403, `${m} ${p}`);
  }
});

test('usuário comum → 403', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p, { auth: COMUM })).status, 403, `${m} ${p}`);
});

test('admin de empresa (não super) → 403', async () => {
  for (const [m, p] of ENDPOINTS) assert.equal((await req(ctx.port, m, p, { auth: ADMIN_EMPRESA })).status, 403, `${m} ${p}`);
});

test('super-admin passa o guard (nunca 401/403)', async () => {
  for (const [m, p] of ENDPOINTS) {
    const s = (await req(ctx.port, m, p, { auth: SUPER })).status;
    assert.ok(s !== 401 && s !== 403, `${m} ${p} retornou ${s}`);
  }
});

test('GET /contratos: super-admin recebe lista mapeada + resumo', async () => {
  listaRows = [
    {
      id: 'c1', empresa_id: 'e1', status: 'plenamente_assinado', obrigatorio: true,
      template_version: 'v3', content_hash: 'a'.repeat(64), criado_em: '2026-08-01T10:00:00.000Z',
      empresas: { nome: 'Empresa Alfa', tipo: 'transportadora' },
      propostas_comerciais: { snapshot: { plano_nome: 'Empresa Start' }, valor_mensal: 299.9 },
      contrato_signatarios: [],
    },
    {
      id: 'c2', empresa_id: 'e2', status: 'aguardando_assinatura_cliente', obrigatorio: true,
      template_version: 'v3', content_hash: 'b'.repeat(64), criado_em: '2026-08-05T10:00:00.000Z',
      empresas: { nome: 'Autônomo Beta', tipo: 'autonomo' },
      propostas_comerciais: { snapshot: { plano_nome: 'Autônomo Solo' }, valor_mensal: 99.9 },
      contrato_signatarios: [],
    },
  ];
  const res = await req(ctx.port, 'GET', '/painel-admin/contratos', { auth: SUPER });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.contratos.length, 2);
  assert.equal(body.resumo.total, 2);
  assert.equal(body.resumo.assinados, 1);
  assert.equal(body.resumo.pendentes, 1);
  // ordenado por criado_em desc
  assert.equal(body.contratos[0].contrato_id, 'c2');
});

test('GET /contratos?status=assinado: filtra no backend', async () => {
  const res = await req(ctx.port, 'GET', '/painel-admin/contratos?status=assinado', { auth: SUPER });
  const body = await res.json();
  assert.equal(body.contratos.length, 1);
  assert.equal(body.contratos[0].contrato_id, 'c1');
  assert.equal(body.total_sem_filtro, 2);
});

test('GET /contratos/:id UUID inválido → 400', async () => {
  const res = await req(ctx.port, 'GET', '/painel-admin/contratos/nao-uuid', { auth: SUPER });
  assert.equal(res.status, 400);
});

test('GET /contratos/:id inexistente → 404', async () => {
  detalheRow = null; detalheError = null;
  const res = await req(ctx.port, 'GET', `/painel-admin/contratos/${UUID}`, { auth: SUPER });
  assert.equal(res.status, 404);
});

test('GET /contratos/:id existente → 200 com detalhe + snapshot', async () => {
  detalheRow = {
    id: UUID, empresa_id: 'e1', proposta_id: 'p1', status: 'plenamente_assinado', obrigatorio: true,
    template_version: 'v3', content_hash: 'a'.repeat(64), criado_em: '2026-08-01T10:00:00.000Z',
    empresas: { nome: 'Empresa Alfa', tipo: 'transportadora' },
    propostas_comerciais: { id: 'p1', snapshot: { plano_nome: 'Empresa Start', trial_dias: 14 }, valor_mensal: 299.9, trial_dias: 14 },
    contrato_signatarios: [{ id: 's1', papel: 'cliente', status: 'assinado', assinado_em: '2026-08-02T11:00:00.000Z' }],
    contrato_eventos: [{ id: 'ev1', tipo: 'contrato_criado', criado_em: '2026-08-01T10:00:00.000Z' }],
  };
  detalheError = null;
  const res = await req(ctx.port, 'GET', `/painel-admin/contratos/${UUID}`, { auth: SUPER });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.contrato_id, UUID);
  assert.equal(body.plano_nome, 'Empresa Start');
  assert.equal(body.trial_dias, 14);
  assert.equal(body.signatarios.length, 1);
  assert.equal(body.eventos.length, 1);
  assert.equal(body.snapshot.plano_nome, 'Empresa Start');
});

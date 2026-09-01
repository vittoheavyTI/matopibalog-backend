'use strict';

// S1-HIGH-03 — PIX_VIEW_AUTHORITY = finance.saas.view.
//
// `GET /pagamentos/faturas/:id/pix` tinha autenticação e isolamento de tenant, mas
// nenhuma checagem de permissão — enquanto todas as rotas financeiras irmãs exigem
// `finance.saas.view`. Qualquer usuário autenticado da empresa obtinha o
// QR/copia-e-cola de uma fatura se conhecesse o id dela.
//
// Estes testes usam o RESOLVER REAL de permissões (só o acesso ao banco é
// substituído por fixtures), porque o ponto central da correção é justamente a
// compatibilidade com o app do autônomo: ele passa não por uma exceção escrita na
// rota, mas porque o resolver lê `empresas.tipo` e concede `finance.saas.view` ao
// autônomo por bypass legado. Provar isso com um stub de permissão provaria nada.
//
// A asserção mais importante não é o 403: é `chamadasProvider === 0` no caminho
// negado. Autorização depois da chamada externa seria autorização tarde demais.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

// ── Fixtures ────────────────────────────────────────────────────────────────
const FATURA = {
  id: 'fat-1',
  empresa_id: 'emp-autonomo',
  asaas_id: 'pay_123',
  tipo_pagamento: 'PIX',
};

// Empresas por id. O resolver lê `empresas.tipo` para decidir o bypass do autônomo.
const EMPRESAS = {
  'emp-autonomo': { id: 'emp-autonomo', tipo: 'autonomo' },
  'emp-transportadora': { id: 'emp-transportadora', tipo: 'transportadora' },
};

// Usuários por uid, no formato que o resolver consulta.
const USUARIOS = {
  'u-autonomo-dono': {
    id: 'u-autonomo-dono', tipo: 'motorista', empresa_id: 'emp-autonomo',
    permission_template_id: null, empresas: { tipo: 'autonomo' },
  },
  'u-motorista-vinculado': {
    id: 'u-motorista-vinculado', tipo: 'motorista', empresa_id: 'emp-autonomo',
    permission_template_id: null, empresas: { tipo: 'transportadora' },
  },
  'u-operador': {
    id: 'u-operador', tipo: 'operador', empresa_id: 'emp-autonomo',
    permission_template_id: null, empresas: { tipo: 'transportadora' },
  },
  // No V9 uma persona não-legada vem por `permission_template_id`, não pelo `tipo`
  // (LEGACY_TIPO_TO_TEMPLATE só mapeia admin e motorista). Representar o Financeiro
  // pelo tipo legado testaria um usuário que não existe.
  'u-financeiro': {
    id: 'u-financeiro', tipo: 'financeiro', empresa_id: 'emp-autonomo',
    permission_template_id: 'tpl-financeiro', empresas: { tipo: 'transportadora' },
  },
  // Mesma persona autorizada, porém de OUTRO tenant que a fatura.
  'u-outro-tenant': {
    id: 'u-outro-tenant', tipo: 'admin', empresa_id: 'emp-transportadora',
    permission_template_id: null, empresas: { tipo: 'transportadora' },
  },
};

let faturaExiste = true;
let chamadasProvider = 0;

// Templates de permissão: o resolver real busca o baseline do `tipo` legado no
// banco. Servimos o baseline canônico do registry, para que a autoridade exercitada
// seja a de produção e não uma invenção do teste.
const { templateBaselineMap } = require('../services/permissions/permissionRegistry');

function supabaseStub() {
  function builder(tabela) {
    let filtroId = null;
    const filtros = {};
    const b = {
      select: () => b,
      eq: (col, val) => { filtros[col] = val; if (filtroId === null) filtroId = val; return b; },
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        if (tabela === 'permission_templates') {
          // Busca por id (template atribuído) ou por (empresa, stable_key) — os dois
          // caminhos que `carregarTemplate` usa.
          const chave = filtros.stable_key || String(filtros.id || '').replace(/^tpl-/, '');
          if (!chave) return { data: null, error: null };
          return { data: { id: `tpl-${chave}`, stable_key: chave, display_name: chave, driver_financial_visibility_mode: null }, error: null };
        }
        if (tabela === 'usuarios') return { data: USUARIOS[filtroId] || null, error: null };
        if (tabela === 'empresas') return { data: EMPRESAS[filtroId] || null, error: null };
        if (tabela === 'faturas') return { data: faturaExiste ? FATURA : null, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        if (tabela === 'faturas') {
          return faturaExiste
            ? { data: FATURA, error: null }
            : { data: null, error: { message: 'not found' } };
        }
        if (tabela === 'empresas') return { data: EMPRESAS[filtroId] || null, error: null };
        if (tabela === 'configuracoes') {
          return { data: { dados: { integracao_asaas: { environment: 'sandbox', api_key: 'k' } } }, error: null };
        }
        return { data: null, error: null };
      },
      then: (res) => {
        if (tabela === 'permission_template_permissions') {
          const chave = String(filtros.template_id || '').replace(/^tpl-/, '');
          const mapa = templateBaselineMap(chave) || {};
          return res({
            data: Object.entries(mapa).filter(([, v]) => v === true).map(([permission_key]) => ({ permission_key, allowed: true })),
            error: null,
          });
        }
        return res({ data: [], error: null }); // overrides: nenhum
      },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

// Adapter HTTP fake: conta as chamadas ao provedor. Se a autorização vier depois da
// chamada externa, este contador denuncia.
const axiosFake = {
  get: async () => {
    chamadasProvider += 1;
    return { data: { encodedImage: 'img', payload: 'copia-e-cola', expirationDate: '2026-09-10' } };
  },
  post: async () => ({ data: {} }),
};

function carregarRouterReal() {
  const originalLoad = Module._load;
  delete require.cache[require.resolve('../routes/pagamentos')];
  delete require.cache[require.resolve('../config/supabase')];
  delete require.cache[require.resolve('../middlewares/requirePermission')];
  const stub = supabaseStub();
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return stub;
    if (request === 'axios') return axiosFake;
    if (request === '../utils/asaasConfig') {
      return { resolveAsaasApiKey: () => ({ apiKey: 'k', baseURL: 'https://sandbox.invalid' }) };
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

const token = (p) => jwt.sign(p, process.env.JWT_SECRET);
const AUTONOMO_DONO = token({ uid: 'u-autonomo-dono', role: 'motorista', is_super_admin: false, empresa_id: 'emp-autonomo' });
const MOTORISTA_VINCULADO = token({ uid: 'u-motorista-vinculado', role: 'motorista', is_super_admin: false, empresa_id: 'emp-autonomo' });
const OPERADOR = token({ uid: 'u-operador', role: 'operador', is_super_admin: false, empresa_id: 'emp-autonomo' });
const FINANCEIRO = token({ uid: 'u-financeiro', role: 'financeiro', is_super_admin: false, empresa_id: 'emp-autonomo' });
const OUTRO_TENANT = token({ uid: 'u-outro-tenant', role: 'admin', is_super_admin: false, empresa_id: 'emp-transportadora' });

let ctx;
async function pedirPix(auth) {
  chamadasProvider = 0;
  const headers = {};
  if (auth) headers.authorization = `Bearer ${auth}`;
  const r = await fetch(`http://127.0.0.1:${ctx.port}/pagamentos/faturas/fat-1/pix`, { headers });
  return { status: r.status, chamadasProvider };
}

test.before(async () => { ctx = await subirApp(); });
test.after(() => { ctx.server.close(); });

test('S1-HIGH-03: sem token → 401 e provedor não é chamado', async () => {
  const r = await pedirPix(null);
  assert.equal(r.status, 401);
  assert.equal(r.chamadasProvider, 0);
});

test('S1-HIGH-03: autônomo dono continua obtendo o Pix da própria fatura', async () => {
  // Compatibilidade com o app: passa pelo resolver REAL (bypass legado do autônomo
  // concede finance.saas.view), não por exceção escrita na rota.
  const r = await pedirPix(AUTONOMO_DONO);
  assert.equal(r.status, 200, 'a correção não pode quebrar o fluxo de pagamento do autônomo');
  assert.equal(r.chamadasProvider, 1);
});

test('S1-HIGH-03: o resolver REAL concede finance.saas.view ao autônomo', async () => {
  // Prova direta da premissa do teste acima — se este bypass sumir, a
  // compatibilidade do app cai junto, e é melhor descobrir aqui.
  const { computeEffectivePermissions, hasPermission } = require('../services/permissions/permissionResolver');
  const eff = computeEffectivePermissions({
    user: { tipo: 'motorista', empresa_tipo: 'autonomo' }, template: null,
  });
  assert.equal(hasPermission(eff, 'finance.saas.view'), true);
  assert.equal(eff.source['finance.saas.view'], 'legacy');
});

test('S1-HIGH-03: motorista vinculado → 403 e ZERO chamada ao provedor', async () => {
  const r = await pedirPix(MOTORISTA_VINCULADO);
  assert.equal(r.status, 403);
  assert.equal(r.chamadasProvider, 0, 'negar depois de consultar o provedor seria negar tarde demais');
});

test('S1-HIGH-03: operador sem autoridade financeira → 403, provedor intocado', async () => {
  const r = await pedirPix(OPERADOR);
  assert.equal(r.status, 403);
  assert.equal(r.chamadasProvider, 0);
});

test('S1-HIGH-03: Financeiro (tem finance.saas.view) obtém o Pix da própria empresa', async () => {
  const r = await pedirPix(FINANCEIRO);
  assert.equal(r.status, 200);
  assert.equal(r.chamadasProvider, 1);
});

test('S1-HIGH-03: outro tenant é negado mesmo tendo a permissão', async () => {
  // A permissão não expande fronteira de tenant: o Administrador de outra empresa
  // tem finance.saas.view e ainda assim não alcança a fatura alheia.
  const r = await pedirPix(OUTRO_TENANT);
  assert.equal(r.status, 403);
  assert.equal(r.chamadasProvider, 0);
});

test('S1-HIGH-03: fatura inexistente preserva o comportamento canônico (404)', async () => {
  faturaExiste = false;
  try {
    const r = await pedirPix(AUTONOMO_DONO);
    assert.equal(r.status, 404);
    assert.equal(r.chamadasProvider, 0);
  } finally {
    faturaExiste = true;
  }
});

test('S1-HIGH-03: a autoridade é a MESMA das rotas financeiras irmãs', async () => {
  // Guarda contra o retorno da assimetria: se alguém remover o gate do Pix, ou
  // trocá-lo por outra chave, este teste falha.
  const fonte = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'pagamentos.js'), 'utf8',
  );
  const rota = fonte.slice(fonte.indexOf("router.get('/faturas/:id/pix'"));
  const assinatura = rota.slice(0, rota.indexOf('\n'));
  assert.match(assinatura, /requirePermission\('finance\.saas\.view'\)/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// P2 (Review 7) — teste de CONTROLLER (não só helper): getById E getAll do
// fretesController redigem os campos financeiros do frete para o MOTORISTA conforme
// a visibility policy (commission_only | commission_plus_base | full_freight_financial).
// Campo não autorizado é OMITIDO (delete), nunca substituído por 0 — a comissão
// derivada é exposta (ou null quando não calculável), nunca forçada a R$ 0,00.
const controllerPath = require.resolve('../controllers/fretesController');

// Mock de supabase: fretes.single()/order() devolve o(s) frete(s); o resolver e o
// motorista devolvem visibility/percentual configuráveis. Templates/overrides → []
// (o resolver cai no baseline do registry pelo stable_key).
function criarController({ frete, fretes, motoristaRow, empresaTipo = 'transportadora' }) {
  const builder = (tabela) => {
    const listaFretes = { data: fretes || [], error: null };
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; },
      gte() { return b; }, lt() { return b; },
      order() { return { then(resolve) { resolve(listaFretes); } }; }, // getAll: fretes
      async single() { return tabela === 'fretes' ? { data: frete, error: null } : { data: null, error: null }; },
      async maybeSingle() {
        if (tabela === 'usuarios') return { data: { id: 'm-1', tipo: 'motorista', empresa_id: 'e-1', permission_template_id: null, empresas: { tipo: empresaTipo } }, error: null };
        if (tabela === 'motoristas') return { data: motoristaRow, error: null };
        return { data: null, error: null };
      },
      then(resolve) { resolve({ data: [], error: null }); }, // overrides/template_permissions → []
    };
    return b;
  };
  const supabaseMock = { from(t) { return builder(t); } };
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

const FRETE = () => ({ id: 'f1', motorista_id: 'm-1', empresa_id: 'e-1', status: 'ativo', origem: 'A', destino: 'B', valor_frete: 1000, valor_tonelada_km: 2.5, toneladas: 30 });
const MOTORISTA_USER = { role: 'motorista', uid: 'm-1', is_super_admin: false, empresa_tipo: 'transportadora' };

async function getById(user, motoristaRow, empresaTipo) {
  const controller = criarController({ frete: FRETE(), motoristaRow, empresaTipo });
  let resp = null;
  await controller.getById(
    { params: { id: 'f1' }, user },
    { status(s) { return { json(b) { resp = { s, b }; } }; } }
  );
  return resp;
}

async function getAll(user, motoristaRow) {
  const controller = criarController({ fretes: [FRETE()], motoristaRow });
  let resp = null;
  await controller.getAll(
    { query: {}, user, empresa_id: 'e-1' },
    { status(s) { return { json(b) { resp = { s, b }; } }; } }
  );
  return resp;
}

// ── getById ──────────────────────────────────────────────────────────────────
test('getById motorista commission_only: brutos omitidos; comissão exposta', async () => {
  const r = await getById(MOTORISTA_USER, { financial_visibility_mode: 'commission_only', percentual_comissao: 12, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.equal(r.b.valor_frete, undefined);
  assert.equal(r.b.valor_tonelada_km, undefined);
  assert.equal(r.b.toneladas, undefined);
  assert.equal(r.b.comissao_valor, 120);
  assert.equal(r.b.comissao_percentual, 12);
});

test('getById motorista commission_plus_base: valor_frete presente; demais brutos omitidos', async () => {
  const r = await getById(MOTORISTA_USER, { financial_visibility_mode: 'commission_plus_base', percentual_comissao: 10, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.equal(r.b.valor_frete, 1000);          // base do cálculo mantida
  assert.equal(r.b.valor_tonelada_km, undefined); // demais brutos omitidos
  assert.equal(r.b.toneladas, undefined);
  assert.equal(r.b.comissao_valor, 100);
});

test('getById motorista full_freight_financial: todos os brutos presentes', async () => {
  const r = await getById(MOTORISTA_USER, { financial_visibility_mode: 'full_freight_financial', percentual_comissao: 10, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.equal(r.b.valor_frete, 1000);
  assert.equal(r.b.valor_tonelada_km, 2.5);
  assert.equal(r.b.toneladas, 30);
});

test('getById admin/super-admin: sem redação (valor_frete presente)', async () => {
  const r2 = await getById({ role: 'admin', uid: 'a-1', is_super_admin: true }, null);
  assert.equal(r2.s, 200);
  assert.equal(r2.b.valor_frete, 1000);
});

// P2 (Review 6) — AUTÔNOMO no nível de CONTROLLER/API (não só unit do resolver):
// motorista de empresa autônoma vê o financeiro COMPLETO por padrão (o dono sempre
// viu o próprio frete), SEM precisar de override individual. Preserva o efetivo legado.
test('getById motorista AUTÔNOMO: visibilidade full por padrão (valor_frete presente, sem override)', async () => {
  const r = await getById(
    { role: 'motorista', uid: 'm-1', is_super_admin: false, empresa_tipo: 'autonomo' },
    { financial_visibility_mode: null, percentual_comissao: 10, pode_finalizar_viagem: false },
    'autonomo'
  );
  assert.equal(r.s, 200);
  assert.equal(r.b.valor_frete, 1000);
  assert.equal(r.b.valor_tonelada_km, 2.5);
  assert.equal(r.b.toneladas, 30);
});

// ── getAll ───────────────────────────────────────────────────────────────────
test('getAll motorista commission_only: lista redige brutos; comissão exposta', async () => {
  const r = await getAll(MOTORISTA_USER, { financial_visibility_mode: 'commission_only', percentual_comissao: 12, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.ok(Array.isArray(r.b));
  assert.equal(r.b[0].valor_frete, undefined);
  assert.equal(r.b[0].valor_tonelada_km, undefined);
  assert.equal(r.b[0].comissao_valor, 120);
});

test('getAll motorista commission_plus_base: lista mantém valor_frete, omite demais', async () => {
  const r = await getAll(MOTORISTA_USER, { financial_visibility_mode: 'commission_plus_base', percentual_comissao: 10, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.equal(r.b[0].valor_frete, 1000);
  assert.equal(r.b[0].valor_tonelada_km, undefined);
  assert.equal(r.b[0].comissao_valor, 100);
});

test('getAll motorista full_freight_financial: lista sem redação', async () => {
  const r = await getAll(MOTORISTA_USER, { financial_visibility_mode: 'full_freight_financial', percentual_comissao: 10, pode_finalizar_viagem: false });
  assert.equal(r.s, 200);
  assert.equal(r.b[0].valor_frete, 1000);
  assert.equal(r.b[0].valor_tonelada_km, 2.5);
  assert.equal(r.b[0].toneladas, 30);
});

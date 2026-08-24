'use strict';

// Intercepta config/supabase (stub) antes de carregar as tools (evita createClient
// real / Node 20 sem WebSocket no CI). O supabase real nunca é usado (passamos ctx).
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/[\\/]config[\\/]supabase$/.test(request) || request === '../config/supabase' || request === '../../config/supabase') {
    return { from: () => { throw new Error('stub'); } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/ai/toolRegistry');
const { registerAllTools } = require('../services/ai/tools');

Module._load = originalLoad;

registry.clear();
registerAllTools();

// Stub encadeável de supabase: qualquer builder resolve os dados da tabela.
function makeSupabase(dataPorTabela) {
  function builder(tabela) {
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
      then(resolve) { resolve({ data: dataPorTabela[tabela] || [], error: null }); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const scope = { mode: 'COMPANY', authorized_empresa_ids: ['e1'] };
function ctx(over = {}) {
  return {
    supabase: makeSupabase({ fretes: [], motoristas: [] }),
    empresaId: 'e1', user: { uid: 'u1' }, isSuperAdmin: false,
    effectivePermissions: {}, operationalScope: scope, ...over,
  };
}

test('tool registrada com permissão reports.operational.view', () => {
  const t = registry.getTool('operation.command_center.summary');
  assert.ok(t);
  assert.equal(t.requiredPermission, 'reports.operational.view');
});

test('sem permissão → negado (handler não roda)', async () => {
  const r = await registry.executeTool('operation.command_center.summary', {}, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'permission_denied');
});

test('com permissão e SEM finance: resumo sem valor_frete; top-N seguro', async () => {
  const supabase = makeSupabase({
    fretes: [
      { id: 'f1', empresa_id: 'e1', motorista_id: 'm1', data: '2026-08-20', origem: 'A', destino: 'B', placa: 'ABC1D23', status: 'finalizado', valor_frete: 999 },
    ],
    motoristas: [{ id: 'm1', empresa_id: 'e1', usuarios: { nome: 'João' } }],
    frete_ocorrencias: [{ frete_id: 'f1', tipo: 'avaria', status: 'aberta' }],
    frete_epod: [], frete_epod_evidencias: [], frete_ultima_localizacao: [], frete_localizacao_estado: [],
  });
  const r = await registry.executeTool(
    'operation.command_center.summary', {},
    ctx({ supabase, effectivePermissions: { 'reports.operational.view': true } }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.data.resumo.criticos, 1);
  assert.equal(r.data.top_atencao.length, 1);
  const item = r.data.top_atencao[0];
  assert.equal(item.attention_code, 'OCORRENCIA_CRITICA');
  assert.equal(item.motorista_nome, 'João');
  assert.equal('valor_frete' in item, false); // top-N nunca expõe valor
  // O JSON completo do envelope não contém valor_frete (finance off)
  assert.ok(!JSON.stringify(r.data).includes('999'));
});

test('com finance: engine inclui valor, mas top-N do tool segue sem valor', async () => {
  const supabase = makeSupabase({
    fretes: [{ id: 'f1', empresa_id: 'e1', motorista_id: null, data: '2026-08-20', origem: 'A', destino: 'B', placa: 'X', status: 'ativo', valor_frete: 500 }],
    motoristas: [],
    frete_ocorrencias: [{ frete_id: 'f1', tipo: 'avaria', status: 'aberta' }],
    frete_epod: [], frete_epod_evidencias: [], frete_ultima_localizacao: [], frete_localizacao_estado: [],
  });
  const r = await registry.executeTool(
    'operation.command_center.summary', {},
    ctx({ supabase, effectivePermissions: { 'reports.operational.view': true, 'finance.operational.view': true } }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.data.top_atencao[0].attention_code, 'OCORRENCIA_CRITICA');
  assert.equal('valor_frete' in r.data.top_atencao[0], false);
});

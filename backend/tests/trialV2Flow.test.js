const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { iniciarTrialV2SeAplicavel } = require('../services/assinaturaEletronicaInternaService');

// ── Mock do supabase para iniciarTrialV2SeAplicavel ──────────────────────────
// select empresa → maybeSingle (retorna a empresa); depois update().is().select()
// → maybeSingle (retorna a linha atualizada ou null se a corrida perdeu).
function mockEmpresa(empresa, updateReturns) {
  const calls = { updated: null };
  const api = {
    from() {
      const b = {
        select() { return b; },
        eq() { return b; },
        is() { return b; },
        update(payload) { calls.updated = payload; return b; },
        maybeSingle() {
          if (calls.updated) return Promise.resolve({ data: updateReturns, error: null });
          return Promise.resolve({ data: empresa, error: null });
        },
      };
      return b;
    },
  };
  api._calls = calls;
  return api;
}

const SNAP14 = { snapshot: { trial_dias: 14 } };

test('trial v2: assinatura completa inicia o trial uma vez (trial_ends_at ~14d)', async () => {
  const sb = mockEmpresa({ id: 'e1', commercial_flow_version: 'v2', trial_started_at: null }, { id: 'e1' });
  const r = await iniciarTrialV2SeAplicavel({ supabase: sb, empresaId: 'e1', proposta: SNAP14 });
  assert.equal(r.iniciado, true);
  assert.equal(sb._calls.updated.status, 'trial');
  assert.ok(sb._calls.updated.trial_started_at);
  const dias = (new Date(sb._calls.updated.trial_ends_at) - new Date(sb._calls.updated.trial_started_at)) / 864e5;
  assert.ok(Math.abs(dias - 14) < 0.01, `esperava ~14 dias, veio ${dias}`);
});

test('trial v2: idempotente — trial_started_at já setado não reinicia (retry)', async () => {
  const sb = mockEmpresa({ id: 'e1', commercial_flow_version: 'v2', trial_started_at: '2026-08-01T00:00:00Z' }, { id: 'e1' });
  const r = await iniciarTrialV2SeAplicavel({ supabase: sb, empresaId: 'e1', proposta: SNAP14 });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'ja_iniciado');
  assert.equal(sb._calls.updated, null); // nao tocou o banco
});

test('trial v2: conta legada (nao-v2) nao inicia trial aqui', async () => {
  const sb = mockEmpresa({ id: 'e1', commercial_flow_version: null, trial_started_at: null }, { id: 'e1' });
  const r = await iniciarTrialV2SeAplicavel({ supabase: sb, empresaId: 'e1', proposta: SNAP14 });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'nao_v2');
});

test('trial v2: corrida (update volta null) nao conta como iniciado', async () => {
  const sb = mockEmpresa({ id: 'e1', commercial_flow_version: 'v2', trial_started_at: null }, null);
  const r = await iniciarTrialV2SeAplicavel({ supabase: sb, empresaId: 'e1', proposta: SNAP14 });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'corrida_ja_iniciado');
});

// ── empresaService: criação v2 não inicia trial; legada mantém ───────────────
function mockCriar(dias) {
  const state = { inserted: null };
  const api = {
    from(t) {
      const b = {
        select() { return b; },
        eq() { return b; },
        insert(payload) { state.inserted = payload; return b; },
        update() { return b; },
        maybeSingle() {
          if (t === 'planos') return Promise.resolve({ data: { id: 'plano-1', dias_trial: dias }, error: null });
          return Promise.resolve({ data: null, error: null }); // empresas: codigo único
        },
        single() { return Promise.resolve({ data: { id: 'emp-1', ...state.inserted }, error: null }); },
      };
      return b;
    },
  };
  api._state = state;
  return api;
}

function carregarEmpresaService(sb) {
  const p = require.resolve('../services/empresaService');
  const originalLoad = Module._load;
  delete require.cache[p];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return sb;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(p);
  } finally {
    Module._load = originalLoad;
    delete require.cache[p];
  }
}

test('empresaService v2: NÃO inicia trial na criação + marca commercial_flow_version', async () => {
  const sb = mockCriar(14);
  const { criarEmpresaCompleta } = carregarEmpresaService(sb);
  const r = await criarEmpresaCompleta({ nome: 'Nova', plano_id: 'plano-1', commercialFlowV2: true });
  assert.ok(!r.error, r.error || '');
  assert.equal(sb._state.inserted.commercial_flow_version, 'v2');
  assert.equal(sb._state.inserted.trial_started_at, null);
  assert.equal(sb._state.inserted.trial_ends_at, null);
  assert.equal(sb._state.inserted.status, 'trial');
});

test('empresaService legado: mantém trial iniciado na criação (sem commercial_flow_version)', async () => {
  const sb = mockCriar(14);
  const { criarEmpresaCompleta } = carregarEmpresaService(sb);
  const r = await criarEmpresaCompleta({ nome: 'Antiga', plano_id: 'plano-1' });
  assert.ok(!r.error, r.error || '');
  assert.ok(sb._state.inserted.trial_started_at, 'legado deve iniciar trial');
  assert.ok(sb._state.inserted.trial_ends_at);
  assert.equal(sb._state.inserted.commercial_flow_version, undefined);
});

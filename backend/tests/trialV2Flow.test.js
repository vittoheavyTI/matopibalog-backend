const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { iniciarTrialV2PorAceiteTermos } = require('../services/trialV2Service');

function usuario(over = {}) {
  return { uid: 'u-admin', empresa_id: 'e1', role: 'admin', tipo: 'admin', is_super_admin: false, ...over };
}

function mockTrial({ empresa, plano = { id: 'plano-1', dias_trial: 14, ativo: true }, planoError = null, updateReturns = { id: 'e1' } } = {}) {
  const calls = { updated: null };
  const api = {
    from(tabela) {
      const b = {
        select() { return b; },
        eq() { return b; },
        is() { return b; },
        update(payload) { calls.updated = payload; return b; },
        maybeSingle() {
          if (calls.updated) return Promise.resolve({ data: updateReturns, error: null });
          if (tabela === 'empresas') return Promise.resolve({ data: empresa, error: null });
          if (tabela === 'planos') return Promise.resolve({ data: plano, error: planoError });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
  api._calls = calls;
  return api;
}

test('trial v2: aceite completo de termos inicia o trial uma vez pelo plano', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    plano: { id: 'plano-1', dias_trial: 14, ativo: true },
  });
  const agora = new Date('2026-08-15T12:00:00.000Z');
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario(), agora });
  assert.equal(r.iniciado, true);
  assert.equal(r.motivo, 'ok');
  assert.equal(sb._calls.updated.status, 'trial');
  assert.equal(sb._calls.updated.trial_started_at, agora.toISOString());
  assert.equal(sb._calls.updated.trial_ends_at, '2026-08-29T12:00:00.000Z');
});

test('trial v2: idempotente, retry/login posterior nao reinicia nem estende', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: '2026-08-01T00:00:00.000Z', plano_id: 'plano-1' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario(), agora: new Date('2026-08-15T00:00:00.000Z') });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'ja_iniciado');
  assert.equal(sb._calls.updated, null);
});

test('trial v2: conta legada nao passa pelo marco de termos v2', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: null, trial_started_at: null, plano_id: 'plano-1' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario() });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'nao_v2');
});

test('trial v2: corrida de update nao duplica inicio', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    updateReturns: null,
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario() });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'corrida_ja_iniciado');
});

test('trial v2: erro na leitura do plano nao grava datas nem consome beneficio', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    planoError: { message: 'db down' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario() });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'plano_indisponivel');
  assert.equal(sb._calls.updated, null);
});

test('trial v2: plano ausente falha fechado e nao grava datas', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    plano: null,
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario() });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'plano_indisponivel');
  assert.equal(sb._calls.updated, null);
});

test('trial v2: dias_trial invalido falha fechado e nao grava datas', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    plano: { id: 'plano-1', dias_trial: 'x', ativo: true },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario() });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'trial_config_indisponivel');
  assert.equal(sb._calls.updated, null);
});

test('trial v2: dias_trial zero configurado em plano existente e ativo e valido', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
    plano: { id: 'plano-1', dias_trial: 0, ativo: true },
  });
  const agora = new Date('2026-08-15T12:00:00.000Z');
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario(), agora });
  assert.equal(r.iniciado, true);
  assert.equal(r.trial_dias, 0);
  assert.equal(sb._calls.updated.trial_started_at, sb._calls.updated.trial_ends_at);
});

test('trial v2: motorista de empresa nao inicia relogio comercial', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', tipo: 'transportadora', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario({ role: 'motorista', tipo: 'motorista' }) });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'usuario_sem_autoridade');
  assert.equal(sb._calls.updated, null);
});

test('trial v2: proprietario autonomo inicia relogio comercial', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', tipo: 'autonomo', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario({ role: 'motorista', tipo: 'motorista' }) });
  assert.equal(r.iniciado, true);
});

test('trial v2: super-admin nao inicia trial do cliente navegando', async () => {
  const sb = mockTrial({
    empresa: { id: 'e1', tipo: 'transportadora', commercial_flow_version: 'v2', trial_started_at: null, plano_id: 'plano-1' },
  });
  const r = await iniciarTrialV2PorAceiteTermos({ supabase: sb, empresaId: 'e1', usuario: usuario({ is_super_admin: true }) });
  assert.equal(r.iniciado, false);
  assert.equal(r.motivo, 'usuario_sem_autoridade');
  assert.equal(sb._calls.updated, null);
});

function mockCriar(dias) {
  const state = { inserted: null };
  const api = {
    from(t) {
      const b = {
        select() { return b; },
        eq() { return b; },
        insert(payload) { state.inserted = payload; return b; },
        update() { return b; },
        delete() { return b; },
        maybeSingle() {
          if (t === 'planos') return Promise.resolve({ data: { id: 'plano-1', dias_trial: dias }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        single() { return Promise.resolve({ data: { id: 'emp-1', ...state.inserted }, error: null }); },
      };
      return b;
    },
    // P2.9 — provisionamento atômico de templates (RPC). Sucesso por padrão.
    async rpc() { return { data: null, error: null }; },
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

test('empresaService v2: nao inicia trial na criacao + marca commercial_flow_version', async () => {
  const sb = mockCriar(14);
  const { criarEmpresaCompleta } = carregarEmpresaService(sb);
  const r = await criarEmpresaCompleta({ nome: 'Nova', plano_id: 'plano-1', commercialFlowV2: true });
  assert.ok(!r.error, r.error || '');
  assert.equal(sb._state.inserted.commercial_flow_version, 'v2');
  assert.equal(sb._state.inserted.trial_started_at, null);
  assert.equal(sb._state.inserted.trial_ends_at, null);
  assert.equal(sb._state.inserted.status, 'trial');
});

test('empresaService legado: mantem trial iniciado na criacao', async () => {
  const sb = mockCriar(14);
  const { criarEmpresaCompleta } = carregarEmpresaService(sb);
  const r = await criarEmpresaCompleta({ nome: 'Antiga', plano_id: 'plano-1' });
  assert.ok(!r.error, r.error || '');
  assert.ok(sb._state.inserted.trial_started_at, 'legado deve iniciar trial');
  assert.ok(sb._state.inserted.trial_ends_at);
  assert.equal(sb._state.inserted.commercial_flow_version, undefined);
});

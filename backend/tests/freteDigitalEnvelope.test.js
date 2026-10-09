'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const {
  finalizarFreteComEnvelope,
  normalizarErroEnvelope,
} = require('../services/freteDigitalEnvelopeService');

const controllerPath = require.resolve('../controllers/fretesController');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

test('freteDigitalEnvelopeService: normalizarErroEnvelope maps expected error strings', () => {
  assert.equal(normalizarErroEnvelope(new Error('E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE')), 'E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE');
  assert.equal(normalizarErroEnvelope(new Error('E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE')), 'E38_LEGACY_FINALIZED_WITHOUT_FORMAL_ENVELOPE');
  assert.equal(normalizarErroEnvelope(new Error('e38_frete_envelope_frete_not_found')), 'e38_frete_envelope_frete_not_found');
  assert.equal(normalizarErroEnvelope(new Error('e38_frete_envelope_status_locked')), 'e38_frete_envelope_status_locked');
  assert.equal(normalizarErroEnvelope(new Error('e38_frete_envelope_request_id_conflict')), 'e38_frete_envelope_request_id_conflict');
  assert.equal(normalizarErroEnvelope(new Error('e38_frete_envelope_patch_field_not_allowed:x')), 'e38_frete_envelope_patch_field_not_allowed');
  assert.equal(normalizarErroEnvelope(new Error('random_error')), null);
});

test('hash canonicalization: determinism and tamper detection', () => {
  const payload1 = {
    schema_version: 'e38.freight_closure.v1',
    envelope_type: 'formal_freight_closure',
    empresa_id: 'e1',
    frete_id: 'f1',
    frete_snapshot: { id: 'f1', status: 'finalizado', valor_frete: 1500 },
    financial_snapshot: { valor_frete: 1500 },
  };

  const hash1 = sha256(JSON.stringify(payload1));
  assert.equal(hash1.length, 64);

  // Same payload -> same hash
  const hash2 = sha256(JSON.stringify(payload1));
  assert.equal(hash1, hash2);

  // Modified field -> different hash
  const payloadModified = {
    ...payload1,
    frete_snapshot: { ...payload1.frete_snapshot, valor_frete: 1501 },
  };
  const hashModified = sha256(JSON.stringify(payloadModified));
  assert.notEqual(hash1, hashModified);
});

function criarMockSupabase({ frete, envelope = null, auditEvents = [], onRpc = null } = {}) {
  const builder = (tabela) => {
    const b = {
      _tabela: tabela,
      select() { return b; },
      eq(col, val) { return b; },
      maybeSingle() {
        if (tabela === 'frete_envelopes_digitais') return Promise.resolve({ data: envelope, error: null });
        if (tabela === 'motoristas') return Promise.resolve({ data: { percentual_comissao: 10 }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (tabela === 'fretes') return Promise.resolve({ data: frete, error: null });
        if (tabela === 'motoristas') return Promise.resolve({ data: { percentual_comissao: 10, empresas: { tipo: 'transportadora' } }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve) { resolve({ count: 0, error: null }); },
    };
    return b;
  };

  return {
    from(t) { return builder(t); },
    rpc(nome, params) {
      if (onRpc) onRpc(nome, params);
      if (nome === 'listar_auditoria_unificada') {
        return Promise.resolve({ data: auditEvents, error: null });
      }
      if (nome === 'e38_finalize_frete_with_envelope') {
        return Promise.resolve({
          data: {
            idempotent: false,
            frete: { ...frete, status: 'finalizado', ...(params.p_patch || {}) },
            envelope: {
              id: 'env-test-1',
              frete_id: params.p_frete_id,
              empresa_id: params.p_empresa_id,
              envelope_hash: 'a'.repeat(64),
              payload: { schema_version: 'e38.freight_closure.v1', envelope_hash: 'a'.repeat(64) },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function carregarController(supabaseMock, { effective = { permissions: { 'finance.operational.view': true } } } = {}) {
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return { notificarViagemFinalizada: async () => null };
      if (request === '../middlewares/requirePermission') {
        return {
          requirePermission: () => (req, res, next) => next(),
          ensureEffective: async () => effective,
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

const sampleEnvelope = {
  id: 'env-1',
  frete_id: 'f-1',
  empresa_id: 'e-1',
  envelope_type: 'formal_freight_closure',
  schema_version: 'e38.freight_closure.v1',
  envelope_hash: 'b'.repeat(64),
  frete_snapshot: {
    id: 'f-1',
    status: 'finalizado',
    valor_frete: 5000,
    valor_tonelada_km: 0.15,
    toneladas: 50,
    modalidade_calculo: 'tonelada_km',
    origem: 'LEM',
    destino: 'Salvador',
  },
  financial_snapshot: {
    valor_frete: 5000,
    valor_tonelada_km: 0.15,
    toneladas: 50,
    modalidade_calculo: 'tonelada_km',
  },
  payload: {
    frete_snapshot: {
      id: 'f-1',
      status: 'finalizado',
      valor_frete: 5000,
      valor_tonelada_km: 0.15,
      toneladas: 50,
      modalidade_calculo: 'tonelada_km',
    },
    financial_snapshot: {
      valor_frete: 5000,
      valor_tonelada_km: 0.15,
      toneladas: 50,
    },
  },
};

test('getEnvelopeDigital: super-admin receives full unredacted envelope', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, { effective: { permissions: {} } });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-super', role: 'admin', tipo: 'admin', is_super_admin: true },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, 5000);
  assert.equal(bodyRes.envelope.financial_snapshot.valor_frete, 5000);
  assert.equal(bodyRes.envelope.payload.frete_snapshot.valor_frete, 5000);
  assert.equal(bodyRes.envelope.payload.financial_snapshot.valor_frete, 5000);
});

test('getEnvelopeDigital: admin with finance.operational.view receives full unredacted envelope', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-admin', role: 'admin', tipo: 'admin' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, 5000);
  assert.equal(bodyRes.envelope.financial_snapshot.valor_frete, 5000);
});

test('getEnvelopeDigital: operador with freight.view and NO finance permission has financial fields redacted', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.view': true, 'finance.operational.view': false } },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-op', role: 'operador', tipo: 'operador' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');

  // Operational fields preserved
  assert.equal(bodyRes.envelope.frete_snapshot.id, 'f-1');
  assert.equal(bodyRes.envelope.frete_snapshot.origem, 'LEM');
  assert.equal(bodyRes.envelope.frete_snapshot.destino, 'Salvador');

  // Top-level financial fields redacted
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, undefined);
  assert.equal(bodyRes.envelope.frete_snapshot.valor_tonelada_km, undefined);
  assert.equal(bodyRes.envelope.frete_snapshot.toneladas, undefined);
  assert.equal(bodyRes.envelope.frete_snapshot.modalidade_calculo, undefined);
  assert.deepEqual(bodyRes.envelope.financial_snapshot, {});

  // Nested payload financial fields redacted (no backdoor leak)
  assert.equal(bodyRes.envelope.payload.frete_snapshot.valor_frete, undefined);
  assert.equal(bodyRes.envelope.payload.frete_snapshot.valor_tonelada_km, undefined);
  assert.deepEqual(bodyRes.envelope.payload.financial_snapshot, {});
});

test('getEnvelopeDigital: gerente with freight.view and NO finance permission has financial fields redacted', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.view': true, 'finance.operational.view': false } },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-gerente', role: 'gerente', tipo: 'gerente' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, undefined);
  assert.deepEqual(bodyRes.envelope.financial_snapshot, {});
  assert.deepEqual(bodyRes.envelope.payload.financial_snapshot, {});
});

test('getEnvelopeDigital: returns LEGACY_NO_FORMAL_ENVELOPE for finalized frete without envelope', async () => {
  const frete = { id: 'f-legacy', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: null });
  const controller = carregarController(supabaseMock);

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-legacy' },
    empresa_id: 'e-1',
    user: { uid: 'u-admin', role: 'admin', tipo: 'admin' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'LEGACY_NO_FORMAL_ENVELOPE');
  assert.equal(bodyRes.envelope, null);
});

test('getEnvelopeDigital: returns NO_FORMAL_ENVELOPE_YET for active frete without envelope', async () => {
  const frete = { id: 'f-active', empresa_id: 'e-1', motorista_id: 'm-1', status: 'ativo' };
  const supabaseMock = criarMockSupabase({ frete, envelope: null });
  const controller = carregarController(supabaseMock);

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-active' },
    empresa_id: 'e-1',
    user: { uid: 'u-admin', role: 'admin', tipo: 'admin' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'NO_FORMAL_ENVELOPE_YET');
  assert.equal(bodyRes.envelope, null);
});

test('getEnvelopeDigital: applies driver financial redaction for motorista (commission_only)', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-driver', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: {}, driverFinancialVisibility: 'commission_only' },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'm-driver', role: 'motorista', tipo: 'motorista' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');
  // Driver under commission_only should not see raw gross valor_frete or valor_tonelada_km
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, undefined);
  assert.equal(bodyRes.envelope.frete_snapshot.valor_tonelada_km, undefined);
  assert.equal(bodyRes.envelope.frete_snapshot.comissao_percentual, 10);
  assert.equal(bodyRes.envelope.frete_snapshot.comissao_valor, 500);
});

test('getEnvelopeDigital: motorista with full_freight_financial receives full data where authorized', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-driver', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: sampleEnvelope });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: {}, driverFinancialVisibility: 'full_freight_financial' },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'm-driver', role: 'motorista', tipo: 'motorista' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getEnvelopeDigital(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.status, 'FORMAL_ENVELOPE_SEALED');
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, 5000);
  assert.equal(bodyRes.envelope.frete_snapshot.valor_tonelada_km, 0.15);
});

test('getAuditoriaUnificadaFrete: passes entity filter to SQL RPC before limit and returns timeline', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const auditEvents = [
    { event_id: 'frete_envelopes_digitais:env-1', entity_id: 'f-1', source_kind: 'frete_envelopes_digitais', action: 'sealed' },
    { event_id: 'lancamento_eventos:le-1', entity_id: 'f-1', source_kind: 'lancamento_eventos', metadata: { frete_id: 'f-1' } },
  ];

  let rpcParamsCaptured = null;
  const supabaseMock = criarMockSupabase({
    frete,
    auditEvents,
    onRpc: (nome, params) => {
      if (nome === 'listar_auditoria_unificada') rpcParamsCaptured = params;
    },
  });
  const controller = carregarController(supabaseMock);

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    query: { limit: '50', before_occurred_at: '2026-10-08T20:00:00Z', before_event_id: 'ev-99' },
    empresa_id: 'e-1',
    user: { uid: 'u-admin', role: 'admin', tipo: 'admin' },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getAuditoriaUnificadaFrete(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.frete_id, 'f-1');
  assert.equal(bodyRes.eventos.length, 2);
  assert.deepEqual(rpcParamsCaptured, {
    p_empresa_id: 'e-1',
    p_limit: 50,
    p_before_occurred_at: '2026-10-08T20:00:00Z',
    p_before_event_id: 'ev-99',
    p_entity_type: 'frete',
    p_entity_id: 'f-1',
  });
});

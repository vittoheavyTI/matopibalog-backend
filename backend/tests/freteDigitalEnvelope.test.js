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

function criarMockSupabase({ frete, envelope = null, auditEvents = [] } = {}) {
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

function carregarController(supabaseMock) {
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return { notificarViagemFinalizada: async () => null };
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('getEnvelopeDigital: returns FORMAL_ENVELOPE_SEALED when envelope exists for admin', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const envelope = {
    id: 'env-1',
    frete_id: 'f-1',
    empresa_id: 'e-1',
    envelope_type: 'formal_freight_closure',
    schema_version: 'e38.freight_closure.v1',
    envelope_hash: 'b'.repeat(64),
    frete_snapshot: { id: 'f-1', status: 'finalizado', valor_frete: 2000 },
    financial_snapshot: { valor_frete: 2000 },
    payload: {
      frete_snapshot: { id: 'f-1', status: 'finalizado', valor_frete: 2000 },
      financial_snapshot: { valor_frete: 2000 },
    },
  };

  const supabaseMock = criarMockSupabase({ frete, envelope });
  const controller = carregarController(supabaseMock);

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
  assert.equal(bodyRes.envelope.id, 'env-1');
  assert.equal(bodyRes.envelope.envelope_hash, 'b'.repeat(64));
  assert.equal(bodyRes.envelope.frete_snapshot.valor_frete, 2000);
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

test('getEnvelopeDigital: applies driver financial redaction for motorista caller', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-driver', status: 'finalizado' };
  const envelope = {
    id: 'env-1',
    frete_id: 'f-1',
    empresa_id: 'e-1',
    envelope_type: 'formal_freight_closure',
    schema_version: 'e38.freight_closure.v1',
    envelope_hash: 'c'.repeat(64),
    frete_snapshot: { id: 'f-1', status: 'finalizado', valor_frete: 5000, valor_tonelada_km: 0.15, toneladas: 50 },
    financial_snapshot: { valor_frete: 5000, valor_tonelada_km: 0.15, toneladas: 50 },
    payload: {
      frete_snapshot: { id: 'f-1', status: 'finalizado', valor_frete: 5000 },
      financial_snapshot: { valor_frete: 5000 },
    },
  };

  const supabaseMock = criarMockSupabase({ frete, envelope });
  const controller = carregarController(supabaseMock);

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

test('getAuditoriaUnificadaFrete: returns filtered audit events', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const auditEvents = [
    { event_id: 'ev-1', entity_id: 'f-1', source_kind: 'frete_envelopes_digitais', action: 'sealed' },
    { event_id: 'ev-2', entity_id: 'f-2', source_kind: 'lancamento_eventos', metadata: { frete_id: 'f-1' } },
    { event_id: 'ev-3', entity_id: 'other', source_kind: 'other', metadata: {} },
  ];

  const supabaseMock = criarMockSupabase({ frete, auditEvents });
  const controller = carregarController(supabaseMock);

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    query: { limit: '50' },
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
  assert.equal(bodyRes.eventos[0].event_id, 'ev-1');
  assert.equal(bodyRes.eventos[1].event_id, 'ev-2');
});

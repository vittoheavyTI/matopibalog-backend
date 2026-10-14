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

function criarMockSupabase({ frete, envelope = null, auditEvents = [], onRpc = null, despesas = [], abastecimentos = [], vales = [], documentos = [], epod = null } = {}) {
  const builder = (tabela) => {
    const b = {
      _tabela: tabela,
      select() { return b; },
      eq(col, val) { return b; },
      maybeSingle() {
        if (tabela === 'frete_envelopes_digitais') return Promise.resolve({ data: envelope, error: null });
        if (tabela === 'motoristas') return Promise.resolve({ data: { placa_veiculo: 'ABC-1234', percentual_comissao: 10, usuarios: { nome: 'João Motorista' }, empresas: { tipo: 'transportadora' } }, error: null });
        if (tabela === 'frete_epod') return Promise.resolve({ data: epod, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (tabela === 'fretes') {
          return Promise.resolve({
            data: {
              ...frete,
              motoristas: { placa_veiculo: 'ABC-1234', percentual_comissao: 10, usuarios: { nome: 'João Motorista' }, empresas: { tipo: 'transportadora' } },
            },
            error: null,
          });
        }
        if (tabela === 'motoristas') return Promise.resolve({ data: { placa_veiculo: 'ABC-1234', percentual_comissao: 10, usuarios: { nome: 'João Motorista' }, empresas: { tipo: 'transportadora' } }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve) {
        if (tabela === 'despesas') resolve({ data: despesas, error: null });
        else if (tabela === 'abastecimentos') resolve({ data: abastecimentos, error: null });
        else if (tabela === 'vales') resolve({ data: vales, error: null });
        else if (tabela === 'frete_documentos') resolve({ data: documentos, error: null });
        else resolve({ count: 0, error: null });
      },
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

function carregarController(supabaseMock, { effective = { permissions: { 'finance.operational.view': true } }, ensureEffectiveError = null } = {}) {
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return { notificarViagemFinalizada: async () => null };
      if (request === '../middlewares/requirePermission') {
        return {
          requirePermission: () => (req, res, next) => next(),
          ensureEffective: async () => {
            if (ensureEffectiveError) throw ensureEffectiveError;
            return effective;
          },
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

test('PATCH /fretes/:id finalization: requires freight.finish permission when setting status=finalizado', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'ativo', km_inicial: 100, km_final: 200, valor_frete: 1000 };
  const supabaseMock = criarMockSupabase({ frete });

  // 1) Caller with freight.manage=true BUT freight.finish=false -> 403
  const controllerNoFinish = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.manage': true, 'freight.finish': false } },
  });

  let statusRes = 0;
  let bodyRes = null;
  const reqDeny = {
    params: { id: 'f-1' },
    body: { status: 'finalizado', km_final: 250 },
    empresa_id: 'e-1',
    user: { uid: 'u-admin-no-finish', role: 'admin', tipo: 'admin', is_super_admin: false },
  };
  const resDeny = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controllerNoFinish.update(reqDeny, resDeny);
  assert.equal(statusRes, 403);
  assert.equal(bodyRes.permission, 'freight.finish');

  // 2) Caller with freight.manage=true AND freight.finish=true -> 200 (seals envelope)
  const controllerAllow = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.manage': true, 'freight.finish': true } },
  });

  let statusResAllow = 0;
  let bodyResAllow = null;
  const reqAllow = {
    params: { id: 'f-1' },
    body: { status: 'finalizado', km_final: 250 },
    empresa_id: 'e-1',
    user: { uid: 'u-admin-finish', role: 'admin', tipo: 'admin', is_super_admin: false },
  };
  const resAllow = {
    status(s) { statusResAllow = s; return { json(b) { bodyResAllow = b; } }; },
  };

  await controllerAllow.update(reqAllow, resAllow);
  assert.equal(statusResAllow, 200);
  assert.equal(bodyResAllow.status, 'finalizado');

  // 3) Super admin without explicit permission -> 200 (authority preserved)
  const controllerSuper = carregarController(supabaseMock, {
    effective: { permissions: {}, isSuperAdmin: true },
  });

  let statusResSuper = 0;
  let bodyResSuper = null;
  const reqSuper = {
    params: { id: 'f-1' },
    body: { status: 'finalizado', km_final: 250 },
    empresa_id: 'e-1',
    user: { uid: 'u-super', role: 'admin', tipo: 'admin', is_super_admin: true },
  };
  const resSuper = {
    status(s) { statusResSuper = s; return { json(b) { bodyResSuper = b; } }; },
  };

  await controllerSuper.update(reqSuper, resSuper);
  assert.equal(statusResSuper, 200);
});

test('getAuditoriaUnificadaFrete: redacts domain fields when caller lacks specific domain permissions', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const auditEvents = [
    {
      event_id: 'lancamento_eventos:le-1',
      entity_id: 'f-1',
      source_kind: 'lancamento_eventos',
      metadata: { frete_id: 'f-1', valor: 450, cost: 450, from_status: 'pendente', to_status: 'approved' },
    },
    {
      event_id: 'frete_documento_eventos:fde-1',
      entity_id: 'f-1',
      source_kind: 'frete_documento_eventos',
      metadata: { frete_id: 'f-1', storage_path: 'secret/path.pdf', signed_url: 'https://secret.url' },
    },
    {
      event_id: 'maintenance_events:me-1',
      entity_id: 'f-1',
      source_kind: 'maintenance_events',
      metadata: { status: 'completed', cost: 1200, supplier: 'Auto Peças X', parts: ['filtro'] },
    },
  ];

  const supabaseMock = criarMockSupabase({ frete, auditEvents });

  // Caller with only freight.view (no finance, documents, or fleet view)
  const controller = carregarController(supabaseMock, {
    effective: {
      permissions: {
        'freight.view': true,
        'finance.operational.view': false,
        'documents.view': false,
        'fleet.view': false,
      },
    },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    query: {},
    empresa_id: 'e-1',
    user: { uid: 'u-viewer', role: 'operador', tipo: 'operador', is_super_admin: false },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getAuditoriaUnificadaFrete(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.eventos.length, 3);

  // Event 1: Financial values redacted
  assert.equal(bodyRes.eventos[0].metadata.valor, undefined);
  assert.equal(bodyRes.eventos[0].metadata.cost, undefined);
  assert.equal(bodyRes.eventos[0].metadata.from_status, 'pendente');
  assert.equal(bodyRes.eventos[0].metadata.to_status, 'approved');

  // Event 2: Document storage paths redacted
  assert.equal(bodyRes.eventos[1].metadata.storage_path, undefined);
  assert.equal(bodyRes.eventos[1].metadata.signed_url, undefined);
  assert.equal(bodyRes.eventos[1].metadata.frete_id, 'f-1');

  // Event 3: Fleet cost and supplier details redacted
  assert.equal(bodyRes.eventos[2].metadata.cost, undefined);
  assert.equal(bodyRes.eventos[2].metadata.supplier, undefined);
  assert.equal(bodyRes.eventos[2].metadata.parts, undefined);
  assert.equal(bodyRes.eventos[2].metadata.status, 'completed');
});

test('getEnvelopeDigital: returns envelope_hash, motorista_nome and placa in response', async () => {
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
  assert.equal(bodyRes.envelope.envelope_hash, 'b'.repeat(64));
  assert.equal(bodyRes.motorista_nome, 'João Motorista');
  assert.equal(bodyRes.placa, 'ABC-1234');
});

test('getRelatorioFechamento: admin with finance.operational.view and documents.view gets full operational closure report', async () => {
  const frete = {
    id: 'f-1',
    empresa_id: 'e-1',
    motorista_id: 'm-1',
    status: 'finalizado',
    data: '2026-10-10',
    origem: 'LEM',
    destino: 'Salvador',
    km_inicial: 1000,
    km_final: 1800,
    modalidade_calculo: 'tonelada_km',
    toneladas: 40,
    valor_tonelada_km: 0.15,
    valor_frete: 4800,
    quem_recebeu: 'proprietario',
    foto_odometro_inicial_path: 'path/inicial.jpg',
    foto_odometro_final_path: 'path/final.jpg',
  };
  const despesas = [
    { id: 'd-1', descricao: 'Pedágio', tipo: 'pedagio', valor: 200, status: 'aprovado', quem_pagou: 'proprietario' },
    { id: 'd-2', descricao: 'Alimentação', tipo: 'refeicao', valor: 100, status: 'aprovado', quem_pagou: 'motorista' },
  ];
  const abastecimentos = [
    { id: 'a-1', posto: 'Posto Estrela', litros: 300, arla_litros: 20, arla_valor: 60, valor_total: 1800, status: 'aprovado', quem_pagou: 'proprietario' },
  ];
  const vales = [
    { id: 'v-1', descricao: 'Adiantamento', valor: 300, status: 'aprovado', quem_pagou: 'proprietario' },
  ];
  const documentos = [
    { id: 'doc-1', tipo: 'cte', status: 'ativo' },
  ];
  const epod = {
    id: 'epod-1',
    status: 'aprovado',
    entregue_em: '2026-10-12T14:00:00Z',
    recebedor_nome: 'Carlos Recebedor',
  };

  const supabaseMock = criarMockSupabase({
    frete,
    envelope: sampleEnvelope,
    despesas,
    abastecimentos,
    vales,
    documentos,
    epod,
  });

  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true, 'documents.view': true } },
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

  await controller.getRelatorioFechamento(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.frete.id, 'f-1');
  assert.equal(bodyRes.frete.distancia_km, 800);
  assert.equal(bodyRes.frete.valor_frete, 4800);
  assert.equal(bodyRes.motorista.nome, 'João Motorista');
  assert.equal(bodyRes.motorista.placa, 'ABC-1234');
  assert.equal(bodyRes.envelope.status, 'FORMAL_ENVELOPE_SEALED');
  assert.equal(bodyRes.envelope.detalhes.envelope_hash, 'b'.repeat(64));
  assert.equal(bodyRes.documentos_fiscais.total, 1);
  assert.equal(bodyRes.epod.recebedor_nome, 'Carlos Recebedor');

  // Canonical calculations check (calcularRentabilidadeFrete + calcularAcertoMotoristas):
  // frete_bruto / receita = 4800
  // custos_diretos = combustivel (1800) + pedagio (200) + refeicao (100) + comissao 10% (480) = 2580
  // resultado_operacional = 4800 - 2580 = 2220
  // saldo_motorista = comissao (480) + gastos_motorista (100) - vales (300) = 280
  assert.equal(bodyRes.resumo_financeiro.frete_bruto, 4800);
  assert.equal(bodyRes.resumo_financeiro.receita_realizada, 4800);
  assert.equal(bodyRes.resumo_financeiro.comissao_valor, 480);
  assert.equal(bodyRes.resumo_financeiro.saldo_motorista, 280);
  assert.equal(bodyRes.resumo_financeiro.resultado_operacional, 2220);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 300);
  assert.equal(bodyRes.resumo_financeiro.total_abastecimentos_efetivados, 1800);
  assert.equal(bodyRes.resumo_financeiro.total_vales_efetivados, 300);
});

test('A — approved and finalized launches compose realized financial totals', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 3000 };
  const despesas = [
    { id: 'd-aprov', descricao: 'Aprovado', tipo: 'pedagio', valor: 150, status: 'aprovado', quem_pagou: 'proprietario' },
    { id: 'd-fin', descricao: 'Finalizado', tipo: 'manutencao', valor: 250, status: 'finalizado', quem_pagou: 'proprietario' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let bodyRes = null;
  const req = { params: { id: 'f-1' }, empresa_id: 'e-1', user: { uid: 'u-1', role: 'admin', tipo: 'admin' } };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 400);
  assert.equal(bodyRes.lancamentos.despesas[0].efetivado, true);
  assert.equal(bodyRes.lancamentos.despesas[1].efetivado, true);
});

test('B — pending launch does NOT compose realized totals and is flagged informatively', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 3000 };
  const despesas = [
    { id: 'd-aprov', descricao: 'Aprovada', tipo: 'pedagio', valor: 100, status: 'aprovado', quem_pagou: 'proprietario' },
    { id: 'd-pend', descricao: 'Pendente', tipo: 'hospedagem', valor: 500, status: 'pendente', quem_pagou: 'proprietario' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let bodyRes = null;
  const req = { params: { id: 'f-1' }, empresa_id: 'e-1', user: { uid: 'u-1', role: 'admin', tipo: 'admin' } };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);
  // Realized total has only 100
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 100);
  // Pending total flags 500
  assert.equal(bodyRes.resumo_financeiro.total_pendente, 500);
  assert.equal(bodyRes.resumo_financeiro.tem_pendentes, true);
  assert.equal(bodyRes.lancamentos.despesas[1].efetivado, false);
});

test('C — rejected launch does NOT compose realized totals', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 3000 };
  const despesas = [
    { id: 'd-rej', descricao: 'Rejeitada', tipo: 'pedagio', valor: 300, status: 'rejeitado', quem_pagou: 'proprietario' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let bodyRes = null;
  const req = { params: { id: 'f-1' }, empresa_id: 'e-1', user: { uid: 'u-1', role: 'admin', tipo: 'admin' } };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 0);
  assert.equal(bodyRes.lancamentos.despesas[0].efetivado, false);
});

test('D — cancelled launch does NOT compose realized totals', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 3000 };
  const despesas = [
    { id: 'd-canc', descricao: 'Cancelada', tipo: 'pedagio', valor: 400, status: 'cancelado', quem_pagou: 'proprietario' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let bodyRes = null;
  const req = { params: { id: 'f-1' }, empresa_id: 'e-1', user: { uid: 'u-1', role: 'admin', tipo: 'admin' } };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 0);
  assert.equal(bodyRes.lancamentos.despesas[0].efetivado, false);
});

test('E — canonical profitability parity: driver-paid effective expense still affects operational result', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 5000 };
  // Without driver expense: receita = 5000, comissao 10% = 500 -> resultado = 4500
  // With driver expense 200 (refeicao): direct cost increases by 200 -> resultado = 4300
  const despesas = [
    { id: 'd-mot', descricao: 'Refeição motorista', tipo: 'refeicao', valor: 200, status: 'aprovado', quem_pagou: 'motorista' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'finance.operational.view': true, 'freight.view': true } },
  });

  let bodyRes = null;
  const req = { params: { id: 'f-1' }, empresa_id: 'e-1', user: { uid: 'u-1', role: 'admin', tipo: 'admin' } };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);
  // Direct cost includes driver expense: 5000 - 500 (comissao) - 200 (despesa) = 4300
  assert.equal(bodyRes.resumo_financeiro.resultado_operacional, 4300);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, 200);
});

test('F — driver commission_only: no gross/base/company result/internal breakdown leak', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 5000, valor_tonelada_km: 0.20, toneladas: 30 };
  const despesas = [
    { id: 'd-prop', descricao: 'Pedágio Empresa', tipo: 'pedagio', valor: 350, status: 'aprovado', quem_pagou: 'proprietario' },
    { id: 'd-mot', descricao: 'Borracharia', tipo: 'manutencao', valor: 120, status: 'aprovado', quem_pagou: 'motorista' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: {
      permissions: { 'freight.view': true, 'launch.view': true },
      driverFinancialVisibility: 'commission_only',
    },
  });

  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'm-1', role: 'motorista', tipo: 'motorista' },
  };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);

  // Redacted from freight
  assert.equal(bodyRes.frete.valor_frete, null);
  assert.equal(bodyRes.frete.valor_tonelada_km, null);
  assert.equal(bodyRes.frete.toneladas, null);

  // Redacted from summary
  assert.equal(bodyRes.resumo_financeiro.frete_bruto, null);
  assert.equal(bodyRes.resumo_financeiro.receita_realizada, null);
  assert.equal(bodyRes.resumo_financeiro.resultado_operacional, null);
  assert.equal(bodyRes.resumo_financeiro.margem_percentual, null);
  assert.equal(bodyRes.resumo_financeiro.custos_diretos, null);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, null);

  // Driver commission and settlement remain visible
  assert.equal(bodyRes.resumo_financeiro.comissao_valor, 500);
  assert.equal(bodyRes.resumo_financeiro.comissao_percentual, 10);
  assert.equal(bodyRes.resumo_financeiro.saldo_motorista, 620); // 500 comissao + 120 reembolso

  // Individual launch values: proprietor paid is redacted; driver paid is visible
  assert.equal(bodyRes.lancamentos.despesas[0].valor, null);
  assert.equal(bodyRes.lancamentos.despesas[1].valor, 120);
});

test('G — driver commission_plus_base: base + commission allowed, full company breakdown still denied', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 5000, valor_tonelada_km: 0.20, toneladas: 30 };
  const despesas = [
    { id: 'd-prop', descricao: 'Pedágio Empresa', tipo: 'pedagio', valor: 350, status: 'aprovado', quem_pagou: 'proprietario' },
    { id: 'd-mot', descricao: 'Borracharia', tipo: 'manutencao', valor: 120, status: 'aprovado', quem_pagou: 'motorista' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: {
      permissions: { 'freight.view': true, 'launch.view': true },
      driverFinancialVisibility: 'commission_plus_base',
    },
  });

  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'm-1', role: 'motorista', tipo: 'motorista' },
  };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);

  // Base is allowed
  assert.equal(bodyRes.frete.valor_frete, 5000);
  assert.equal(bodyRes.resumo_financeiro.frete_bruto, 5000);
  assert.equal(bodyRes.resumo_financeiro.comissao_valor, 500);

  // Internal breakdown / operational result is DENIED
  assert.equal(bodyRes.resumo_financeiro.resultado_operacional, null);
  assert.equal(bodyRes.resumo_financeiro.margem_percentual, null);
  assert.equal(bodyRes.resumo_financeiro.custos_diretos, null);
  assert.equal(bodyRes.resumo_financeiro.total_despesas_efetivadas, null);
  assert.equal(bodyRes.lancamentos.despesas[0].valor, null); // proprietor expense hidden
  assert.equal(bodyRes.lancamentos.despesas[1].valor, 120); // driver expense visible
});

test('H — driver full_freight_financial: full authorized projection', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 5000, valor_tonelada_km: 0.20, toneladas: 30 };
  const despesas = [
    { id: 'd-prop', descricao: 'Pedágio Empresa', tipo: 'pedagio', valor: 350, status: 'aprovado', quem_pagou: 'proprietario' },
  ];
  const supabaseMock = criarMockSupabase({ frete, despesas });
  const controller = carregarController(supabaseMock, {
    effective: {
      permissions: { 'freight.view': true, 'launch.view': true, 'finance.operational.view': true },
      driverFinancialVisibility: 'full_freight_financial',
    },
  });

  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'm-1', role: 'motorista', tipo: 'motorista' },
  };
  const res = { status: () => ({ json: (b) => { bodyRes = b; } }) };

  await controller.getRelatorioFechamento(req, res);

  assert.equal(bodyRes.frete.valor_frete, 5000);
  assert.equal(bodyRes.resumo_financeiro.frete_bruto, 5000);
  assert.equal(bodyRes.resumo_financeiro.resultado_operacional, 4150); // 5000 - 500 (comissao) - 350 (pedagio)
  assert.equal(bodyRes.lancamentos.despesas[0].valor, 350);
});

test('I — effective-permission lookup failure: financial output fails closed', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado', valor_frete: 5000 };
  const supabaseMock = criarMockSupabase({ frete });
  const controller = carregarController(supabaseMock, {
    ensureEffectiveError: new Error('Permission service temporarily unavailable'),
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-op', role: 'operador', tipo: 'operador' },
  };
  const res = { status: (s) => { statusRes = s; return { json: (b) => { bodyRes = b; } }; } };

  await controller.getRelatorioFechamento(req, res);

  assert.equal(statusRes, 200);
  // Fails closed to minimum projection: no financial visibility
  assert.equal(bodyRes.frete.valor_frete, null);
  assert.equal(bodyRes.resumo_financeiro.restricted, true);
  assert.equal(bodyRes.documentos_fiscais.restricted, true);
});

test('getRelatorioFechamento: operador without finance view has financial fields redacted', async () => {
  const frete = {
    id: 'f-1',
    empresa_id: 'e-1',
    motorista_id: 'm-1',
    status: 'finalizado',
    valor_frete: 4800,
    km_inicial: 1000,
    km_final: 1800,
  };
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

  await controller.getRelatorioFechamento(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.frete.id, 'f-1');
  assert.equal(bodyRes.frete.distancia_km, 800);
  assert.equal(bodyRes.frete.valor_frete, null);
  assert.equal(bodyRes.resumo_financeiro.restricted, true);
});

test('getRelatorioFechamento: legacy finalized frete returns LEGACY_NO_FORMAL_ENVELOPE', async () => {
  const frete = { id: 'f-legacy', empresa_id: 'e-1', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete, envelope: null });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.view': true, 'finance.operational.view': true } },
  });

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

  await controller.getRelatorioFechamento(req, res);
  assert.equal(statusRes, 200);
  assert.equal(bodyRes.envelope.status, 'LEGACY_NO_FORMAL_ENVELOPE');
  assert.equal(bodyRes.envelope.detalhes, null);
});

test('J — wrong tenant access is denied with 403', async () => {
  const frete = { id: 'f-1', empresa_id: 'e-other', motorista_id: 'm-1', status: 'finalizado' };
  const supabaseMock = criarMockSupabase({ frete });
  const controller = carregarController(supabaseMock, {
    effective: { permissions: { 'freight.view': true } },
  });

  let statusRes = 0;
  let bodyRes = null;
  const req = {
    params: { id: 'f-1' },
    empresa_id: 'e-1',
    user: { uid: 'u-admin', role: 'admin', tipo: 'admin', is_super_admin: false },
  };
  const res = {
    status(s) { statusRes = s; return { json(b) { bodyRes = b; } }; },
  };

  await controller.getRelatorioFechamento(req, res);
  assert.equal(statusRes, 403);
});

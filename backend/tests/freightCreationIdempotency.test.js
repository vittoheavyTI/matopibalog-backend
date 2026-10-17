'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const {
  createFreight,
  FreightCreationError,
} = require('../services/freights/freightCreationService');
const { createFreteSchema } = require('../schemas/fretes');

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';

function createPersistentSupabase() {
  const rows = new Map();
  let generated = 0;
  let insertAttempts = 0;

  const drivers = {
    'driver-a': {
      placa_veiculo: 'AAA1A11', percentual_comissao: 10,
      empresa_id: 'tenant-a', unidade_operacional_id: 'unit-a',
    },
    'driver-b': {
      placa_veiculo: 'BBB2B22', percentual_comissao: 12,
      empresa_id: 'tenant-b', unidade_operacional_id: 'unit-b',
    },
  };

  function from(table) {
    const state = { filters: {}, insertPayload: null };
    const query = {
      select() { return query; },
      eq(field, value) { state.filters[field] = value; return query; },
      insert(payload) { state.insertPayload = { ...payload }; insertAttempts += 1; return query; },
      async single() {
        if (table === 'usuarios') return { data: { status: 'ativo' }, error: null };
        if (table === 'motoristas') {
          const driver = drivers[state.filters.id];
          return driver ? { data: { ...driver }, error: null } : { data: null, error: { message: 'not found' } };
        }
        if (table === 'empresas') {
          return { data: { tipo: 'transportadora' }, error: null };
        }
        if (table === 'fretes' && state.insertPayload) {
          // Entrega o controle ao event loop para que Promise.all exercite a
          // corrida: a unicidade persistente da intencao decide o vencedor.
          await new Promise((resolve) => setImmediate(resolve));
          const duplicateIntent = [...rows.values()].find((row) => (
            state.insertPayload.client_request_id
            && row.empresa_id === state.insertPayload.empresa_id
            && row.client_request_id === state.insertPayload.client_request_id
          ));
          if (duplicateIntent) return { data: null, error: { code: '23505', message: 'duplicate intent' } };
          const id = state.insertPayload.id || `generated-${++generated}`;
          if (rows.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const row = { ...state.insertPayload, id };
          rows.set(id, row);
          return { data: { ...row }, error: null };
        }
        return { data: null, error: { message: 'unexpected single' } };
      },
      async maybeSingle() {
        if (table !== 'fretes') return { data: null, error: null };
        const row = [...rows.values()].find((candidate) => (
          (state.filters.id === undefined || candidate.id === state.filters.id)
          && (state.filters.empresa_id === undefined || candidate.empresa_id === state.filters.empresa_id)
          && (state.filters.client_request_id === undefined || candidate.client_request_id === state.filters.client_request_id)
        ));
        if (!row) return { data: null, error: null };
        return { data: { ...row }, error: null };
      },
    };
    return query;
  }

  return {
    client: { from },
    drivers,
    rows,
    metrics: {
      get insertAttempts() { return insertAttempts; },
    },
  };
}

const baseBody = (overrides = {}) => ({
  origem: 'Balsas',
  destino: 'Luís Eduardo Magalhães',
  valor_frete: 1500,
  quem_recebeu: 'proprietario',
  ...overrides,
});

const create = (db, {
  requestId = null,
  driver = 'driver-a',
  body = {},
  forcedId = null,
  authorizeReplay = ({ existing }) => existing.motorista_id === driver,
} = {}) => createFreight(db.client, {
  user: { role: 'motorista', uid: driver },
  body: baseBody(body),
  clientRequestId: requestId,
  forcedId,
  authorizeReplay,
});

test('reprodução baseline: sem chave, resposta perdida + retry criam dois fretes', async () => {
  const db = createPersistentSupabase();
  await create(db); // resposta concluida no servidor e descartada pelo cliente
  await create(db); // retry sem identidade da intencao
  assert.equal(db.rows.size, 2);
});

test('resposta perdida + retry sequencial com a mesma intenção convergem', async () => {
  const db = createPersistentSupabase();
  const first = await create(db, { requestId: REQUEST_A });
  const retry = await create(db, { requestId: REQUEST_A });
  assert.equal(first.replay, false);
  assert.equal(retry.replay, true);
  assert.equal(retry.data.id, first.data.id);
  assert.equal(db.rows.size, 1);
});

test('duas criações concorrentes com a mesma intenção produzem uma linha', async () => {
  const db = createPersistentSupabase();
  const results = await Promise.all([
    create(db, { requestId: REQUEST_A }),
    create(db, { requestId: REQUEST_A }),
  ]);
  assert.equal(db.rows.size, 1);
  assert.deepEqual(results.map((result) => result.replay).sort(), [false, true]);
});

test('reuso da chave com payload diferente gera conflito', async () => {
  const db = createPersistentSupabase();
  await create(db, { requestId: REQUEST_A });
  await assert.rejects(
    create(db, { requestId: REQUEST_A, body: { destino: 'Palmas' } }),
    (error) => error instanceof FreightCreationError
      && error.status === 409
      && error.code === 'freight_idempotency_conflict',
  );
  assert.equal(db.rows.size, 1);
});

test('mudancas posteriores em placa e unidade derivada nao geram falso conflito', async () => {
  const db = createPersistentSupabase();
  const first = await create(db, { requestId: REQUEST_A });
  db.drivers['driver-a'].placa_veiculo = 'ZZZ9Z99';
  db.drivers['driver-a'].unidade_operacional_id = 'unit-after';

  const retry = await create(db, { requestId: REQUEST_A });
  assert.equal(retry.replay, true);
  assert.equal(retry.data.id, first.data.id);
  assert.equal(db.rows.size, 1);
});

test('mudanca de unidade explicitamente solicitada continua sendo conflito de intencao', async () => {
  const db = createPersistentSupabase();
  await create(db, { requestId: REQUEST_A, body: { unidade_operacional_id: 'unit-request-a' } });
  await assert.rejects(
    create(db, { requestId: REQUEST_A, body: { unidade_operacional_id: 'unit-request-b' } }),
    (error) => error instanceof FreightCreationError
      && error.status === 409
      && error.code === 'freight_idempotency_conflict',
  );
});

test('replay falha fechado quando permissao, ownership ou scope atual negam acesso', async () => {
  const db = createPersistentSupabase();
  await create(db, { requestId: REQUEST_A });
  await assert.rejects(
    create(db, { requestId: REQUEST_A, authorizeReplay: async () => false }),
    (error) => error instanceof FreightCreationError
      && error.status === 403
      && error.code === 'freight_idempotency_replay_forbidden',
  );
  assert.equal(db.rows.size, 1);
});

test('replay com chave falha fechado quando o chamador omite o autorizador', async () => {
  const db = createPersistentSupabase();
  await create(db, { requestId: REQUEST_A });
  await assert.rejects(
    createFreight(db.client, {
      user: { role: 'motorista', uid: 'driver-a' },
      body: baseBody(),
      clientRequestId: REQUEST_A,
    }),
    (error) => error instanceof FreightCreationError
      && error.status === 500
      && error.code === 'freight_idempotency_authorizer_missing',
  );
});

test('intenções distintas continuam criando fretes distintos', async () => {
  const db = createPersistentSupabase();
  await create(db, { requestId: REQUEST_A });
  await create(db, { requestId: REQUEST_B });
  assert.equal(db.rows.size, 2);
});

test('a mesma chave em tenants distintos permanece isolada e cria dois fretes', async () => {
  const db = createPersistentSupabase();
  const a = await create(db, { requestId: REQUEST_A, driver: 'driver-a' });
  const b = await create(db, { requestId: REQUEST_A, driver: 'driver-b' });
  assert.equal(db.rows.size, 2);
  assert.notEqual(a.data.id, b.data.id);
  assert.equal(a.data.empresa_id, 'tenant-a');
  assert.equal(b.data.empresa_id, 'tenant-b');
});

test('forcedId preexistente permanece idempotente no mesmo tenant', async () => {
  const db = createPersistentSupabase();
  const forcedId = 'campaign-freight-1';
  const first = await create(db, { forcedId });
  const retry = await create(db, { forcedId });
  assert.equal(first.replay, false);
  assert.equal(retry.replay, true);
  assert.equal(retry.data.id, forcedId);
  assert.equal(db.rows.size, 1);
});

test('forcedId nao devolve frete de outro tenant em uma colisao global', async () => {
  const db = createPersistentSupabase();
  const forcedId = 'campaign-freight-cross-tenant';
  await create(db, { forcedId, driver: 'driver-a' });
  await assert.rejects(
    create(db, { forcedId, driver: 'driver-b' }),
    (error) => error instanceof FreightCreationError
      && error.status === 500
      && error.code === 'freight_insert_failed',
  );
  assert.equal(db.rows.size, 1);
});

test('forcedId e client_request_id nao podem disputar autoridade na mesma criacao', async () => {
  const db = createPersistentSupabase();
  await assert.rejects(
    create(db, { forcedId: 'campaign-freight-2', requestId: REQUEST_A }),
    (error) => error instanceof FreightCreationError
      && error.status === 400
      && error.code === 'conflicting_idempotency_authorities',
  );
  assert.equal(db.rows.size, 0);
});

test('schema aceita UUID de intenção e rejeita chave inválida', () => {
  assert.equal(createFreteSchema.safeParse(baseBody({ client_request_id: REQUEST_A })).success, true);
  assert.equal(createFreteSchema.safeParse(baseBody({ client_request_id: 'chave-fraca' })).success, false);
  const scoped = createFreteSchema.safeParse(baseBody({
    unidade_operacional_id: '30000000-0000-4000-8000-000000000001',
  }));
  assert.equal(scoped.success, true);
  assert.equal(scoped.data.unidade_operacional_id, '30000000-0000-4000-8000-000000000001');
  assert.equal(createFreteSchema.safeParse(baseBody({ unidade_operacional_id: 'unidade-invalida' })).success, false);
});

test('controller notifica uma vez e revalida ownership e escopo no replay', async () => {
  const db = createPersistentSupabase();
  let notifications = 0;
  let scopeAllowed = true;
  const controllerPath = require.resolve('../controllers/fretesController');
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function load(request, parent, isMain) {
      if (request.replace(/\\\\/g, '/').endsWith('/config/supabase')) return db.client;
      if (request === '../services/notificacaoService') {
        return { notificarFreteCriado: async () => { notifications += 1; } };
      }
      if (request === '../services/operationalScopeService') {
        return {
          resolverEscopoOperacional: async () => ({ mode: 'SELECTED_UNIT' }),
          aplicarEscopoOperacionalQuery: (query) => query,
          escopoTemSelecaoInvalida: () => false,
          canAccessUnit: () => scopeAllowed,
          deriveUnitForWrite: ({ requestedUnitId, motoristaUnitId }) => ({
            ok: true,
            unidade_operacional_id: requestedUnitId || motoristaUnitId || null,
          }),
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const controller = require(controllerPath);
    const call = async ({
      body = baseBody({ client_request_id: REQUEST_A }),
      user = { role: 'motorista', uid: 'driver-a', is_super_admin: false },
    } = {}) => {
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await controller.create({
        body,
        user,
        empresa_id: 'tenant-a',
      }, res);
      return res;
    };

    const first = await call();
    const retry = await call();
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.idempotent, false);
    assert.equal(retry.statusCode, 201);
    assert.equal(retry.body.idempotent, true);
    assert.equal(notifications, 1);
    assert.equal(db.rows.size, 1);

    const existing = [...db.rows.values()][0];
    existing.motorista_id = 'driver-b';
    const ownershipDenied = await call();
    assert.equal(ownershipDenied.statusCode, 403);
    assert.equal(notifications, 1);
    existing.motorista_id = 'driver-a';

    const adminCall = () => call({
      body: baseBody({ client_request_id: REQUEST_B, motorista_id: 'driver-a' }),
      user: { role: 'admin', uid: 'admin-a', is_super_admin: false },
    });
    const adminFirst = await adminCall();
    assert.equal(adminFirst.statusCode, 201);
    scopeAllowed = false;
    const scopeDenied = await adminCall();
    assert.equal(scopeDenied.statusCode, 403);
    assert.equal(notifications, 2);
    assert.equal(db.rows.size, 2);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
});

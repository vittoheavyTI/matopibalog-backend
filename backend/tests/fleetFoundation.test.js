const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
  FleetError,
  buildAssetPayload,
  buildCompositionPayload,
  createAsset,
  targetPayload,
} = require('../services/fleet/fleetService');
const { PERMISSION_BY_KEY } = require('../services/permissions/permissionRegistry');
const {
  computeEffectivePermissions,
  hasPermission,
} = require('../services/permissions/permissionResolver');

test('fleet permissions are active capabilities, no longer future placeholders', () => {
  assert.equal(PERMISSION_BY_KEY['fleet.view'].futureModule, undefined);
  assert.equal(PERMISSION_BY_KEY['fleet.manage'].futureModule, undefined);
  assert.equal(PERMISSION_BY_KEY['fleet.view'].scoped, true);
  assert.equal(PERMISSION_BY_KEY['fleet.manage'].scoped, true);
  assert.equal(PERMISSION_BY_KEY['fleet.view'].entitlementCodigo, 'fleet');
  assert.equal(PERMISSION_BY_KEY['fleet.manage'].entitlementCodigo, 'fleet');
});

test('fleet permission requires entitlement before template or override can allow it', () => {
  const denied = computeEffectivePermissions({
    user: { tipo: 'admin' },
    template: { permissions: { 'fleet.manage': true } },
    overrides: { 'fleet.view': 'allow' },
    entitlements: { fleet: false },
  });
  assert.equal(hasPermission(denied, 'fleet.view'), false);
  assert.equal(hasPermission(denied, 'fleet.manage'), false);
  assert.equal(denied.source['fleet.view'], 'entitlement_denied');
  assert.equal(denied.source['fleet.manage'], 'entitlement_denied');

  const allowed = computeEffectivePermissions({
    user: { tipo: 'admin' },
    template: { permissions: { 'fleet.view': true, 'fleet.manage': true } },
    entitlements: { fleet: true },
  });
  assert.equal(hasPermission(allowed, 'fleet.view'), true);
  assert.equal(hasPermission(allowed, 'fleet.manage'), true);
});

test('asset payload normalizes plate and supports first release asset types', () => {
  const payload = buildAssetPayload({
    asset_type: 'tractor',
    internal_identifier: ' Cavalo 01 ',
    plate: ' abc 1d23 ',
    brand: 'Volvo',
    model: 'FH',
    model_year: 2022,
    useful_capacity_kg: '45000.5',
    metadata: { eixo: '6x4' },
  });

  assert.equal(payload.asset_type, 'tractor');
  assert.equal(payload.internal_identifier, 'Cavalo 01');
  assert.equal(payload.plate, 'ABC1D23');
  assert.equal(payload.useful_capacity_kg, 45000.5);
  assert.deepEqual(payload.metadata, { eixo: '6x4' });

  for (const assetType of ['truck', 'tractor', 'semitrailer', 'trailer', 'dolly', 'implement']) {
    assert.equal(buildAssetPayload({ asset_type: assetType, internal_identifier: `id-${assetType}` }).asset_type, assetType);
  }
});

test('fleet domain rejects invalid target ambiguity and invalid enums', () => {
  assert.throws(
    () => targetPayload({ asset_id: 'asset-1', composition_id: 'comp-1' }),
    (err) => err instanceof FleetError && err.code === 'invalid_target',
  );
  assert.throws(
    () => targetPayload({}),
    (err) => err instanceof FleetError && err.code === 'invalid_target',
  );
  assert.throws(
    () => buildAssetPayload({ asset_type: 'boolean-column-style', internal_identifier: 'x' }),
    (err) => err instanceof FleetError && err.code === 'invalid_enum',
  );
  assert.throws(
    () => buildCompositionPayload({ code: '', status: 'active' }),
    (err) => err instanceof FleetError && err.code === 'missing_code',
  );
});

test('fleet writes reject operational units outside resolved scope before database write', async () => {
  const forbiddenScope = {
    mode: 'LIMITED',
    allowed_unit_ids: ['unit-a'],
    include_legacy_unscoped: false,
    has_operational_structure: true,
  };
  const supabase = {
    from() {
      throw new Error('database should not be touched after scope denial');
    },
  };

  await assert.rejects(
    () => createAsset(supabase, {
      empresaId: 'empresa-1',
      user: { uid: 'user-1' },
      operationalScope: forbiddenScope,
      body: {
        asset_type: 'truck',
        internal_identifier: 'TRUCK-01',
        unidade_operacional_id: 'unit-b',
      },
    }),
    (err) => err instanceof FleetError && err.code === 'operational_unit_forbidden',
  );
});

test('fleet router is protected by auth, tenant, plan and effective permissions', () => {
  const routePath = require.resolve('../routes/fleet');
  const originalLoad = Module._load;
  delete require.cache[routePath];

  const verifyToken = function verifyToken(_req, _res, next) { next(); };
  const verificarEmpresa = function verificarEmpresa(_req, _res, next) { next(); };
  const verificarPlano = function verificarPlano(_req, _res, next) { next(); };
  const resolverEscopoOperacional = async function resolverEscopoOperacional() {
    return { mode: 'LEGACY_COMPANY' };
  };
  const escopoTemSelecaoInvalida = function escopoTemSelecaoInvalida() { return false; };
  const permissions = [];
  const controller = {
    listarAtivos: function listarAtivos(_req, res) { res.json({}); },
    criarAtivo: function criarAtivo(_req, res) { res.json({}); },
    atualizarAtivo: function atualizarAtivo(_req, res) { res.json({}); },
    listarComposicoes: function listarComposicoes(_req, res) { res.json({}); },
    criarComposicao: function criarComposicao(_req, res) { res.json({}); },
    adicionarMembroComposicao: function adicionarMembroComposicao(_req, res) { res.json({}); },
    encerrarMembroComposicao: function encerrarMembroComposicao(_req, res) { res.json({}); },
    criarVinculoMotorista: function criarVinculoMotorista(_req, res) { res.json({}); },
    encerrarVinculoMotorista: function encerrarVinculoMotorista(_req, res) { res.json({}); },
    criarVinculoFrete: function criarVinculoFrete(_req, res) { res.json({}); },
  };

  Module._load = function (request, parent, isMain) {
    if (request === '../middlewares/auth') return { verifyToken };
    if (request === '../middlewares/tenant') return { verificarEmpresa };
    if (request === '../middlewares/verificarPlano') return { verificarPlano };
    if (request === '../services/operationalScopeService') {
      return { resolverEscopoOperacional, escopoTemSelecaoInvalida };
    }
    if (request === '../middlewares/requirePermission') {
      return {
        requirePermission: (key) => {
          const mw = function permissionMiddleware(_req, _res, next) { next(); };
          mw.permissionKey = key;
          permissions.push(key);
          return mw;
        },
      };
    }
    if (request === '../controllers/fleetController') return controller;
    return originalLoad.call(this, request, parent, isMain);
  };

  let router;
  try {
    router = require(routePath);
  } finally {
    Module._load = originalLoad;
  }

  const globalMiddlewares = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);
  assert.equal(globalMiddlewares.length, 4);
  assert.deepEqual(globalMiddlewares.slice(0, 3), [verifyToken, verificarEmpresa, verificarPlano]);
  assert.equal(globalMiddlewares[3].name, 'resolverEscopoFleet');

  const getAssets = router.stack.find((layer) => layer.route?.path === '/assets' && layer.route.methods.get).route;
  assert.equal(getAssets.stack[0].handle.permissionKey, 'fleet.view');
  assert.equal(getAssets.stack[1].handle, controller.listarAtivos);

  const postAssets = router.stack.find((layer) => layer.route?.path === '/assets' && layer.route.methods.post).route;
  assert.equal(postAssets.stack[0].handle.permissionKey, 'fleet.manage');

  assert.ok(permissions.includes('fleet.view'));
  assert.ok(permissions.includes('fleet.manage'));
});

test('migration 074 is additive, tenant-scoped and keeps legacy freight fields intact', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '074_fleet_foundation.sql'), 'utf8');
  const requiredTables = [
    'fleet_assets',
    'vehicle_compositions',
    'vehicle_composition_members',
    'driver_vehicle_assignments',
    'freight_vehicle_assignments',
    'asset_documents',
    'odometer_events',
    'tires',
    'tire_installations',
    'tire_events',
    'maintenance_events',
  ];

  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${table} TO authenticated`));
  }

  assert.match(sql, /CREATE POLICY fleet_assets_tenant_access ON public\.fleet_assets\s+FOR ALL TO authenticated/);
  assert.match(sql, /'fleet', 'Frota'/);
  assert.match(sql, /unidade_operacional_id UUID NULL REFERENCES public\.unidades_operacionais\(id\) ON DELETE SET NULL/);
  assert.match(sql, /CHECK \(asset_type IN \('truck','tractor','semitrailer','trailer','dolly','implement','other'\)\)/);
  assert.match(sql, /CHECK \(\(asset_id IS NULL\) <> \(composition_id IS NULL\)\)/);
  assert.match(sql, /driver_vehicle_assignments_active_driver_key/);
  assert.match(sql, /freight_vehicle_assignments_active_frete_key/);
  assert.match(sql, /document_category TEXT NOT NULL DEFAULT 'VEHICLE_DOCUMENT'/);
  assert.doesNotMatch(sql, /\bauth\.role\s*\(/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+public\.fretes/i);
});

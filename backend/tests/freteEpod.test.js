const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/freteEpodController');
const acessoPath = require.resolve('../controllers/freteAcesso');

// Carrega o controller (e o helper freteAcesso) com um supabase mockado por cenário.
function carregarController(cenario = {}) {
  const chamadas = { inserts: [], updates: [], uploads: [], signed: [], removes: [] };

  function builder(tabela) {
    const state = { count: false, insert: false, update: false };
    const b = {
      select(_cols, opts) { if (opts && opts.count) state.count = true; return b; },
      eq() { return b; },
      order() { return b; },
      insert(payload) { state.insert = true; chamadas.inserts.push({ tabela, payload }); return b; },
      update(payload) { state.update = true; chamadas.updates.push({ tabela, payload }); return b; },
      async single() { return resolverLinha(tabela, state); },
      async maybeSingle() { return resolverLinha(tabela, state); },
      then(resolve) {
        if (state.count) return resolve({ count: cenario[`${tabela}_count`] ?? 0, error: cenario.countError || null });
        if (tabela === 'frete_epod_evidencias') return resolve({ data: cenario.evidLista ?? [], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  }

  function resolverLinha(tabela, state) {
    if (tabela === 'fretes') {
      return cenario.frete ? { data: cenario.frete, error: null } : { data: null, error: { message: 'not found' } };
    }
    if (tabela === 'frete_epod') {
      if (state.insert) {
        if (cenario.insertError) return { data: null, error: { message: 'insert falhou' } };
        const p = chamadas.inserts[chamadas.inserts.length - 1].payload;
        return { data: { ...p }, error: null };
      }
      if (state.update) return { data: cenario.epod ? { ...cenario.epod } : null, error: null };
      return { data: cenario.epod ?? null, error: null };
    }
    if (tabela === 'frete_epod_evidencias') {
      if (state.insert) {
        if (cenario.insertError) return { data: null, error: { message: 'insert falhou' } };
        const p = chamadas.inserts[chamadas.inserts.length - 1].payload;
        return { data: { id: p.id, nome_arquivo: p.nome_arquivo, mime: p.mime, tamanho_bytes: p.tamanho_bytes, created_at: '2026-07-29T00:00:00Z' }, error: null };
      }
      return { data: cenario.evid ?? null, error: cenario.evid ? null : { message: 'not found' } };
    }
    return { data: null, error: null };
  }

  const supabaseMock = {
    from(tabela) { return builder(tabela); },
    storage: {
      from(bucket) {
        return {
          async upload(path, _buf, opts) { chamadas.uploads.push({ bucket, path, opts }); return { error: cenario.uploadError || null }; },
          async createSignedUrl(path, ttl) { chamadas.signed.push({ bucket, path, ttl }); return { data: { signedUrl: 'https://signed.example/' + path }, error: cenario.signedError || null }; },
          async remove(paths) { chamadas.removes.push(paths); return { error: null }; },
        };
      },
    },
  };

  const originalLoad = Module._load;
  [controllerPath, acessoPath].forEach((p) => delete require.cache[p]);
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(controllerPath);
  Module._load = originalLoad;
  [controllerPath, acessoPath].forEach((p) => delete require.cache[p]);
  return { controller, chamadas };
}

function resMock() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const FRETE = { id: 'frete-1', motorista_id: 'mot-1', empresa_id: 'emp-1', status: 'ativo' };
const EPOD = { id: 'epod-1', frete_id: 'frete-1', status: 'registrado' };
const fileMock = (mime = 'image/jpeg') => ({ buffer: Buffer.from('x'), mimetype: mime, size: 1234, originalname: 'foto.jpg' });
const motoristaDono = { uid: 'mot-1', role: 'motorista', is_super_admin: false };
const adminDono = { uid: 'adm-1', role: 'admin', is_super_admin: false };
const adminOutra = { uid: 'adm-9', role: 'admin', is_super_admin: false };

function req(over = {}) {
  return { params: { id: 'frete-1' }, query: {}, body: {}, user: motoristaDono, empresa_id: 'emp-1', ...over };
}

test('obter: frete sem ePOD → epod null e evidencias vazias', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: null });
  const res = resMock();
  await controller.obter(req(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { epod: null, evidencias: [] });
});

test('obter: com ePOD → retorna epod + evidencias', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD, evidLista: [{ id: 'e1' }] });
  const res = resMock();
  await controller.obter(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.epod.id, 'epod-1');
  assert.equal(res.body.evidencias.length, 1);
});

test('registrar: motorista dono → 201 com empresa_id/frete_id/criado_por derivados e status registrado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: null });
  const res = resMock();
  await controller.registrar(req({ body: { recebido_por: 'João', observacao: 'ok', latitude: -12.1, longitude: -45.2 } }), res);
  assert.equal(res.statusCode, 201);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_epod').payload;
  assert.equal(ins.empresa_id, 'emp-1');
  assert.equal(ins.frete_id, 'frete-1');
  assert.equal(ins.status, 'registrado');
  assert.equal(ins.criado_por, 'mot-1');
  assert.equal(ins.recebido_por, 'João');
  assert.equal(ins.latitude, -12.1);
});

test('registrar: ePOD já existe → 409 sem insert', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.registrar(req(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.inserts.length, 0);
});

test('registrar: admin de OUTRA empresa → 403 (isolamento)', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: null });
  const res = resMock();
  await controller.registrar(req({ user: adminOutra, empresa_id: 'emp-OUTRA' }), res);
  assert.equal(res.statusCode, 403);
});

test('registrar: frete inexistente → 404', async () => {
  const { controller } = carregarController({ frete: null });
  const res = resMock();
  await controller.registrar(req(), res);
  assert.equal(res.statusCode, 404);
});

test('atualizar: edita campos → 200', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.atualizar(req({ body: { observacao: 'nova obs' } }), res);
  assert.equal(res.statusCode, 200);
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_epod').payload;
  assert.equal(upd.observacao, 'nova obs');
  assert.ok(upd.updated_at);
});

test('atualizar: sem ePOD → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: null });
  const res = resMock();
  await controller.atualizar(req({ body: { observacao: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

test('validar: admin aprova → 200 e grava validado_por/validado_em', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.validar(req({ user: adminDono, body: { status: 'validado' } }), res);
  assert.equal(res.statusCode, 200);
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_epod').payload;
  assert.equal(upd.status, 'validado');
  assert.equal(upd.validado_por, 'adm-1');
  assert.ok(upd.validado_em);
  assert.equal(upd.motivo_rejeicao, null);
});

test('validar: motorista (não admin) → 403 sem update', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.validar(req({ user: motoristaDono, body: { status: 'validado' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(chamadas.updates.length, 0);
});

test('validar: rejeitado grava motivo', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.validar(req({ user: adminDono, body: { status: 'rejeitado', motivo_rejeicao: 'ilegível' } }), res);
  assert.equal(res.statusCode, 200);
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_epod').payload;
  assert.equal(upd.status, 'rejeitado');
  assert.equal(upd.motivo_rejeicao, 'ilegível');
});

test('uploadEvidencia: sem ePOD → 404 sem upload', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: null });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(chamadas.uploads.length, 0);
});

test('uploadEvidencia: com ePOD → 201, bucket privado e path epod', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD, frete_epod_evidencias_count: 0 });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.uploads[0].bucket, 'fretes-evidencias');
  assert.match(chamadas.uploads[0].path, /^emp-1\/fretes\/frete-1\/epod\/.+\.jpg$/);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_epod_evidencias').payload;
  assert.equal(ins.empresa_id, 'emp-1');
  assert.equal(ins.epod_id, 'epod-1');
});

test('uploadEvidencia: MIME não permitido → 415 sem upload', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock('application/zip') }), res);
  assert.equal(res.statusCode, 415);
  assert.equal(chamadas.uploads.length, 0);
});

test('uploadEvidencia: limite de 10 → 409 sem upload', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD, frete_epod_evidencias_count: 10 });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.uploads.length, 0);
});

test('getEvidenciaUrl: evidência do frete → url assinada TTL 300 no bucket privado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evid: { id: 'e1', storage_path: 'emp-1/fretes/frete-1/epod/e1.jpg' } });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', evidId: 'e1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^https:\/\/signed\.example\//);
  assert.equal(chamadas.signed[0].bucket, 'fretes-evidencias');
  assert.equal(chamadas.signed[0].ttl, 300);
});

test('getEvidenciaUrl: inexistente → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, evid: null });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', evidId: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

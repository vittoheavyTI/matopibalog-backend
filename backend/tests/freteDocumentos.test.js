const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/freteDocumentosController');

// Carrega o controller com um supabase mockado e configurável por cenário.
function carregarController(cenario = {}) {
  const chamadas = { inserts: [], uploads: [], signed: [], removes: [] };

  function builder(tabela) {
    const state = { count: false, inserting: false };
    const b = {
      select(_cols, opts) { if (opts && opts.count) state.count = true; return b; },
      eq() { return b; },
      order() { return b; },
      insert(payload) { state.inserting = true; chamadas.inserts.push({ tabela, payload }); return b; },
      async single() {
        if (tabela === 'fretes') {
          return cenario.frete
            ? { data: cenario.frete, error: null }
            : { data: null, error: { message: 'not found' } };
        }
        if (tabela === 'frete_documentos' && state.inserting) {
          if (cenario.insertError) return { data: null, error: { message: 'insert falhou' } };
          const p = chamadas.inserts[chamadas.inserts.length - 1].payload;
          return { data: { id: p.id, tipo: p.tipo, nome_arquivo: p.nome_arquivo, mime: p.mime, tamanho_bytes: p.tamanho_bytes, created_at: '2026-07-13T00:00:00Z' }, error: null };
        }
        // getSignedUrl: busca o doc pelo id+frete_id
        if (tabela === 'frete_documentos') {
          return cenario.doc
            ? { data: cenario.doc, error: null }
            : { data: null, error: { message: 'not found' } };
        }
        return { data: null, error: null };
      },
      then(resolve) {
        if (state.count) return resolve({ count: cenario.count ?? 0, error: cenario.countError || null });
        if (tabela === 'frete_documentos') return resolve({ data: cenario.lista ?? [], error: null });
        return resolve({ data: null, error: null });
      },
    };
    return b;
  }

  const supabaseMock = {
    from(tabela) { return builder(tabela); },
    storage: {
      from(bucket) {
        return {
          async upload(path, _buffer, opts) {
            chamadas.uploads.push({ bucket, path, opts });
            return { error: cenario.uploadError || null };
          },
          async createSignedUrl(path, ttl) {
            chamadas.signed.push({ bucket, path, ttl });
            return { data: { signedUrl: 'https://signed.example/' + path }, error: cenario.signedError || null };
          },
          async remove(paths) { chamadas.removes.push(paths); return { error: null }; },
        };
      },
    },
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(controllerPath);
  Module._load = originalLoad;
  delete require.cache[controllerPath];
  return { controller, chamadas };
}

function resMock() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const FRETE = { id: 'frete-1', motorista_id: 'mot-1', empresa_id: 'emp-1', status: 'ativo' };
const fileMock = (mime = 'application/pdf') => ({ buffer: Buffer.from('x'), mimetype: mime, size: 1234, originalname: 'doc.pdf' });
const userMotoristaDono = { uid: 'mot-1', role: 'motorista', is_super_admin: false };
const userAdminOutra = { uid: 'adm-9', role: 'admin', is_super_admin: false };

async function upload(reqOver, cenario) {
  const { controller, chamadas } = carregarController(cenario);
  const res = resMock();
  const req = { params: { id: 'frete-1' }, body: { tipo: 'cte' }, file: fileMock(), user: userMotoristaDono, empresa_id: 'emp-1', ...reqOver };
  await controller.upload(req, res);
  return { res, chamadas };
}

// P2.10 — o gate empresarial de upload exige documents.manage EFETIVA. O controller
// resolve via require lazy de '../middlewares/requirePermission'; para testar o gate
// sem I/O real, pré-populamos o require.cache desse módulo com um ensureEffective
// controlável e restauramos ao final (robusto contra o timing do Module._load).
const permPath = require.resolve('../middlewares/requirePermission');
function stubEnsureEffective(effective) {
  const original = require.cache[permPath];
  require.cache[permPath] = {
    id: permPath, filename: permPath, loaded: true, exports: {
      ensureEffective: async () => ({ permissions: effective || {} }),
    },
  };
  return function restaurar() {
    if (original) require.cache[permPath] = original; else delete require.cache[permPath];
  };
}

const userAdminPropria = { uid: 'adm-1', role: 'admin', is_super_admin: false };
const userSuperAdmin = { uid: 'sa-1', role: 'admin', is_super_admin: true };

test('upload: motorista dono anexa PDF -> 201, row com empresa_id/frete_id derivados e bucket privado', async () => {
  const { res, chamadas } = await upload({}, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 201);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_documentos').payload;
  assert.equal(ins.empresa_id, 'emp-1');
  assert.equal(ins.frete_id, 'frete-1');
  assert.equal(ins.tipo, 'cte');
  assert.equal(ins.criado_por, 'mot-1');
  assert.match(ins.storage_path, /^emp-1\/fretes\/frete-1\/documentos\/.+\.pdf$/);
  assert.equal(chamadas.uploads[0].bucket, 'fretes-documentos'); // NUNCA comprovantes
  assert.equal(chamadas.uploads[0].opts.upsert, false);
});

test('upload: tipo inválido -> 400 sem upload', async () => {
  const { res, chamadas } = await upload({ body: { tipo: 'boleto' } }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 400);
  assert.equal(chamadas.uploads.length, 0);
});

test('upload: MIME não permitido -> 415 sem upload', async () => {
  const { res, chamadas } = await upload({ file: fileMock('application/zip') }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 415);
  assert.equal(chamadas.uploads.length, 0);
});

test('upload: XML aceito (application/xml) -> 201', async () => {
  const { res } = await upload({ body: { tipo: 'nfe' }, file: fileMock('application/xml') }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 201);
});

test('upload: limite de 10 documentos por frete -> 409 sem upload', async () => {
  const { res, chamadas } = await upload({}, { frete: FRETE, count: 10 });
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.uploads.length, 0);
});

test('upload: admin de OUTRA empresa -> 403 (isolamento) sem upload', async () => {
  const { res, chamadas } = await upload({ user: userAdminOutra, empresa_id: 'emp-OUTRA' }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 403);
  assert.equal(chamadas.uploads.length, 0);
});

// ── P2.10: documentos = ação CONTEXTUAL do motorista vs. gestão EMPRESARIAL ──
test('upload: admin da PRÓPRIA empresa SEM documents.manage -> 403 (gate empresarial)', async () => {
  const restaurar = stubEnsureEffective({ 'documents.manage': false });
  try {
    const { res, chamadas } = await upload({ user: userAdminPropria, empresa_id: 'emp-1' }, { frete: FRETE, count: 0 });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.permission, 'documents.manage');
    assert.equal(chamadas.uploads.length, 0);
  } finally { restaurar(); }
});

test('upload: admin da PRÓPRIA empresa COM documents.manage -> 201 (gestão empresarial)', async () => {
  const restaurar = stubEnsureEffective({ 'documents.manage': true });
  try {
    const { res } = await upload({ user: userAdminPropria, empresa_id: 'emp-1' }, { frete: FRETE, count: 0 });
    assert.equal(res.statusCode, 201);
  } finally { restaurar(); }
});

test('upload: motorista dono NÃO precisa de documents.manage -> 201 (acesso contextual preservado)', async () => {
  // Sem stub: se o controller tentasse exigir documents.manage do motorista, quebraria.
  const { res } = await upload({ user: userMotoristaDono, empresa_id: 'emp-1' }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 201);
});

test('upload: super-admin ignora o gate documents.manage -> 201', async () => {
  const restaurar = stubEnsureEffective({ 'documents.manage': false });
  try {
    const { res } = await upload({ user: userSuperAdmin, empresa_id: 'emp-1' }, { frete: FRETE, count: 0 });
    assert.equal(res.statusCode, 201);
  } finally { restaurar(); }
});

test('upload: motorista NÃO dono -> 403', async () => {
  const { res } = await upload({ user: { uid: 'mot-OUTRO', role: 'motorista', is_super_admin: false } }, { frete: FRETE, count: 0 });
  assert.equal(res.statusCode, 403);
});

test('upload: frete inexistente -> 404', async () => {
  const { res } = await upload({}, { frete: null });
  assert.equal(res.statusCode, 404);
});

test('listar: motorista dono recebe a lista do frete', async () => {
  const { controller } = carregarController({ frete: FRETE, lista: [{ id: 'd1', tipo: 'cte' }] });
  const res = resMock();
  await controller.listar({ params: { id: 'frete-1' }, user: userMotoristaDono, empresa_id: 'emp-1' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
});

test('getSignedUrl: doc do frete -> url assinada; TTL curto no bucket privado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, doc: { id: 'd1', storage_path: 'emp-1/fretes/frete-1/documentos/d1.pdf' } });
  const res = resMock();
  await controller.getSignedUrl({ params: { id: 'frete-1', docId: 'd1' }, user: userMotoristaDono, empresa_id: 'emp-1' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^https:\/\/signed\.example\//);
  assert.equal(chamadas.signed[0].bucket, 'fretes-documentos');
  assert.equal(chamadas.signed[0].ttl, 300);
});

test('getSignedUrl: doc inexistente/de outro frete -> 404', async () => {
  const { controller } = carregarController({ frete: FRETE, doc: null });
  const res = resMock();
  await controller.getSignedUrl({ params: { id: 'frete-1', docId: 'x' }, user: userMotoristaDono, empresa_id: 'emp-1' }, res);
  assert.equal(res.statusCode, 404);
});

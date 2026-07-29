const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/freteOcorrenciasController');
const acessoPath = require.resolve('../controllers/freteAcesso');

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
        if (tabela === 'frete_ocorrencias') return resolve({ data: cenario.lista ?? [], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  }

  function resolverLinha(tabela, state) {
    if (tabela === 'fretes') {
      return cenario.frete ? { data: cenario.frete, error: null } : { data: null, error: { message: 'not found' } };
    }
    if (tabela === 'frete_ocorrencias') {
      if (state.insert) {
        if (cenario.insertError) return { data: null, error: { message: 'insert falhou' } };
        const p = chamadas.inserts[chamadas.inserts.length - 1].payload;
        return { data: { ...p }, error: null };
      }
      if (state.update) return { data: { ...(cenario.ocorrencia || {}), ...chamadas.updates[chamadas.updates.length - 1].payload }, error: null };
      return { data: cenario.ocorrencia ?? null, error: null };
    }
    if (tabela === 'frete_ocorrencia_evidencias') {
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
const OCOR = { id: 'oc-1', status: 'aberta' };
const fileMock = (mime = 'image/jpeg') => ({ buffer: Buffer.from('x'), mimetype: mime, size: 999, originalname: 'avaria.jpg' });
const motoristaDono = { uid: 'mot-1', role: 'motorista', is_super_admin: false };
const adminDono = { uid: 'adm-1', role: 'admin', is_super_admin: false };
const adminOutra = { uid: 'adm-9', role: 'admin', is_super_admin: false };

function req(over = {}) {
  return { params: { id: 'frete-1', ocorrenciaId: 'oc-1' }, query: {}, body: {}, user: motoristaDono, empresa_id: 'emp-1', ...over };
}

test('listar: retorna as ocorrências do frete', async () => {
  const { controller } = carregarController({ frete: FRETE, lista: [{ id: 'oc-1' }, { id: 'oc-2' }] });
  const res = resMock();
  await controller.listar(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 2);
});

test('criar: motorista dono → 201 com empresa_id/frete_id/status aberta/criado_por derivados', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE });
  const res = resMock();
  await controller.criar(req({ body: { tipo: 'avaria', descricao: 'Caixa amassada', impacto: 'parcial' } }), res);
  assert.equal(res.statusCode, 201);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_ocorrencias').payload;
  assert.equal(ins.empresa_id, 'emp-1');
  assert.equal(ins.frete_id, 'frete-1');
  assert.equal(ins.tipo, 'avaria');
  assert.equal(ins.status, 'aberta');
  assert.equal(ins.criado_por, 'mot-1');
});

test('criar: admin de OUTRA empresa → 403 (isolamento)', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE });
  const res = resMock();
  await controller.criar(req({ user: adminOutra, empresa_id: 'emp-OUTRA', body: { tipo: 'atraso', descricao: 'x' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(chamadas.inserts.length, 0);
});

test('criar: frete inexistente → 404', async () => {
  const { controller } = carregarController({ frete: null });
  const res = resMock();
  await controller.criar(req({ body: { tipo: 'atraso', descricao: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

test('atualizar: admin resolve → 200 com resolvida_em/resolvida_por/resolucao', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR });
  const res = resMock();
  await controller.atualizar(req({ user: adminDono, body: { status: 'resolvida', resolucao: 'Reentregue' } }), res);
  assert.equal(res.statusCode, 200);
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_ocorrencias').payload;
  assert.equal(upd.status, 'resolvida');
  assert.equal(upd.resolucao, 'Reentregue');
  assert.equal(upd.resolvida_por, 'adm-1');
  assert.ok(upd.resolvida_em);
});

test('atualizar: motorista tenta mudar status → 403 sem update', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR });
  const res = resMock();
  await controller.atualizar(req({ user: motoristaDono, body: { status: 'resolvida', resolucao: 'x' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(chamadas.updates.length, 0);
});

test('atualizar: motorista edita descrição (sem mudar status) → 200', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR });
  const res = resMock();
  await controller.atualizar(req({ user: motoristaDono, body: { descricao: 'Detalhe novo' } }), res);
  assert.equal(res.statusCode, 200);
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_ocorrencias').payload;
  assert.equal(upd.descricao, 'Detalhe novo');
});

test('atualizar: ocorrência inexistente → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, ocorrencia: null });
  const res = resMock();
  await controller.atualizar(req({ user: adminDono, body: { impacto: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

test('uploadEvidencia: → 201, bucket privado e path ocorrencias', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR, frete_ocorrencia_evidencias_count: 0 });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.uploads[0].bucket, 'fretes-evidencias');
  assert.match(chamadas.uploads[0].path, /^emp-1\/fretes\/frete-1\/ocorrencias\/oc-1\/.+\.jpg$/);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_ocorrencia_evidencias').payload;
  assert.equal(ins.ocorrencia_id, 'oc-1');
  assert.equal(ins.empresa_id, 'emp-1');
});

test('uploadEvidencia: MIME não permitido → 415 sem upload', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock('application/zip') }), res);
  assert.equal(res.statusCode, 415);
  assert.equal(chamadas.uploads.length, 0);
});

test('uploadEvidencia: limite de 10 → 409 sem upload', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, ocorrencia: OCOR, frete_ocorrencia_evidencias_count: 10 });
  const res = resMock();
  await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(chamadas.uploads.length, 0);
});

test('getEvidenciaUrl: → url assinada TTL 300 no bucket privado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evid: { id: 'e1', storage_path: 'emp-1/fretes/frete-1/ocorrencias/oc-1/e1.jpg' } });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', ocorrenciaId: 'oc-1', evidId: 'e1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(chamadas.signed[0].bucket, 'fretes-evidencias');
  assert.equal(chamadas.signed[0].ttl, 300);
});

test('getEvidenciaUrl: inexistente → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, evid: null });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', ocorrenciaId: 'oc-1', evidId: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

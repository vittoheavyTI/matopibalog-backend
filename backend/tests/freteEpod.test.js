const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/freteEpodController');
const acessoPath = require.resolve('../controllers/freteAcesso');
const notifPath = require.resolve('../services/notificacaoService');

// Carrega o controller (+ helpers/serviços) com um supabase mockado por cenário.
function carregarController(cenario = {}) {
  const chamadas = { inserts: [], updates: [], uploads: [], signed: [], removes: [] };

  function builder(tabela) {
    const st = { count: false, insert: false, update: false, select: false };
    const b = {
      select(_c, opts) { st.select = true; if (opts && opts.count) st.count = true; return b; },
      eq() { return b; },
      neq() { return b; },
      order() { return b; },
      insert(p) { st.insert = true; chamadas.inserts.push({ tabela, payload: p }); return b; },
      update(p) { st.update = true; chamadas.updates.push({ tabela, payload: p }); return b; },
      async single() { return term(tabela, st); },
      async maybeSingle() { return term(tabela, st); },
      then(resolve) { return resolve(termList(tabela, st)); },
    };
    return b;
  }

  function term(tabela, st) {
    if (tabela === 'fretes') {
      return cenario.frete ? { data: cenario.frete, error: null } : { data: null, error: { message: 'nf' } };
    }
    if (tabela === 'frete_epod') {
      if (st.insert) { return cenario.insertError ? { data: null, error: { message: 'x' } } : { data: { ...chamadas.inserts.at(-1).payload }, error: null }; }
      if (st.update) return { data: cenario.epod ? { ...cenario.epod } : null, error: null };
      return { data: cenario.epod ?? null, error: null };
    }
    if (tabela === 'frete_epod_evidencias') {
      if (st.insert) { const p = chamadas.inserts.at(-1).payload; return { data: { id: p.id, nome_arquivo: p.nome_arquivo, mime: p.mime, status: 'pendente', created_at: 't' }, error: null }; }
      if (st.update) return { data: cenario.evidAlvo ?? null, error: null }; // validarEvidencia
      return { data: cenario.evid ?? null, error: cenario.evid ? null : { message: 'nf' } }; // getEvidenciaUrl
    }
    if (tabela === 'notificacoes') return { data: cenario.notifExistente ?? { id: 'n1' }, error: null };
    return { data: null, error: null };
  }

  function termList(tabela, st) {
    if (st.count) return { count: cenario[`${tabela}_count`] ?? 0, error: cenario.countError || null };
    if (tabela === 'frete_epod_evidencias') {
      if (st.update && st.select) return { data: cenario.aprovadas ?? [], error: null }; // aprovarPendentes
      if (st.update) return { error: null }; // rejeitarComprovacao (update sem select)
      return { data: cenario.evidLista ?? [], error: null }; // lista / recompute (select 'status')
    }
    if (tabela === 'usuarios') return { data: cenario.usuarios ?? [], error: null };
    return { data: [], error: null };
  }

  const supabaseMock = {
    from(t) { return builder(t); },
    storage: {
      from(bucket) {
        return {
          async upload(path, _b, opts) { chamadas.uploads.push({ bucket, path, opts }); return { error: cenario.uploadError || null }; },
          async createSignedUrl(path, ttl) { chamadas.signed.push({ bucket, path, ttl }); return { data: { signedUrl: 'https://s/' + path }, error: cenario.signedError || null }; },
          async remove(paths) { chamadas.removes.push(paths); return { error: null }; },
        };
      },
    },
  };

  const originalLoad = Module._load;
  [controllerPath, acessoPath, notifPath].forEach((p) => delete require.cache[p]);
  Module._load = function (request, parent, isMain) {
    if (request === '../config/supabase') return supabaseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const controller = require(controllerPath);
  Module._load = originalLoad;
  [controllerPath, acessoPath, notifPath].forEach((p) => delete require.cache[p]);
  return { controller, chamadas };
}

function resMock() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const FRETE = { id: 'frete-1', motorista_id: 'mot-1', empresa_id: 'emp-1', status: 'ativo' };
const EPOD = { id: 'epod-1', frete_id: 'frete-1', status: 'registrado' };
const fileMock = (mime = 'image/jpeg') => ({ buffer: Buffer.from('x'), mimetype: mime, size: 10, originalname: 'f.jpg' });
const motorista = { uid: 'mot-1', role: 'motorista', is_super_admin: false };
const admin = { uid: 'adm-1', role: 'admin', is_super_admin: false };
const adminOutra = { uid: 'adm-9', role: 'admin', is_super_admin: false };
const req = (o = {}) => ({ params: { id: 'frete-1' }, query: {}, body: {}, user: motorista, empresa_id: 'emp-1', ...o });

// ── derivarStatusEpod (puro) ────────────────────────────────────────────────
test('derivarStatusEpod: 0 evidências → registrado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([]), 'registrado');
});
test('derivarStatusEpod: todas aprovadas → validado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'aprovada' }, { status: 'aprovada' }]), 'validado');
});
test('derivarStatusEpod: aprovada + pendente → parcial', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'aprovada' }, { status: 'pendente' }]), 'parcial');
});
test('derivarStatusEpod: todas rejeitadas → rejeitado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'rejeitada' }]), 'rejeitado');
});
test('derivarStatusEpod: pendente sem aprovada → registrado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'pendente' }, { status: 'rejeitada' }]), 'registrado');
});
// Regra B (rejeitada é SUPERADA para o status geral quando há aprovada e nada pendente).
test('derivarStatusEpod: aprovada + rejeitada (histórica), sem pendente → validado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'aprovada' }, { status: 'rejeitada' }]), 'validado');
});
test('derivarStatusEpod: aprovada + pendente + rejeitada → parcial (ainda há pendente)', () => {
  const { controller } = carregarController();
  assert.equal(
    controller.derivarStatusEpod([{ status: 'aprovada' }, { status: 'pendente' }, { status: 'rejeitada' }]),
    'parcial',
  );
});
test('derivarStatusEpod: E2E reenvio A(aprovada)+B(rejeitada)+C(aprovada) → validado', () => {
  const { controller } = carregarController();
  assert.equal(
    controller.derivarStatusEpod([{ status: 'aprovada' }, { status: 'rejeitada' }, { status: 'aprovada' }]),
    'validado',
  );
});
test('derivarStatusEpod: várias rejeitadas + 1 aprovada, sem pendente → validado', () => {
  const { controller } = carregarController();
  assert.equal(
    controller.derivarStatusEpod([
      { status: 'rejeitada' }, { status: 'rejeitada' }, { status: 'aprovada' },
    ]),
    'validado',
  );
});
test('derivarStatusEpod: rejeitada + pendente, sem aprovada → registrado (fluxo ainda aberto)', () => {
  const { controller } = carregarController();
  assert.equal(
    controller.derivarStatusEpod([{ status: 'rejeitada' }, { status: 'pendente' }, { status: 'pendente' }]),
    'registrado',
  );
});
test('derivarStatusEpod: uma só pendente → registrado', () => {
  const { controller } = carregarController();
  assert.equal(controller.derivarStatusEpod([{ status: 'pendente' }]), 'registrado');
});

// ── obter / registrar / atualizar ───────────────────────────────────────────
test('obter: sem ePOD → epod null', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: null });
  const res = resMock(); await controller.obter(req(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.epod, null);
});
test('registrar: motorista dono → 201 derivados', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: null });
  const res = resMock(); await controller.registrar(req({ body: { recebido_por: 'J' } }), res);
  assert.equal(res.statusCode, 201);
  const ins = chamadas.inserts.find((i) => i.tabela === 'frete_epod').payload;
  assert.equal(ins.empresa_id, 'emp-1'); assert.equal(ins.status, 'registrado'); assert.equal(ins.criado_por, 'mot-1');
});
test('registrar: já existe → 409', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock(); await controller.registrar(req(), res);
  assert.equal(res.statusCode, 409);
});
test('registrar: admin outra empresa → 403', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: null });
  const res = resMock(); await controller.registrar(req({ user: adminOutra, empresa_id: 'emp-X' }), res);
  assert.equal(res.statusCode, 403);
});
test('atualizar: edita → 200', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock(); await controller.atualizar(req({ body: { observacao: 'o' } }), res);
  assert.equal(res.statusCode, 200);
});

// ── uploadEvidencia ─────────────────────────────────────────────────────────
test('uploadEvidencia: sem ePOD → 404', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: null });
  const res = resMock(); await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 404); assert.equal(chamadas.uploads.length, 0);
});
test('uploadEvidencia: com ePOD → 201 bucket privado + recompute', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD, frete_epod_evidencias_count: 0, evidLista: [{ status: 'pendente' }] });
  const res = resMock(); await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(chamadas.uploads[0].bucket, 'fretes-evidencias');
  assert.ok(chamadas.updates.some((u) => u.tabela === 'frete_epod' && u.payload.status === 'registrado'));
});
test('uploadEvidencia: MIME inválido → 415', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock(); await controller.uploadEvidencia(req({ file: fileMock('application/zip') }), res);
  assert.equal(res.statusCode, 415);
});
test('uploadEvidencia: limite 10 → 409', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD, frete_epod_evidencias_count: 10 });
  const res = resMock(); await controller.uploadEvidencia(req({ file: fileMock() }), res);
  assert.equal(res.statusCode, 409);
});

// ── validarEvidencia (por evidência) ────────────────────────────────────────
test('validarEvidencia: admin aprova → 200, evidência aprovada + status_geral validado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evidAlvo: { id: 'ev1', epod_id: 'epod-1' }, evidLista: [{ status: 'aprovada' }] });
  const res = resMock();
  await controller.validarEvidencia(req({ user: admin, params: { id: 'frete-1', evidId: 'ev1' }, body: { status: 'aprovada' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'aprovada');
  assert.equal(res.body.status_geral, 'validado');
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_epod_evidencias').payload;
  assert.equal(upd.status, 'aprovada'); assert.equal(upd.validado_por, 'adm-1');
});
test('validarEvidencia: admin rejeita → 200 com motivo, status_geral rejeitado', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evidAlvo: { id: 'ev1', epod_id: 'epod-1' }, evidLista: [{ status: 'rejeitada' }] });
  const res = resMock();
  await controller.validarEvidencia(req({ user: admin, params: { id: 'frete-1', evidId: 'ev1' }, body: { status: 'rejeitada', motivo_rejeicao: 'ilegível' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status_geral, 'rejeitado');
  const upd = chamadas.updates.find((u) => u.tabela === 'frete_epod_evidencias').payload;
  assert.equal(upd.status, 'rejeitada'); assert.equal(upd.motivo_rejeicao, 'ilegível'); assert.equal(upd.rejeitado_por, 'adm-1');
});
test('validarEvidencia: motorista (não admin) → 403 sem update', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evidAlvo: { id: 'ev1', epod_id: 'epod-1' } });
  const res = resMock();
  await controller.validarEvidencia(req({ user: motorista, params: { id: 'frete-1', evidId: 'ev1' }, body: { status: 'aprovada' } }), res);
  assert.equal(res.statusCode, 403); assert.equal(chamadas.updates.length, 0);
});
test('validarEvidencia: evidência inexistente → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, evidAlvo: null });
  const res = resMock();
  await controller.validarEvidencia(req({ user: admin, params: { id: 'frete-1', evidId: 'x' }, body: { status: 'aprovada' } }), res);
  assert.equal(res.statusCode, 404);
});

// ── rejeitarComprovacao / aprovarPendentes ──────────────────────────────────
test('rejeitarComprovacao: admin → 200, marca evidências rejeitadas', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, epod: EPOD, evidLista: [{ status: 'rejeitada' }] });
  const res = resMock();
  await controller.rejeitarComprovacao(req({ user: admin, body: { motivo_rejeicao: 'tudo errado' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status_geral, 'rejeitado');
  const updEvid = chamadas.updates.find((u) => u.tabela === 'frete_epod_evidencias').payload;
  assert.equal(updEvid.status, 'rejeitada'); assert.equal(updEvid.motivo_rejeicao, 'tudo errado');
});
test('rejeitarComprovacao: motorista → 403', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.rejeitarComprovacao(req({ user: motorista, body: { motivo_rejeicao: 'x' } }), res);
  assert.equal(res.statusCode, 403);
});
test('aprovarPendentes: admin → 200 e conta aprovadas', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD, aprovadas: [{ id: 'e1' }, { id: 'e2' }], evidLista: [{ status: 'aprovada' }, { status: 'aprovada' }] });
  const res = resMock();
  await controller.aprovarPendentes(req({ user: admin }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aprovadas, 2);
  assert.equal(res.body.status_geral, 'validado');
});
test('aprovarPendentes: motorista → 403', async () => {
  const { controller } = carregarController({ frete: FRETE, epod: EPOD });
  const res = resMock();
  await controller.aprovarPendentes(req({ user: motorista }), res);
  assert.equal(res.statusCode, 403);
});

// ── getEvidenciaUrl ─────────────────────────────────────────────────────────
test('getEvidenciaUrl: → url assinada TTL 300', async () => {
  const { controller, chamadas } = carregarController({ frete: FRETE, evid: { id: 'e1', storage_path: 'emp-1/fretes/frete-1/epod/e1.jpg' } });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', evidId: 'e1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(chamadas.signed[0].ttl, 300);
});
test('getEvidenciaUrl: inexistente → 404', async () => {
  const { controller } = carregarController({ frete: FRETE, evid: null });
  const res = resMock();
  await controller.getEvidenciaUrl(req({ params: { id: 'frete-1', evidId: 'x' } }), res);
  assert.equal(res.statusCode, 404);
});

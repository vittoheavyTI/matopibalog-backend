const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/fretesController');

const criarController = (freteBase, storageOverrides = {}) => {
  const capt = { upload: null, update: null, signedPath: null, removed: [] };
  let modoUpdate = false;

  const builderFretes = {
    select() { return builderFretes; },
    eq() { return builderFretes; },
    update(payload) { modoUpdate = true; capt.update = payload; return builderFretes; },
    async single() {
      return modoUpdate
        ? { data: { ...freteBase, ...capt.update }, error: null }
        : { data: freteBase, error: null };
    },
  };

  const storageBucket = {
    async upload(path, buffer, options) {
      capt.upload = { path, buffer, options };
      return storageOverrides.uploadResult || { data: { path }, error: null };
    },
    async createSignedUrl(path, expiresIn) {
      capt.signedPath = { path, expiresIn };
      return storageOverrides.signedResult || { data: { signedUrl: `https://signed.test/${path}` }, error: null };
    },
    async remove(paths) {
      capt.removed.push(...paths);
      return { data: paths, error: null };
    },
  };

  const supabaseMock = {
    from(tabela) {
      if (tabela !== 'fretes') throw new Error(`Tabela inesperada: ${tabela}`);
      return builderFretes;
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'fretes-odometro');
      return storageBucket;
    } },
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      if (request === '../services/notificacaoService') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    return { controller: require(controllerPath), capt };
  } finally {
    Module._load = originalLoad;
  }
};

const respostaFake = () => {
  let resposta;
  return {
    res: { status(status) { return { json(body) { resposta = { status, body }; return resposta; } }; } },
    get: () => resposta,
  };
};

const frete = (over = {}) => ({
  id: 'frete-1',
  motorista_id: 'motorista-1',
  empresa_id: 'empresa-1',
  status: 'pendente',
  foto_odometro_inicial_path: null,
  foto_odometro_final_path: null,
  ...over,
});

const arquivoJpeg = () => ({
  originalname: 'odometro.jpg',
  mimetype: 'image/jpeg',
  size: 4,
  buffer: Buffer.from('foto'),
});

test('upload inicial do tenant grava path privado e ativa frete pendente', async () => {
  const { controller, capt } = criarController(frete());
  const resposta = respostaFake();
  await controller.uploadOdometroInicial({
    params: { id: 'frete-1' },
    file: arquivoJpeg(),
    empresa_id: 'empresa-1',
    user: { role: 'admin', uid: 'admin-1' },
  }, resposta.res);

  assert.equal(resposta.get().status, 200);
  assert.equal(capt.upload.path, 'empresa-1/fretes/frete-1/odometro-inicial.jpg');
  assert.equal(capt.upload.options.contentType, 'image/jpeg');
  assert.equal(capt.upload.options.upsert, true);
  assert.deepEqual(capt.update, {
    foto_odometro_inicial_path: 'empresa-1/fretes/frete-1/odometro-inicial.jpg',
    status: 'ativo',
  });
  assert.equal(resposta.get().body.status, 'ativo');
});

test('upload final grava somente o path final e mantém status ativo', async () => {
  const { controller, capt } = criarController(frete({ status: 'ativo' }));
  const resposta = respostaFake();
  await controller.uploadOdometroFinal({
    params: { id: 'frete-1' },
    file: arquivoJpeg(),
    empresa_id: 'empresa-1',
    user: { role: 'admin', uid: 'admin-1' },
  }, resposta.res);

  assert.equal(resposta.get().status, 200);
  assert.deepEqual(capt.update, {
    foto_odometro_final_path: 'empresa-1/fretes/frete-1/odometro-final.jpg',
  });
});

test('upload bloqueia admin de outro tenant antes do Storage', async () => {
  const { controller, capt } = criarController(frete());
  const resposta = respostaFake();
  await controller.uploadOdometroInicial({
    params: { id: 'frete-1' },
    file: arquivoJpeg(),
    empresa_id: 'empresa-2',
    user: { role: 'admin', uid: 'admin-2' },
  }, resposta.res);

  assert.equal(resposta.get().status, 403);
  assert.equal(capt.upload, null);
  assert.equal(capt.update, null);
});

test('upload inicial com MIME inválido → 400 e não sobe ao Storage', async () => {
  const { controller, capt } = criarController(frete());
  const resposta = respostaFake();
  await controller.uploadOdometroInicial({
    params: { id: 'frete-1' },
    file: { originalname: 'foto.gif', mimetype: 'image/gif', size: 4, buffer: Buffer.from('gif') },
    empresa_id: 'empresa-1',
    user: { role: 'admin', uid: 'admin-1' },
  }, resposta.res);

  assert.equal(resposta.get().status, 400);
  assert.match(resposta.get().body.message, /JPEG, PNG ou WebP/i);
  assert.equal(capt.upload, null, 'não deve tentar subir arquivo de MIME não permitido');
  assert.equal(capt.update, null, 'não deve tocar no frete');
});

test('falha no Storage não ativa o frete pendente (sem update, retorna 502)', async () => {
  // Prova que um upload que falha NÃO deixa o frete em estado inconsistente: o status
  // permanece pendente (nenhum update é chamado) e o cliente recebe 502.
  const { controller, capt } = criarController(frete(), { uploadResult: { error: { message: 'storage indisponível' } } });
  const resposta = respostaFake();
  await controller.uploadOdometroInicial({
    params: { id: 'frete-1' },
    file: arquivoJpeg(),
    empresa_id: 'empresa-1',
    user: { role: 'admin', uid: 'admin-1' },
  }, resposta.res);

  assert.equal(resposta.get().status, 502);
  assert.equal(capt.update, null, 'frete não pode ser ativado quando o upload falha');
});

test('signed URL usa path privado salvo e expira em 5 minutos', async () => {
  const path = 'empresa-1/fretes/frete-1/odometro-inicial.jpg';
  const { controller, capt } = criarController(frete({ foto_odometro_inicial_path: path }));
  const resposta = respostaFake();
  await controller.getOdometroSignedUrl({
    params: { id: 'frete-1', tipo: 'inicial' },
    empresa_id: 'empresa-1',
    user: { role: 'admin', uid: 'admin-1' },
  }, resposta.res);

  assert.equal(resposta.get().status, 200);
  assert.deepEqual(capt.signedPath, { path, expiresIn: 300 });
  assert.equal(resposta.get().body.signed_url, `https://signed.test/${path}`);
});

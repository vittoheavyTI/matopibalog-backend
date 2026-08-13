const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const E = require('../services/auth/authErrors');

const helperPath = require.resolve('../services/auth/sessionRevocationEvents');

function carregarHelper(runtime) {
  const originalLoad = Module._load;
  delete require.cache[helperPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === './authRuntime') return { getAuthRuntime: () => runtime };
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(helperPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[helperPath];
  }
}

test('revogarSessoesDoUsuarioSeSec1 e no-op quando sessoes estao desabilitadas', async () => {
  const helper = carregarHelper({ cfg: { sessionsEnabled: false }, sessionService: null });
  assert.deepEqual(await helper.revogarSessoesDoUsuarioSeSec1('u-1', 'senha_alterada'), { skipped: true });
});

test('revogarSessoesDoUsuarioSeSec1 delega para sessionService em SEC-1', async () => {
  const chamadas = [];
  const helper = carregarHelper({
    cfg: { sessionsEnabled: true },
    sessionService: {
      async revogarTodasDoUsuario(uid, motivo) {
        chamadas.push({ uid, motivo });
        return { ok: true, revogadas: 3 };
      },
    },
  });
  assert.deepEqual(await helper.revogarSessoesDoUsuarioSeSec1('u-1', 'role_alterada'), { ok: true, revogadas: 3 });
  assert.deepEqual(chamadas, [{ uid: 'u-1', motivo: 'role_alterada' }]);
});

test('responderErroRevogacao preserva status tipado de infraestrutura', () => {
  const helper = carregarHelper({ cfg: { sessionsEnabled: true }, sessionService: null });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  helper.responderErroRevogacao(res, new E.SessionDependencyUnavailable('db down'));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'SessionDependencyUnavailable');
});

test('controllers mantem revogacao SEC-1 em eventos sensiveis de senha/status/role', () => {
  const authController = fs.readFileSync(path.resolve(__dirname, '../controllers/authController.js'), 'utf8');
  const adminController = fs.readFileSync(path.resolve(__dirname, '../controllers/adminController.js'), 'utf8');

  assert.match(authController, /revogarSessoesDoUsuarioSeSec1\(req\.user\.uid,\s*'senha_alterada'\)/);
  for (const motivo of ['senha_resetada', 'usuario_desabilitado', 'role_alterada', 'permissoes_alteradas']) {
    assert.ok(adminController.includes(motivo), `adminController deve cobrir ${motivo}`);
  }
});

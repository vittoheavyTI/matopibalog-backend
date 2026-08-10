// §M-5 — Prova ESTRUTURAL sobre o routes/fretes.js REAL: o sub-router de telemetria
// (/localizacao/sessao) é registrado ANTES do verifyToken global, garantindo que a
// credencial de rastreamento (opaca, não-JWT) NÃO passe pelo verifyToken (que a
// rejeitaria). As rotas gerais (/:id etc.) permanecem sob verifyToken.
//
// routes/fretes.js → controllers → config/supabase (process.exit sem env; e o client
// real do @supabase/supabase-js quebra no Node 20 sem WebSocket). STUB via Module._load
// (padrão do projeto): o client real nunca é construído. verifyToken real é preservado.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-teste';
const Module = require('node:module');
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && request.replace(/\\/g, '/').endsWith('config/supabase')) {
    return { from: () => ({}) };
  }
  return _origLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyToken } = require('../middlewares/auth');

const router = require('../routes/fretes');

Module._load = _origLoad; // restaura após carregar routes/fretes e seus controllers

// Índice da 1ª layer que casa um path; -1 se nenhuma.
function idxPrimeiraLayer(pred) {
  return router.stack.findIndex(pred);
}
function layerCasaPath(layer, path) {
  try { return !!(layer.regexp && layer.regexp.test(path)); } catch { return false; }
}

test('sub-router de telemetria /localizacao/sessao é registrado ANTES do verifyToken global', () => {
  const idxTelemetria = idxPrimeiraLayer((l) => l.name === 'router' && layerCasaPath(l, '/localizacao/sessao'));
  const idxVerifyToken = idxPrimeiraLayer((l) => l.handle === verifyToken);
  assert.ok(idxTelemetria >= 0, 'mount /localizacao/sessao não encontrado');
  assert.ok(idxVerifyToken >= 0, 'layer verifyToken global não encontrada');
  assert.ok(idxTelemetria < idxVerifyToken, `telemetria (${idxTelemetria}) deve vir ANTES do verifyToken (${idxVerifyToken})`);
});

test('a emissão /localizacao/credencial fica DEPOIS do verifyToken (sob sessão SEC-1)', () => {
  const idxVerifyToken = idxPrimeiraLayer((l) => l.handle === verifyToken);
  // rota POST /localizacao/credencial
  const idxEmissao = idxPrimeiraLayer((l) => l.route && l.route.path === '/localizacao/credencial');
  assert.ok(idxEmissao >= 0, 'rota /localizacao/credencial não encontrada');
  assert.ok(idxEmissao > idxVerifyToken, 'emissão deve estar sob o verifyToken global');
});

test('rotas gerais (/:id) ficam sob o verifyToken global', () => {
  const idxVerifyToken = idxPrimeiraLayer((l) => l.handle === verifyToken);
  const idxGetId = idxPrimeiraLayer((l) => l.route && l.route.path === '/:id');
  assert.ok(idxGetId > idxVerifyToken, 'GET /:id deve estar sob verifyToken');
});

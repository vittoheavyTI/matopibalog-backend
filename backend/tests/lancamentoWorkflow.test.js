// lancamentoWorkflow — unidades puras (envelope, origem, mapeamento de erro) e a
// orquestração transicionar/registrarCriacao com supabase + bus FALSOS (sem DB).
//
// Intercepta o require de '../config/supabase' ANTES de carregar o workflow: o config
// real chama createClient(), e o @supabase/supabase-js inicializa o realtime-js, que no
// Node 20 (sem WebSocket global) lança "Node.js 20 detected without native WebSocket
// support". O singleton real nunca é usado aqui — todos os testes de orquestração
// injetam fakes. Padrão idêntico aos demais testes do repo.
const Module = require('node:module');
const _origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '../config/supabase') {
    return { rpc: async () => ({ data: null, error: null }), from: () => ({ insert: async () => ({ error: null }) }) };
  }
  return _origLoad.call(this, request, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const wf = require('../services/lancamentoWorkflow');
Module._load = _origLoad; // restaura após carregar o módulo sob teste

test('construirEventoLancamento monta envelope mínimo', () => {
  const ev = wf.construirEventoLancamento({ type: 'launch.approved', empresaId: 'e1', entityType: 'despesa', entityId: 'd1', freteId: 'f1', version: 3 });
  assert.equal(ev.type, 'launch.approved');
  assert.equal(ev.empresa_id, 'e1');
  assert.equal(ev.entity_type, 'despesa');
  assert.equal(ev.entity_id, 'd1');
  assert.equal(ev.freight_id, 'f1');
  assert.equal(ev.version, 3);
  assert.ok(ev.occurred_at, 'occurred_at preenchido');
  assert.ok(ev.event_id.includes('d1'));
});

test('detectarOrigem: header explícito vence; senão cookie=web, bearer=app', () => {
  assert.equal(wf.detectarOrigem({ get: () => 'app' }), 'app');
  assert.equal(wf.detectarOrigem({ get: () => 'web' }), 'web');
  // sem header: cookie → web
  assert.equal(wf.detectarOrigem({ get: () => '', cookies: { token: 'x' }, headers: {} }), 'web');
  // sem header/cookie: bearer → app
  assert.equal(wf.detectarOrigem({ get: () => '', cookies: {}, headers: { authorization: 'Bearer y' } }), 'app');
  // nada → api
  assert.equal(wf.detectarOrigem({ get: () => '', cookies: {}, headers: {} }), 'api');
});

test('mapearErroTransicao cobre os tokens da RPC', () => {
  const casos = [
    ['LANCAMENTO_MOTIVO_OBRIGATORIO', 400, 'MOTIVO_OBRIGATORIO'],
    ['LANCAMENTO_TRANSICAO_INVALIDA', 409, 'TRANSICAO_INVALIDA'],
    ['LANCAMENTO_CONFLITO_VERSAO', 409, 'CONFLITO'],
    ['LANCAMENTO_CONFLITO_ESTADO', 409, 'CONFLITO'],
    ['LANCAMENTO_TENANT', 403, 'TENANT'],
    ['LANCAMENTO_NAO_ENCONTRADO', 404, 'NAO_ENCONTRADO'],
    ['LANCAMENTO_TIPO_INVALIDO', 400, 'REQUISICAO_INVALIDA'],
    ['algum erro aleatório', 500, 'ERRO'],
  ];
  for (const [msg, http, code] of casos) {
    const r = wf.mapearErroTransicao({ message: msg });
    assert.equal(r.http, http, `http de ${msg}`);
    assert.equal(r.code, code, `code de ${msg}`);
    assert.ok(r.message && r.message.length > 0, 'mensagem pt-BR presente');
  }
});

test('transicionar: sucesso publica evento e retorna a linha canônica', async () => {
  let publicado = null;
  const supabaseFake = { rpc: async (_fn, _args) => ({ data: { id: 'd1', status: 'aprovado', version: 2, frete_id: 'f1', updated_at: '2026-08-20T00:00:00Z' }, error: null }) };
  const busFake = { publish: (e) => { publicado = e; } };
  const r = await wf.transicionar({ entityType: 'despesa', entityId: 'd1', empresaId: 'e1', novoStatus: 'aprovado', actorId: 'u1', actorRole: 'admin', source: 'web', supabase: supabaseFake, barramento: busFake });
  assert.equal(r.ok, true);
  assert.equal(r.http, 200);
  assert.equal(r.data.status, 'aprovado');
  assert.ok(publicado, 'evento publicado');
  assert.equal(publicado.type, 'launch.approved');
  assert.equal(publicado.empresa_id, 'e1');
  assert.equal(publicado.version, 2);
});

test('transicionar: erro da RPC não publica evento e mapeia HTTP', async () => {
  let publicou = false;
  const supabaseFake = { rpc: async () => ({ data: null, error: { message: 'LANCAMENTO_TRANSICAO_INVALIDA' } }) };
  const busFake = { publish: () => { publicou = true; } };
  const r = await wf.transicionar({ entityType: 'vale', entityId: 'v1', empresaId: 'e1', novoStatus: 'aprovado', actorId: 'u1', actorRole: 'admin', source: 'app', supabase: supabaseFake, barramento: busFake });
  assert.equal(r.ok, false);
  assert.equal(r.http, 409);
  assert.equal(r.code, 'TRANSICAO_INVALIDA');
  assert.equal(publicou, false, 'não publica evento em erro');
});

test('transicionar: valida entityType e novoStatus antes de tocar o banco', async () => {
  let chamouRpc = false;
  const supabaseFake = { rpc: async () => { chamouRpc = true; return { data: {}, error: null }; } };
  const r1 = await wf.transicionar({ entityType: 'frete', entityId: 'x', empresaId: 'e1', novoStatus: 'aprovado', supabase: supabaseFake });
  assert.equal(r1.ok, false);
  assert.equal(r1.http, 400);
  const r2 = await wf.transicionar({ entityType: 'despesa', entityId: 'x', empresaId: 'e1', novoStatus: 'finalizado', supabase: supabaseFake });
  assert.equal(r2.ok, false);
  assert.equal(r2.http, 400);
  assert.equal(chamouRpc, false, 'não chama a RPC com entrada inválida');
});

test('registrarCriacao: insere evento created e publica launch.created (best-effort)', async () => {
  let inserido = null;
  let publicado = null;
  const supabaseFake = { from: (_t) => ({ insert: async (row) => { inserido = row; return { error: null }; } }) };
  const busFake = { publish: (e) => { publicado = e; } };
  await wf.registrarCriacao({ entityType: 'despesa', row: { id: 'd1', empresa_id: 'e1', frete_id: 'f1', status: 'pendente', version: 1 }, actorId: 'u1', actorRole: 'motorista', source: 'app', supabase: supabaseFake, barramento: busFake });
  assert.equal(inserido.action, 'created');
  assert.equal(inserido.entity_id, 'd1');
  assert.equal(inserido.to_status, 'pendente');
  assert.equal(publicado.type, 'launch.created');
});

test('registrarCriacao: falha de auditoria NÃO propaga (create não pode quebrar)', async () => {
  const supabaseFake = { from: () => ({ insert: async () => { throw new Error('db down'); } }) };
  const busFake = { publish: () => {} };
  await assert.doesNotReject(wf.registrarCriacao({ entityType: 'vale', row: { id: 'v1', empresa_id: 'e1' }, supabase: supabaseFake, barramento: busFake }));
});

// E1.6A — compatibilidade de rollout (observação/descrição obrigatória só p/ cliente novo)
const reqCom = (plataforma) => ({ get: (h) => (String(h).toLowerCase() === 'x-client-platform' ? plataforma : undefined), headers: {} });

test('clienteNovoContrato: só quando X-Client-Platform = web|app', () => {
  assert.equal(wf.clienteNovoContrato(reqCom('web')), true);
  assert.equal(wf.clienteNovoContrato(reqCom('app')), true);
  assert.equal(wf.clienteNovoContrato(reqCom(undefined)), false); // APK legado
  assert.equal(wf.clienteNovoContrato(reqCom('outro')), false);
});

test('exigeCampoContexto: legado sem observação PASSA (não quebra APK antigo)', () => {
  assert.equal(wf.exigeCampoContexto(reqCom(undefined), '', 'observação').ok, true);
  assert.equal(wf.exigeCampoContexto(reqCom(undefined), null, 'observação').ok, true);
});

test('exigeCampoContexto: cliente NOVO sem observação é BLOQUEADO', () => {
  const r = wf.exigeCampoContexto(reqCom('app'), '', 'observação');
  assert.equal(r.ok, false);
  assert.match(r.message, /observação/);
  const w = wf.exigeCampoContexto(reqCom('web'), '   ', 'descrição');
  assert.equal(w.ok, false);
});

test('exigeCampoContexto: com valor válido PASSA para qualquer cliente', () => {
  assert.equal(wf.exigeCampoContexto(reqCom('app'), 'tanque cheio', 'observação').ok, true);
  assert.equal(wf.exigeCampoContexto(reqCom(undefined), 'adiantamento', 'descrição').ok, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../services/funcionalidadeAdminService');

test('validar: nome obrigatório e código válido na criação', () => {
  assert.equal(svc.validarFuncionalidade({ codigo: 'erp_api', nome: 'X' }).ok, true);
  assert.equal(svc.validarFuncionalidade({ codigo: 'erp_api' }).ok, false); // sem nome
  assert.equal(svc.validarFuncionalidade({ codigo: 'ERP', nome: 'X' }).ok, false); // maiúsculo
  assert.equal(svc.validarFuncionalidade({ codigo: 'a', nome: 'X' }).ok, false); // curto
});

test('validar: código IMUTÁVEL após uso', () => {
  const usado = svc.validarFuncionalidade({ codigo: 'novo_codigo', nome: 'X' }, { editando: true, codigoAtual: 'antigo', jaUtilizada: true });
  assert.equal(usado.ok, false);
  assert.ok(usado.erros.some((e) => /codigo não pode ser alterado/.test(e)));
  // Sem uso, pode trocar.
  const livre = svc.validarFuncionalidade({ codigo: 'novo_codigo', nome: 'X' }, { editando: true, codigoAtual: 'antigo', jaUtilizada: false });
  assert.equal(livre.ok, true);
});

test('validar: enums de ciclo/cobrança e preço', () => {
  assert.equal(svc.validarFuncionalidade({ nome: 'X', status_ciclo_vida: 'inexistente' }, { editando: true }).ok, false);
  assert.equal(svc.validarFuncionalidade({ nome: 'X', modelo_cobranca: 'errado' }, { editando: true }).ok, false);
  assert.equal(svc.validarFuncionalidade({ nome: 'X', preco_padrao_centavos: -1 }, { editando: true }).ok, false);
  assert.equal(svc.validarFuncionalidade({ nome: 'X', status_ciclo_vida: 'em_breve', preco_padrao_centavos: 5000 }, { editando: true }).ok, true);
});

test('montarPatch: só inclui campos enviados + normaliza booleans', () => {
  const p = svc.montarPatchFuncionalidade({ nome: 'X', visivel_publicamente: true, ativo: false, ordem_exibicao: '5' });
  assert.equal(p.nome, 'X');
  assert.equal(p.visivel_publicamente, true);
  assert.equal(p.ativo, false);
  assert.equal(p.ordem_exibicao, 5);
  assert.ok(p.atualizado_em);
  assert.equal('categoria' in p, false);
});

// salvarMatrizLote — agora delega à RPC transacional (migration 061). O serviço
// valida entrada mínima, chama supabase.rpc e MAPEIA os erros de domínio para
// HTTP. A atomicidade/idempotência/concorrência são provadas nos testes de
// Postgres real (backend/tests-pg/matriz_rpc.pgtest.mjs), não em mock.
function mockRpc(resposta) {
  const calls = [];
  return {
    _calls: calls,
    rpc(fn, params) { calls.push({ fn, params }); return Promise.resolve(resposta); },
  };
}

test('salvarMatrizLote: itens vazios → 400 (sem chamar a RPC)', async () => {
  const sb = mockRpc({ data: null, error: null });
  const r = await svc.salvarMatrizLote(sb, { itens: [] }, 'ator');
  assert.equal(r.status, 400);
  assert.equal(sb._calls.length, 0);
});

test('salvarMatrizLote: sucesso → 200 e repassa params corretos à RPC', async () => {
  const data = { alterado: true, celulas_alteradas: 1, versao_nova: { p1: 2 } };
  const sb = mockRpc({ data, error: null });
  const r = await svc.salvarMatrizLote(sb, {
    itens: [{ plano_id: 'p1', funcionalidade_id: 'f1', disponibilidade: 'incluida' }],
    versoesEsperadas: { p1: 1 }, motivo: 'x', requestId: 'req-1',
  }, 'ator-123');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, data);
  const c = sb._calls[0];
  assert.equal(c.fn, 'publicar_matriz_funcionalidades');
  assert.equal(c.params.p_ator, 'ator-123');       // ator do backend, não do payload
  assert.equal(c.params.p_origem, 'painel_admin');
  assert.equal(c.params.p_request_id, 'req-1');
  assert.deepEqual(c.params.p_versoes_esperadas, { p1: 1 });
});

test('salvarMatrizLote: conflito de versão (P0003) → 409 com dados p/ recarregar', async () => {
  const sb = mockRpc({ data: null, error: { code: 'P0003', message: 'conflito_versao:abc-123:1:2' } });
  const r = await svc.salvarMatrizLote(sb, { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }], versoesEsperadas: { p1: 1 } }, 'ator');
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'conflito_versao');
  assert.equal(r.body.plano_id, 'abc-123');
  assert.equal(r.body.versao_esperada, 1);
  assert.equal(r.body.versao_atual, 2);
});

test('salvarMatrizLote: payload inválido (P0001) → 422; inexistente (P0002) → 404', async () => {
  const r1 = await svc.salvarMatrizLote(mockRpc({ data: null, error: { code: 'P0001', message: 'versao_esperada_ausente:p1' } }), { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }] }, 'a');
  assert.equal(r1.status, 422);
  const r2 = await svc.salvarMatrizLote(mockRpc({ data: null, error: { code: 'P0002', message: 'plano_inexistente' } }), { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }] }, 'a');
  assert.equal(r2.status, 404);
});

test('salvarMatrizLote: erro desconhecido → 500 sem vazar SQL', async () => {
  const r = await svc.salvarMatrizLote(mockRpc({ data: null, error: { code: 'XX000', message: 'internal boom' } }), { itens: [{ plano_id: 'p1', funcionalidade_id: 'f1' }] }, 'a');
  assert.equal(r.status, 500);
  assert.equal(r.body.message, 'Erro ao salvar matriz.');
  assert.ok(!/boom/.test(JSON.stringify(r.body)));
});

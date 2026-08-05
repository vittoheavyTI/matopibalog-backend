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

// salvarMatrizLote — validação de entrada (mock supabase mínimo)
function mockSb() {
  const calls = { upserts: [], updates: [] };
  return {
    _calls: calls,
    from(t) {
      const b = {
        select() { return b; }, eq() { return b; }, maybeSingle() { return Promise.resolve({ data: { matriz_funcionalidades_versao: 1 }, error: null }); },
        update(p) { calls.updates.push({ t, p }); return b; },
        upsert(rows) { calls.upserts.push({ t, rows }); return Promise.resolve({ error: null }); },
        insert() { return Promise.resolve({ error: null }); },
      };
      return b;
    },
  };
}

test('salvarMatrizLote: rejeita item sem plano/funcionalidade', async () => {
  const r = await svc.salvarMatrizLote(mockSb(), [{ plano_id: 'p1' }], 'ator');
  assert.equal(r.status, 422);
});

test('salvarMatrizLote: rejeita disponibilidade inválida', async () => {
  const r = await svc.salvarMatrizLote(mockSb(), [{ plano_id: 'p1', funcionalidade_id: 'f1', disponibilidade: 'xpto' }], 'ator');
  assert.equal(r.status, 422);
});

test('salvarMatrizLote: upsert + bump de versão do plano afetado', async () => {
  const sb = mockSb();
  const r = await svc.salvarMatrizLote(sb, [{ plano_id: 'p1', funcionalidade_id: 'f1', disponibilidade: 'incluida' }], 'ator');
  assert.equal(r.status, 200);
  assert.equal(r.body.salvos, 1);
  assert.ok(sb._calls.upserts.length >= 1);
  // versão do plano incrementada (1 -> 2)
  assert.ok(sb._calls.updates.some((u) => u.t === 'planos' && u.p.matriz_funcionalidades_versao === 2));
});

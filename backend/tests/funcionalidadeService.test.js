const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarMatrizPublicaPorPlano } = require('../services/funcionalidadeService');

function mock({ funcs = [], pfs = [], erro = null }) {
  return {
    from(t) {
      const b = {
        select() { return b; },
        eq() { return b; },
        then(resolve) {
          if (erro) return resolve({ data: null, error: erro });
          if (t === 'funcionalidades') return resolve({ data: funcs, error: null });
          if (t === 'plano_funcionalidades') return resolve({ data: pfs, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  };
}

const FUNCS = [
  { id: 'f1', codigo: 'gestao_fretes', nome: 'Gestão de fretes', status_ciclo_vida: 'disponivel', ativo: true, visivel_publicamente: true, ordem_exibicao: 1 },
  { id: 'f2', codigo: 'erp_api', nome: 'Integração ERP', status_ciclo_vida: 'planejada', ativo: true, visivel_publicamente: true, ordem_exibicao: 2 },
];

test('matriz pública: mapeia planoId → funcionalidades rotuladas', async () => {
  const r = await carregarMatrizPublicaPorPlano(mock({
    funcs: FUNCS,
    pfs: [
      { plano_id: 'p1', funcionalidade_id: 'f1', disponibilidade: 'incluida', exibir_no_card: true, ordem_exibicao: 1 },
      { plano_id: 'p1', funcionalidade_id: 'f2', disponibilidade: 'em_breve', exibir_no_card: true, ordem_exibicao: 2 },
    ],
  }));
  assert.deepEqual(r.p1.map((i) => [i.codigo, i.rotulo]), [
    ['gestao_fretes', 'Incluído'],
    ['erp_api', 'Em breve'],
  ]);
});

test('matriz pública: tabela ausente (pré-migration) → {} (deploy-safe)', async () => {
  const r = await carregarMatrizPublicaPorPlano(mock({ erro: { code: '42P01', message: 'relation does not exist' } }));
  assert.deepEqual(r, {});
});

test('matriz pública: plano sem funcionalidades não aparece no mapa', async () => {
  const r = await carregarMatrizPublicaPorPlano(mock({ funcs: FUNCS, pfs: [] }));
  assert.deepEqual(r, {});
});

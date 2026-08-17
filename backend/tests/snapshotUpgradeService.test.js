const test = require('node:test');
const assert = require('node:assert/strict');

const { montarSnapshotUpgrade, ADDON_PADRAO_CENTAVOS } = require('../services/snapshotUpgradeService');

const START = { id: 'start', nome: 'Empresa Start', preco_mensal: 299.9, capacidade_inclusa: 5, requer_negociacao: false };
const GROWTH = { id: 'growth', nome: 'Empresa Growth', preco_mensal: 799.9, capacidade_inclusa: 20, requer_negociacao: false };
const SCALE = { id: 'scale', nome: 'Empresa Scale', preco_mensal: 1199.9, capacidade_inclusa: 40, requer_negociacao: false };

const ADDONS = [
  { codigo: 'estrutura_operacional', nome: 'Estrutura operacional', em_breve: false },
  { codigo: 'integracoes_erp', nome: 'Integrações ERP', em_breve: true },
];

test('add-on padrão custa R$149,90 e incluído custa 0', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: ADDONS,
    selecionados: ['estrutura_operacional', 'integracoes_erp'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga'], ['integracoes_erp', 'opcional_paga']]),
  });
  assert.equal(r.ok, true);
  assert.equal(ADDON_PADRAO_CENTAVOS, 14990);
  assert.equal(r.snapshot.add_on_valor_padrao, 149.9);
  // 2 add-ons opcional_paga selecionados → 2 × 149,90 = 299,80
  assert.equal(r.snapshot.subtotal_addons_atual, 299.8);
  assert.equal(r.snapshot.subtotal_plano_atual, 799.9);
  assert.equal(r.snapshot.total_atual, 1099.7);
});

test('add-on incluído no plano não soma valor', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: SCALE,
    quantidade: 30,
    addons: ADDONS,
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'incluida']]),
  });
  assert.equal(r.snapshot.subtotal_addons_atual, 0);
  assert.equal(r.snapshot.add_ons[0].atual.situacao, 'incluido');
  assert.equal(r.snapshot.add_ons[0].atual.valor_mensal, 0);
});

test('recomenda subir de plano quando o alvo inclui os add-ons e sai <= atual', () => {
  // Growth + estrutura(adicional 149,90) = 949,80. Scale (1199,90) inclui → NÃO é <=,
  // então mantém. Ajustamos: alvo mais barato hipotético para exercitar 'subir_plano'.
  const ALVO_BARATO = { id: 'alvo', nome: 'Plano Alvo', preco_mensal: 900, capacidade_inclusa: 40, requer_negociacao: false };
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    planoAlvo: ALVO_BARATO,
    quantidade: 10,
    addons: [ADDONS[0]],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
    dispAlvo: new Map([['estrutura_operacional', 'incluida']]),
  });
  // atual: 799,90 + 149,90 = 949,80 ; alvo: 900 + 0 = 900 → 900 <= 949,80 → subir
  assert.equal(r.snapshot.total_atual, 949.8);
  assert.equal(r.snapshot.total_alvo, 900);
  assert.equal(r.snapshot.diferenca_mensal, -49.8);
  assert.equal(r.snapshot.recomendacao.tipo, 'subir_plano');
});

test('mantém plano + add-on quando é mais barato que subir', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: START,
    planoAlvo: SCALE,
    quantidade: 5,
    addons: [ADDONS[0]],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
    dispAlvo: new Map([['estrutura_operacional', 'incluida']]),
  });
  // atual: 299,90 + 149,90 = 449,80 ; alvo Scale: 1199,90 → manter é mais barato
  assert.equal(r.snapshot.recomendacao.tipo, 'manter_plano_addon');
  assert.equal(r.snapshot.total_atual, 449.8);
});

test('sob proposta quando add-on é sob_negociacao', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: [{ codigo: 'acesso_corporativo_sso', nome: 'SSO', em_breve: true }],
    selecionados: ['acesso_corporativo_sso'],
    dispAtual: new Map([['acesso_corporativo_sso', 'sob_negociacao']]),
  });
  assert.equal(r.snapshot.add_ons[0].atual.situacao, 'sob_proposta');
  assert.equal(r.snapshot.recomendacao.tipo, 'sob_proposta');
  // sob_proposta não soma valor
  assert.equal(r.snapshot.subtotal_addons_atual, 0);
});

test('nunca gera cobrança agora (proxima_fatura)', () => {
  const r = montarSnapshotUpgrade({ planoAtual: GROWTH, quantidade: 10, addons: [], selecionados: [] });
  assert.equal(r.snapshot.proxima_fatura.gera_cobranca_agora, false);
});

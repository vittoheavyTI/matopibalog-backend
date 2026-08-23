const test = require('node:test');
const assert = require('node:assert/strict');

const { montarSnapshotUpgrade, resolverPrecoAddon, estadoCapacidade, PRICE_STATUS } = require('../services/snapshotUpgradeService');

const START = { id: 'start', nome: 'Empresa Start', preco_mensal: 299.9, capacidade_inclusa: 5, requer_negociacao: false };
const GROWTH = { id: 'growth', nome: 'Empresa Growth', preco_mensal: 799.9, capacidade_inclusa: 20, requer_negociacao: false };
const SCALE = { id: 'scale', nome: 'Empresa Scale', preco_mensal: 1199.9, capacidade_inclusa: 40, requer_negociacao: false };

// Add-ons: estrutura tem preço padrão APROVADO (14990); ERP/SSO NÃO têm (null).
const ESTRUTURA = { codigo: 'estrutura_operacional', nome: 'Estrutura operacional', em_breve: false, preco_padrao_centavos: 14990 };
const ERP = { codigo: 'integracoes_erp', nome: 'Integrações ERP', em_breve: true, preco_padrao_centavos: null };
const SSO = { codigo: 'acesso_corporativo_sso', nome: 'SSO', em_breve: true, preco_padrao_centavos: null };

test('estrutura (com preço padrão aprovado) custa o valor de tabela', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: [ESTRUTURA],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.add_ons[0].atual.situacao, 'adicional');
  assert.equal(r.snapshot.add_ons[0].atual.valor_mensal, 149.9);
  assert.equal(r.snapshot.add_ons[0].atual.price_status, PRICE_STATUS.KNOWN);
  assert.equal(r.snapshot.subtotal_addons_atual, 149.9);
  assert.equal(r.snapshot.total_atual, 949.8); // 799,90 + 149,90
  assert.equal(r.snapshot.total_atual_incompleto, false);
});

test('ERP sem preço aprovado NÃO é fabricado — vira sob proposta', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: [ERP],
    selecionados: ['integracoes_erp'],
    dispAtual: new Map([['integracoes_erp', 'opcional_paga']]),
  });
  const linha = r.snapshot.add_ons[0];
  assert.equal(linha.atual.situacao, 'sob_proposta');
  assert.equal(linha.atual.valor_mensal, null); // nunca 149,90
  assert.equal(linha.atual.price_status, PRICE_STATUS.UNDER_PROPOSAL);
  assert.equal(linha.atual.commercial_status, 'UNDER_PROPOSAL');
  assert.equal(linha.technical_status, 'PREPARING');
  // total incompleto — sem economia fantasma
  assert.equal(r.snapshot.total_atual, null);
  assert.equal(r.snapshot.total_atual_incompleto, true);
  assert.equal(r.snapshot.recomendacao.tipo, 'sob_proposta');
});

test('SSO sob_negociacao segue sob proposta (sem valor)', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: [SSO],
    selecionados: ['acesso_corporativo_sso'],
    dispAtual: new Map([['acesso_corporativo_sso', 'sob_negociacao']]),
  });
  assert.equal(r.snapshot.add_ons[0].atual.situacao, 'sob_proposta');
  assert.equal(r.snapshot.add_ons[0].atual.valor_mensal, null);
  assert.equal(r.snapshot.subtotal_addons_atual, 0);
  assert.equal(r.snapshot.total_atual, null);
});

test('preço específico do plano tem prioridade sobre o padrão', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    quantidade: 10,
    addons: [ESTRUTURA],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
    precoEspecificoAtual: new Map([['estrutura_operacional', 9990]]),
  });
  assert.equal(r.snapshot.add_ons[0].atual.valor_mensal, 99.9);
  assert.equal(r.snapshot.total_atual, 899.8); // 799,90 + 99,90
});

test('add-on incluído no plano não soma valor', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: SCALE,
    quantidade: 30,
    addons: [ESTRUTURA],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'incluida']]),
  });
  assert.equal(r.snapshot.subtotal_addons_atual, 0);
  assert.equal(r.snapshot.add_ons[0].atual.situacao, 'incluido');
  assert.equal(r.snapshot.add_ons[0].atual.valor_mensal, 0);
  assert.equal(r.snapshot.add_ons[0].atual.price_status, PRICE_STATUS.INCLUDED);
});

test('recomenda subir de plano quando o alvo inclui os add-ons e sai <= atual', () => {
  const ALVO_BARATO = { id: 'alvo', nome: 'Plano Alvo', preco_mensal: 900, capacidade_inclusa: 40, requer_negociacao: false };
  const r = montarSnapshotUpgrade({
    planoAtual: GROWTH,
    planoAlvo: ALVO_BARATO,
    quantidade: 10,
    addons: [ESTRUTURA],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
    dispAlvo: new Map([['estrutura_operacional', 'incluida']]),
  });
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
    addons: [ESTRUTURA],
    selecionados: ['estrutura_operacional'],
    dispAtual: new Map([['estrutura_operacional', 'opcional_paga']]),
    dispAlvo: new Map([['estrutura_operacional', 'incluida']]),
  });
  assert.equal(r.snapshot.recomendacao.tipo, 'manter_plano_addon');
  assert.equal(r.snapshot.total_atual, 449.8); // 299,90 + 149,90
});

test('sem economia fantasma: alvo com add-on sob proposta não gera diferença', () => {
  const r = montarSnapshotUpgrade({
    planoAtual: START,
    planoAlvo: GROWTH,
    quantidade: 5,
    addons: [ERP],
    selecionados: ['integracoes_erp'],
    dispAtual: new Map([['integracoes_erp', 'opcional_paga']]),
    dispAlvo: new Map([['integracoes_erp', 'opcional_paga']]),
  });
  assert.equal(r.snapshot.total_atual, null);
  assert.equal(r.snapshot.total_alvo, null);
  assert.equal(r.snapshot.diferenca_mensal, null);
  assert.equal(r.snapshot.recomendacao.tipo, 'sob_proposta');
});

test('nunca gera cobrança agora (proxima_fatura)', () => {
  const r = montarSnapshotUpgrade({ planoAtual: GROWTH, quantidade: 10, addons: [], selecionados: [] });
  assert.equal(r.snapshot.proxima_fatura.gera_cobranca_agora, false);
});

test('estadoCapacidade: contagem real, sem porcentagem arbitrária', () => {
  assert.equal(estadoCapacidade(5, null), 'ilimitado');
  assert.equal(estadoCapacidade(21, 20), 'acima');
  assert.equal(estadoCapacidade(20, 20), 'no_limite');
  assert.equal(estadoCapacidade(19, 20), 'proximo');
  assert.equal(estadoCapacidade(12, 20), 'confortavel');
  assert.equal(estadoCapacidade(0, 1), 'proximo');
});

test('resolverPrecoAddon: contrato price_status', () => {
  assert.equal(resolverPrecoAddon('incluida').price_status, PRICE_STATUS.INCLUDED);
  assert.equal(resolverPrecoAddon('opcional_paga', { precoPadraoCentavos: 14990 }).price_status, PRICE_STATUS.KNOWN);
  assert.equal(resolverPrecoAddon('opcional_paga', { precoPadraoCentavos: null }).price_status, PRICE_STATUS.UNDER_PROPOSAL);
  assert.equal(resolverPrecoAddon('sob_negociacao').price_status, PRICE_STATUS.UNDER_PROPOSAL);
  assert.equal(resolverPrecoAddon('indisponivel').price_status, PRICE_STATUS.NOT_AVAILABLE);
});

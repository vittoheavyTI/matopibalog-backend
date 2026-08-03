const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPropostaEContrato } = require('../services/contratacaoComercialService');
const { hashConteudo } = require('../services/contratoModeloDomainService');

const plano = {
  id: 'plano-1',
  nome: 'Empresa Start',
  preco_mensal: 299.9,
  dias_trial: 14,
  limite_motoristas: 5,
  capacidade_inclusa: 5,
  valor_implantacao: 0,
};

// Mock que devolve um modelo publicado para 'contrato_modelos' e registra inserts.
function mockComModelo(modelo) {
  const inserts = [];
  const supabase = {
    inserts,
    from(tabela) {
      if (tabela === 'contrato_modelos') {
        const api = { select() { return api; }, eq() { return api; }, maybeSingle: async () => ({ data: modelo, error: null }) };
        return api;
      }
      return {
        insert(payload) {
          inserts.push({ tabela, payload });
          return { select() { return { single: async () => ({ data: { id: `${tabela}-id`, ...payload }, error: null }) }; } };
        },
      };
    },
  };
  return supabase;
}

test('criarPropostaEContrato: congela o modelo vigente do plano no contrato', async () => {
  const conteudo = 'CLAUSULA 1. Objeto do contrato do plano Start...';
  const modelo = { id: 'modelo-99', plano_id: 'plano-1', versao: 4, status: 'publicado', conteudo, conteudo_hash: hashConteudo(conteudo) };
  const supabase = mockComModelo(modelo);

  await criarPropostaEContrato({
    supabase,
    empresa: { id: 'emp-1', nome: 'Empresa Teste' },
    responsavel: { nome: 'Ana', email: 'ana@example.com' },
    plano,
    criadoPor: 'user-1',
  });

  const contrato = supabase.inserts.find((i) => i.tabela === 'contratos_comerciais').payload;
  assert.equal(contrato.modelo_id, 'modelo-99');
  assert.equal(contrato.modelo_versao, 4);
  assert.equal(contrato.modelo_conteudo_snapshot, conteudo);
  assert.equal(contrato.modelo_conteudo_hash, hashConteudo(conteudo));
  assert.equal(contrato.metadata.modelo_vigente, 'congelado');
});

test('criarPropostaEContrato: sem modelo vigente → fallback (colunas de modelo ausentes)', async () => {
  const supabase = mockComModelo(null);
  await criarPropostaEContrato({
    supabase,
    empresa: { id: 'emp-1', nome: 'Empresa Teste' },
    responsavel: { nome: 'Ana', email: 'ana@example.com' },
    plano,
    criadoPor: 'user-1',
  });

  const contrato = supabase.inserts.find((i) => i.tabela === 'contratos_comerciais').payload;
  assert.equal(contrato.modelo_id, undefined);
  assert.equal(contrato.modelo_conteudo_snapshot, undefined);
  assert.equal(contrato.metadata.modelo_vigente, 'ausente_fallback_texto_tecnico');
});

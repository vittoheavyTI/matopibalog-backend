const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MockAssinaturaProvider,
} = require('../services/assinaturaProvider');
const {
  deveCriarFaturaImplantacao,
  hashConteudo,
  montarContratoTecnico,
  montarSnapshotProposta,
} = require('../services/contratacaoComercialDomainService');

const PLANO_ZERO = {
  id: 'plano-1',
  nome: 'Empresa Start',
  preco_mensal: 299.9,
  dias_trial: 7,
  capacidade_inclusa: 5,
  preco_motorista_extra: 100,
  valor_implantacao: 0,
};

test('proposta: implantacao zero fica gratis, congelada e sem fatura zero', () => {
  const r = montarSnapshotProposta({ plano: PLANO_ZERO, quantidadeContratada: 5 });

  assert.equal(r.ok, true);
  assert.equal(r.proposta.valor_implantacao, 0);
  assert.equal(r.proposta.implantacao_gratis, true);
  assert.equal(r.proposta.total_inicial, 0);
  assert.equal(r.proposta.cobranca_implantacao, 'nao_criar_fatura_zero');
  assert.deepEqual(deveCriarFaturaImplantacao(r.proposta), { criar: false, motivo: 'implantacao_gratis_ou_zero' });
});

test('proposta: override positivo exige motivo de auditoria', () => {
  const semMotivo = montarSnapshotProposta({
    plano: PLANO_ZERO,
    overrideImplantacaoValor: 500,
    overrideImplantacaoMotivo: 'curto',
  });
  assert.equal(semMotivo.ok, false);
  assert.equal(semMotivo.motivo, 'implantacao_override_sem_motivo');

  const comMotivo = montarSnapshotProposta({
    plano: PLANO_ZERO,
    overrideImplantacaoValor: 500,
    overrideImplantacaoMotivo: 'proposta aprovada pelo proprietario',
    overridePor: 'user-1',
  });
  assert.equal(comMotivo.ok, true);
  assert.equal(comMotivo.proposta.valor_implantacao, 500);
  assert.equal(comMotivo.proposta.cobranca_implantacao, 'cobranca_avulsa_separada');
  assert.deepEqual(deveCriarFaturaImplantacao(comMotivo.proposta), {
    criar: true,
    motivo: 'implantacao_positiva_autorizada',
    valor: 500,
  });
});

test('contrato tecnico gera hash estavel sem criar texto juridico definitivo', () => {
  const proposta = montarSnapshotProposta({ plano: PLANO_ZERO, quantidadeContratada: 5 }).proposta;
  const contrato = montarContratoTecnico({
    empresa: { nome: 'Empresa Teste' },
    responsavel: { nome: 'Responsavel Teste' },
    proposta,
  });

  assert.equal(contrato.content_hash, hashConteudo(contrato.conteudo));
  assert.match(contrato.conteudo, /pendente_revisao_juridica|revisado pelo proprietário e advogado/);
});

test('provider mock registra envelope sem acoplar Clicksign ao dominio', async () => {
  const provider = new MockAssinaturaProvider({ provider_ref: 'env-123' });
  const r = await provider.criarEnvelope({ contrato_id: 'contrato-1' });

  assert.equal(r.provider, 'mock');
  assert.equal(r.provider_ref, 'env-123');
  assert.equal(provider.chamadas.length, 1);
});

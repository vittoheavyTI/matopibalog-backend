const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  montarSnapshotProposta,
} = require('../services/contratacaoComercialDomainService');
const {
  montarDetalheContrato,
} = require('../services/contratosAdminListDomainService');

// §6/§27 — o snapshot comercial é IMUTÁVEL: gerado no aceite, congela os valores
// do plano naquele instante. Alterar o plano depois NÃO reescreve contratos já
// emitidos. Aqui provamos isso ponta a ponta no domínio (sem I/O):
//   1) gera snapshot do plano;
//   2) altera o objeto do plano (preço/implantação/trial/capacidade);
//   3) o snapshot original permanece com os valores antigos;
//   4) o detalhe do contrato lê o snapshot, nunca o plano vigente.

function planoStart() {
  return {
    id: 'plano-start',
    nome: 'Empresa Start',
    preco_mensal: 299.9,
    capacidade_inclusa: 5,
    preco_motorista_extra: 100,
    limite_motoristas: 40,
    dias_trial: 14,
    valor_implantacao: 0,
  };
}

test('snapshot congela plano_nome/valores no momento do aceite', () => {
  const plano = planoStart();
  const r = montarSnapshotProposta({ plano, trialDias: plano.dias_trial });
  assert.equal(r.ok, true);
  const snap = r.proposta;
  assert.equal(snap.plano_nome, 'Empresa Start');
  assert.equal(snap.valor_mensal, 299.9);
  assert.equal(snap.trial_dias, 14);
  assert.equal(snap.capacidade_inclusa, 5);
  assert.equal(snap.preco_motorista_extra, 100);
});

test('alterar o plano DEPOIS não muda o snapshot já gerado', () => {
  const plano = planoStart();
  const r = montarSnapshotProposta({ plano, trialDias: plano.dias_trial });
  const snap = r.proposta;

  // Super-admin reprecifica o plano mais tarde.
  plano.nome = 'Empresa Start (Reajustado)';
  plano.preco_mensal = 399.9;
  plano.dias_trial = 30;
  plano.capacidade_inclusa = 8;
  plano.preco_motorista_extra = 120;

  // O snapshot é uma cópia de valores primitivos — permanece intacto.
  assert.equal(snap.plano_nome, 'Empresa Start');
  assert.equal(snap.valor_mensal, 299.9);
  assert.equal(snap.trial_dias, 14);
  assert.equal(snap.capacidade_inclusa, 5);
  assert.equal(snap.preco_motorista_extra, 100);

  // Um snapshot novo (novo contrato) reflete o plano vigente — prova que a diferença
  // é real e o congelamento é por-contrato.
  const r2 = montarSnapshotProposta({ plano, trialDias: plano.dias_trial });
  assert.equal(r2.proposta.valor_mensal, 399.9);
  assert.equal(r2.proposta.trial_dias, 30);
});

test('detalhe do contrato exibe o snapshot congelado, não o plano vigente', () => {
  const plano = planoStart();
  const snap = montarSnapshotProposta({ plano, trialDias: plano.dias_trial }).proposta;

  // Contrato emitido com o snapshot congelado.
  const rowContrato = {
    id: 'contrato-1',
    empresa_id: 'emp-1',
    proposta_id: 'prop-1',
    status: 'plenamente_assinado',
    template_version: snap.template_version,
    content_hash: 'a'.repeat(64),
    criado_em: '2026-08-01T10:00:00.000Z',
    empresas: { nome: 'Empresa Alfa', tipo: 'transportadora' },
    propostas_comerciais: { id: 'prop-1', snapshot: snap, valor_mensal: snap.valor_mensal, valor_implantacao: snap.valor_implantacao, trial_dias: snap.trial_dias },
    contrato_signatarios: [],
    contrato_eventos: [],
  };

  // Plano muda depois.
  plano.preco_mensal = 999.9;

  const d = montarDetalheContrato(rowContrato);
  assert.equal(d.plano_nome, 'Empresa Start');
  assert.equal(d.valor_mensal, 299.9); // do snapshot, não do plano vigente (999.9)
  assert.equal(d.trial_dias, 14);
  assert.equal(d.snapshot.valor_mensal, 299.9);
});

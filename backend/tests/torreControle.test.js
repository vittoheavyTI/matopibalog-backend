const test = require('node:test');
const assert = require('node:assert/strict');
const { montarTorreControle } = require('../utils/torreControle');

const frete = (extra = {}) => ({
  id: extra.id || 'f-1',
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  data: extra.data || '2026-07-20',
  origem: 'Luis Eduardo Magalhaes',
  destino: 'Barreiras',
  placa: 'ABC1D23',
  status: 'ativo',
  valor_frete: 1000,
  motoristas: { usuarios: { nome: 'Motorista Um' } },
  ...extra,
});

const itemUnico = (entrada) => montarTorreControle(entrada).itens[0];

test('torre: atraso critico somente quando ha ocorrencia de atraso aberta', () => {
  const item = itemUnico({
    fretes: [frete()],
    ocorrencias: [{ id: 'o-1', frete_id: 'f-1', tipo: 'atraso', status: 'aberta' }],
    epods: [],
    evidencias: [],
  });

  assert.equal(item.nivel, 'critico');
  assert.equal(item.situacao, 'Atraso registrado');
  assert.equal(item.ocorrencias.atraso_aberto, true);
});

test('torre: frete antigo sem prazo canonico e sem ocorrencia nao vira atraso automatico', () => {
  const item = itemUnico({
    fretes: [frete({ data: '2020-01-01' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
  });

  assert.equal(item.nivel, 'ok');
  assert.equal(item.situacao, 'Em andamento');
});

test('torre: ePOD validado com rejeicao historica superada fica concluido', () => {
  const item = itemUnico({
    fretes: [frete({ status: 'finalizado' })],
    ocorrencias: [],
    epods: [{ id: 'epod-1', frete_id: 'f-1', status: 'validado' }],
    evidencias: [
      { id: 'ev-1', frete_id: 'f-1', status: 'aprovada' },
      { id: 'ev-2', frete_id: 'f-1', status: 'rejeitada' },
    ],
  });

  assert.equal(item.nivel, 'ok');
  assert.equal(item.situacao, 'Concluido');
  assert.equal(item.epod.evidencias_aprovadas, 1);
  assert.equal(item.epod.evidencias_rejeitadas, 1);
});

test('torre: finalizado sem ePOD validado entra em atencao', () => {
  const item = itemUnico({
    fretes: [frete({ status: 'finalizado' })],
    ocorrencias: [],
    epods: [{ id: 'epod-1', frete_id: 'f-1', status: 'parcial' }],
    evidencias: [
      { id: 'ev-1', frete_id: 'f-1', status: 'aprovada' },
      { id: 'ev-2', frete_id: 'f-1', status: 'pendente' },
    ],
  });

  assert.equal(item.nivel, 'atencao');
  assert.equal(item.situacao, 'ePOD pendente');
});

test('torre: cancelado permanece informativo', () => {
  const item = itemUnico({
    fretes: [frete({ status: 'cancelado' })],
    ocorrencias: [{ id: 'o-1', frete_id: 'f-1', tipo: 'atraso', status: 'resolvida' }],
    epods: [],
    evidencias: [],
  });

  assert.equal(item.nivel, 'informativo');
  assert.equal(item.situacao, 'Cancelado');
});

test('torre: resumo consolida prioridades e pendencias', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [
      frete({ id: 'f-1', status: 'ativo' }),
      frete({ id: 'f-2', status: 'finalizado' }),
      frete({ id: 'f-3', status: 'cancelado' }),
    ],
    ocorrencias: [{ id: 'o-1', frete_id: 'f-1', tipo: 'avaria', status: 'em_analise' }],
    epods: [{ id: 'epod-2', frete_id: 'f-2', status: 'registrado' }],
    evidencias: [{ id: 'ev-1', frete_id: 'f-2', status: 'pendente' }],
  });

  assert.equal(resumo.fretes_total, 3);
  assert.equal(resumo.criticos, 1);
  assert.equal(resumo.atencao, 1);
  assert.equal(resumo.informativos, 1);
  assert.equal(resumo.epods_pendentes, 1);
  assert.deepEqual(itens.map((i) => i.nivel), ['critico', 'atencao', 'informativo']);
});

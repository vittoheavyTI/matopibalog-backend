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
  assert.equal(item.situacao, 'Concluído');
  assert.equal(item.epod.evidencias_aprovadas, 1);
  assert.equal(item.epod.evidencias_rejeitadas, 1);
});

test('torre: finalizado sem ePOD registrado vira sem comprovacao informativa', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [frete({ status: 'finalizado' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
  });
  const item = itens[0];

  assert.equal(item.nivel, 'informativo');
  assert.equal(item.situacao, 'Sem comprovante');
  assert.equal(item.epod.status, 'sem_epod');
  assert.equal(item.epod.pendente_real, false);
  assert.equal(item.epod.sem_comprovacao, true);
  assert.equal(resumo.epods_pendentes, 0);
  assert.equal(resumo.sem_comprovacao, 1);
});

test('torre: ePOD existente com evidencia pendente entra como pendencia real', () => {
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
  assert.equal(item.situacao, 'Comprovação pendente');
  assert.equal(item.epod.pendente_real, true);
  assert.equal(item.epod.sem_comprovacao, false);
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
  assert.equal(item.epod.sem_comprovacao, false);
});

test('torre: validado nao conta pendencia mesmo com rejeicao historica regra B', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [frete({ status: 'finalizado' })],
    ocorrencias: [],
    epods: [{ id: 'epod-1', frete_id: 'f-1', status: 'validado' }],
    evidencias: [
      { id: 'ev-1', frete_id: 'f-1', status: 'rejeitada' },
      { id: 'ev-2', frete_id: 'f-1', status: 'aprovada' },
    ],
  });

  assert.equal(itens[0].nivel, 'ok');
  assert.equal(itens[0].epod.pendente_real, false);
  assert.equal(resumo.epods_pendentes, 0);
  assert.equal(resumo.sem_comprovacao, 0);
});

test('torre: cancelado sem ePOD nao conta sem comprovacao', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [frete({ status: 'cancelado' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
  });

  assert.equal(itens[0].nivel, 'informativo');
  assert.equal(resumo.sem_comprovacao, 0);
});

test('torre: ativo sem exigencia explicita de ePOD nao falha automaticamente', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [frete({ status: 'ativo' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
  });

  assert.equal(itens[0].nivel, 'ok');
  assert.equal(resumo.epods_pendentes, 0);
  assert.equal(resumo.sem_comprovacao, 0);
});

test('torre: localizacao interrompida em frete ativo vira atencao observacional', () => {
  const item = itemUnico({
    fretes: [frete({ status: 'ativo' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
    localizacaoEstados: [{
      frete_id: 'f-1',
      estado: 'interrompida',
      detalhe: 'Permissao ou GPS interrompeu o compartilhamento.',
      atualizado_em: new Date().toISOString(),
    }],
  });

  assert.equal(item.nivel, 'atencao');
  assert.equal(item.situacao, 'Localizacao interrompida');
  assert.equal(item.localizacao.estado, 'interrompida');
});

test('torre: frete pendente nao exige rastreamento ativo', () => {
  const item = itemUnico({
    fretes: [frete({ status: 'pendente' })],
    ocorrencias: [],
    epods: [],
    evidencias: [],
  });

  assert.equal(item.nivel, 'ok');
  assert.equal(item.localizacao.estado, null);
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
  assert.equal(resumo.sem_comprovacao, 0);
  assert.deepEqual(itens.map((i) => i.nivel), ['critico', 'atencao', 'informativo']);
});

test('torre: resumo bate exatamente com flags dos itens', () => {
  const { resumo, itens } = montarTorreControle({
    fretes: [
      frete({ id: 'f-1', status: 'finalizado' }),
      frete({ id: 'f-2', status: 'finalizado' }),
      frete({ id: 'f-3', status: 'finalizado' }),
    ],
    ocorrencias: [],
    epods: [
      { id: 'epod-2', frete_id: 'f-2', status: 'registrado' },
      { id: 'epod-3', frete_id: 'f-3', status: 'validado' },
    ],
    evidencias: [{ id: 'ev-1', frete_id: 'f-2', status: 'pendente' }],
  });

  assert.equal(resumo.epods_pendentes, itens.filter((i) => i.epod.pendente_real).length);
  assert.equal(resumo.sem_comprovacao, itens.filter((i) => i.epod.sem_comprovacao).length);
  assert.equal(resumo.fretes_total, itens.length);
});

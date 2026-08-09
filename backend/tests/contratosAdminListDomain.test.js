const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  estaAssinado,
  hashCurto,
  mapearContratoParaLista,
  filtrarLista,
  resumirPorStatus,
  montarListaContratos,
} = require('../services/contratosAdminListDomainService');

const HASH64 = 'a'.repeat(64);

function rowAssinado(over = {}) {
  return {
    id: 'c-assinado',
    empresa_id: 'emp-1',
    status: 'plenamente_assinado',
    obrigatorio: true,
    template_version: 'v3',
    content_hash: HASH64,
    signed_file_hash: 'b'.repeat(64),
    provider: 'interno_otp',
    signature_method: 'interno_otp',
    criado_em: '2026-08-01T10:00:00.000Z',
    document_fechado_em: '2026-08-01T09:00:00.000Z',
    aceito_em: '2026-08-02T12:00:00.000Z',
    empresas: { nome: 'Empresa Alfa', tipo: 'transportadora' },
    propostas_comerciais: { snapshot: { plano_nome: 'Empresa Start' }, valor_mensal: 299.9, valor_implantacao: 0 },
    contrato_signatarios: [
      { papel: 'cliente', status: 'assinado', assinado_em: '2026-08-02T11:00:00.000Z' },
      { papel: 'matopiba', status: 'assinado', assinado_em: '2026-08-02T11:30:00.000Z' },
    ],
    ...over,
  };
}

function rowPendente(over = {}) {
  return {
    id: 'c-pendente',
    empresa_id: 'emp-2',
    status: 'aguardando_assinatura_cliente',
    obrigatorio: true,
    template_version: 'v3',
    content_hash: HASH64,
    criado_em: '2026-08-05T10:00:00.000Z',
    empresas: { nome: 'Autônomo Beta', tipo: 'autonomo' },
    propostas_comerciais: { snapshot: { plano_nome: 'Autônomo Solo' }, valor_mensal: 99.9, valor_implantacao: 0 },
    contrato_signatarios: [],
    ...over,
  };
}

test('estaAssinado: usa STATUS_CONCLUIDOS do gate (mesma regra, sem reinventar)', () => {
  assert.equal(estaAssinado('plenamente_assinado'), true);
  assert.equal(estaAssinado('assinado'), true);
  assert.equal(estaAssinado('aceito_manualmente'), true);
  assert.equal(estaAssinado('aguardando_assinatura_cliente'), false);
  assert.equal(estaAssinado('cancelado'), false);
  assert.equal(estaAssinado(undefined), false);
});

test('hashCurto: encurta para 12 e trata nulo', () => {
  assert.equal(hashCurto(HASH64), 'aaaaaaaaaaaa');
  assert.equal(hashCurto(null), null);
  assert.equal(hashCurto(''), null);
  assert.equal(hashCurto('abc'), 'abc');
});

test('mapearContratoParaLista: extrai cliente, plano, valores, hash e assinaturas', () => {
  const item = mapearContratoParaLista(rowAssinado());
  assert.equal(item.contrato_id, 'c-assinado');
  assert.equal(item.cliente, 'Empresa Alfa');
  assert.equal(item.empresa_tipo, 'transportadora');
  assert.equal(item.plano_nome, 'Empresa Start');
  assert.equal(item.valor_mensal, 299.9);
  assert.equal(item.valor_implantacao, 0);
  assert.equal(item.assinado, true);
  assert.equal(item.obrigatorio, true);
  assert.equal(item.versao, 'v3');
  assert.equal(item.hash, HASH64);
  assert.equal(item.hash_curto, 'aaaaaaaaaaaa');
  assert.equal(item.assinatura_cliente_em, '2026-08-02T11:00:00.000Z');
  assert.equal(item.assinatura_matopiba_em, '2026-08-02T11:30:00.000Z');
  assert.equal(item.assinado_em, '2026-08-02T12:00:00.000Z');
});

test('mapearContratoParaLista: robusto a joins ausentes (empresa/proposta nulos)', () => {
  const item = mapearContratoParaLista({ id: 'x', empresa_id: 'e', status: 'rascunho' });
  assert.equal(item.cliente, null);
  assert.equal(item.plano_nome, null);
  assert.equal(item.valor_mensal, null);
  assert.equal(item.valor_implantacao, null);
  assert.equal(item.assinado, false);
  assert.equal(item.metodo_assinatura, 'manual');
});

test('mapearContratoParaLista: cai no snapshot quando proposta.valor_* ausente', () => {
  const item = mapearContratoParaLista(rowPendente({
    propostas_comerciais: { snapshot: { plano_nome: 'X', valor_mensal: 149.9, valor_implantacao: 500 } },
  }));
  assert.equal(item.valor_mensal, 149.9);
  assert.equal(item.valor_implantacao, 500);
});

test('filtrarLista: status assinado/pendente e status canônico exato', () => {
  const lista = [rowAssinado(), rowPendente()].map(mapearContratoParaLista);
  assert.equal(filtrarLista(lista, { status: 'assinado' }).length, 1);
  assert.equal(filtrarLista(lista, { status: 'assinado' })[0].contrato_id, 'c-assinado');
  assert.equal(filtrarLista(lista, { status: 'pendente' }).length, 1);
  assert.equal(filtrarLista(lista, { status: 'pendente' })[0].contrato_id, 'c-pendente');
  assert.equal(filtrarLista(lista, { status: 'aguardando_assinatura_cliente' }).length, 1);
  assert.equal(filtrarLista(lista, { status: 'todos' }).length, 2);
  assert.equal(filtrarLista(lista, {}).length, 2);
});

test('filtrarLista: pendente NÃO inclui cancelado', () => {
  const lista = [rowPendente({ id: 'c-canc', status: 'cancelado' }), rowPendente()].map(mapearContratoParaLista);
  const pend = filtrarLista(lista, { status: 'pendente' });
  assert.equal(pend.length, 1);
  assert.equal(pend[0].contrato_id, 'c-pendente');
});

test('filtrarLista: plano e cliente por substring case-insensitive', () => {
  const lista = [rowAssinado(), rowPendente()].map(mapearContratoParaLista);
  assert.equal(filtrarLista(lista, { plano: 'start' }).length, 1);
  assert.equal(filtrarLista(lista, { cliente: 'beta' })[0].contrato_id, 'c-pendente');
  assert.equal(filtrarLista(lista, { cliente: 'emp-1' })[0].contrato_id, 'c-assinado');
});

test('filtrarLista: período de/ate inclusivo sobre criado_em', () => {
  const lista = [rowAssinado(), rowPendente()].map(mapearContratoParaLista);
  // rowAssinado 2026-08-01, rowPendente 2026-08-05
  assert.equal(filtrarLista(lista, { de: '2026-08-03T00:00:00.000Z' }).length, 1);
  assert.equal(filtrarLista(lista, { de: '2026-08-03T00:00:00.000Z' })[0].contrato_id, 'c-pendente');
  assert.equal(filtrarLista(lista, { ate: '2026-08-03T00:00:00.000Z' }).length, 1);
  assert.equal(filtrarLista(lista, { ate: '2026-08-03T00:00:00.000Z' })[0].contrato_id, 'c-assinado');
  assert.equal(filtrarLista(lista, { de: '2026-07-01', ate: '2026-09-01' }).length, 2);
});

test('resumirPorStatus: conta assinados, pendentes, cancelados, obrigatórios pendentes', () => {
  const lista = [
    rowAssinado(),
    rowPendente(),
    rowPendente({ id: 'c-canc', status: 'cancelado' }),
    rowPendente({ id: 'c-pend-nao-obrig', obrigatorio: false }),
  ].map(mapearContratoParaLista);
  const r = resumirPorStatus(lista);
  assert.equal(r.total, 4);
  assert.equal(r.assinados, 1);
  assert.equal(r.pendentes, 2);
  assert.equal(r.cancelados, 1);
  assert.equal(r.obrigatorios_pendentes, 1);
});

test('montarListaContratos: ordena por criado_em desc e devolve resumo', () => {
  const out = montarListaContratos({ rows: [rowAssinado(), rowPendente()] });
  assert.equal(out.contratos.length, 2);
  // pendente (08-05) vem antes de assinado (08-01)
  assert.equal(out.contratos[0].contrato_id, 'c-pendente');
  assert.equal(out.contratos[1].contrato_id, 'c-assinado');
  assert.equal(out.resumo.total, 2);
  assert.equal(out.total_sem_filtro, 2);
});

test('montarListaContratos: aplica filtro e mantém total_sem_filtro', () => {
  const out = montarListaContratos({ rows: [rowAssinado(), rowPendente()], filtros: { status: 'assinado' } });
  assert.equal(out.contratos.length, 1);
  assert.equal(out.total_sem_filtro, 2);
  assert.equal(out.resumo.assinados, 1);
});

test('montarListaContratos: entrada vazia/inválida não quebra', () => {
  assert.deepEqual(montarListaContratos().contratos, []);
  assert.deepEqual(montarListaContratos({ rows: null }).contratos, []);
  assert.equal(montarListaContratos({ rows: [] }).resumo.total, 0);
});

// Frente #5 (Billing v2) — PR 2: regras puras de domínio da fatura recorrente.
// Prova das decisões:
//   * periodo_referencia sempre no dia 1 (compatível com o CHECK dia-1 da 031);
//   * só empresa 'ativo' com plano pago, customer Asaas e sem recorrente no
//     período é cobrável; trial/suspenso, assinatura Asaas, customer ausente,
//     plano inválido/gratuito e recorrente já existente → pular;
//   * upgrade/manual/origem NULL no mesmo mês NÃO bloqueiam (espelho do índice
//     único parcial da 031);
//   * payload usa origem='recorrente', período dia-1, client_request_id
//     determinístico, valor = preco_mensal (nunca recalculado);
//   * snapshot em PARIDADE comportamental com upgradeRequestService.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MOTIVOS,
  ORIGEM_RECORRENTE,
  calcularPeriodoReferencia,
  calcularDueDate,
  montarClientRequestId,
  montarSnapshotFaturaRecorrente,
  avaliarElegibilidadeFaturaRecorrente,
  montarPayloadFaturaRecorrente,
} = require('../services/faturaRecorrenteDomainService');

// A função canônica de snapshot vive no serviço de upgrade (com I/O). Importada
// SÓ no teste, para provar paridade — o serviço puro não a importa.
const { montarSnapshotFatura } = require('../services/upgradeRequestService');

// ─── Planos de referência (espelham o catálogo de produção) ──────────────────
const PLANO_FIXO = {
  id: 'p-pro',
  nome: 'Plano Profissional',
  ativo: true,
  arquivado_em: null,
  preco_mensal: 149.99,
  modelo_cobranca: 'fixo',
  preco_por_motorista: null,
  limite_motoristas: 10,
};
const PLANO_POR_MOTORISTA = {
  id: 'p-pm',
  nome: 'Plano por Motorista',
  ativo: true,
  arquivado_em: null,
  preco_mensal: 1000.0, // 100,00 × 10 (valor final já derivado pelo backend)
  modelo_cobranca: 'por_motorista',
  preco_por_motorista: 100.0,
  limite_motoristas: 10,
};
const EMPRESA_OK = {
  id: 'e1',
  status: 'ativo',
  asaas_customer_id: 'cus_123',
  asaas_subscription_id: null,
};

// ─── 1. calcularPeriodoReferencia sempre dia 1 ───────────────────────────────
test('calcularPeriodoReferencia retorna sempre o dia 1 do mês', () => {
  assert.equal(calcularPeriodoReferencia('2026-07-20'), '2026-07-01');
  assert.equal(calcularPeriodoReferencia('2026-07-01'), '2026-07-01');
  assert.equal(calcularPeriodoReferencia('2026-07-31T23:59:59Z'), '2026-07-01');
  assert.equal(calcularPeriodoReferencia('2026-12-31'), '2026-12-01'); // virada de ano
  assert.equal(calcularPeriodoReferencia(new Date('2026-02-15T12:00:00Z')), '2026-02-01');
});

test('calcularPeriodoReferencia devolve null para data inválida', () => {
  assert.equal(calcularPeriodoReferencia('nao-e-data'), null);
  assert.equal(calcularPeriodoReferencia(null), null);
  assert.equal(calcularPeriodoReferencia(undefined), null);
});

// ─── 2. caminho feliz: cobrar ────────────────────────────────────────────────
test('ativa + plano pago + customer + sem recorrente no período → cobrar', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK,
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'cobrar');
  assert.equal(r.elegivel, true);
  assert.equal(r.motivo, MOTIVOS.OK);
  assert.equal(r.periodo, '2026-07-01');
});

// ─── 3. trial não cobra ──────────────────────────────────────────────────────
test('trial → pular (status não cobrável)', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, status: 'trial' },
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'pular');
  assert.equal(r.motivo, MOTIVOS.STATUS_NAO_COBRAVEL);
  assert.equal(r.elegivel, false);
  assert.equal(r.status, 'trial');
});

// ─── 3.5 conta arquivada não cobra (mega-frente higiene) ─────────────────────
test('empresa arquivada → pular (empresa_arquivada), mesmo ativa e elegível', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, arquivada_em: '2026-07-24T00:00:00Z' },
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'pular');
  assert.equal(r.motivo, MOTIVOS.EMPRESA_ARQUIVADA);
  assert.equal(r.elegivel, false);
});

test('arquivada_em ausente (coluna inexistente) NÃO pula por arquivamento', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK, // sem arquivada_em
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'cobrar');
});

// ─── 4. suspensa/desconhecida não cobra ──────────────────────────────────────
test('suspenso e status desconhecido → pular (fail-closed)', () => {
  for (const status of ['suspenso', 'bloqueado', 'expirado', 'qualquer', null]) {
    const r = avaliarElegibilidadeFaturaRecorrente({
      empresa: { ...EMPRESA_OK, status },
      plano: PLANO_FIXO,
      faturasExistentes: [],
      dataReferencia: '2026-07-20',
    });
    assert.equal(r.resultado, 'pular', `status=${status}`);
    assert.equal(r.motivo, MOTIVOS.STATUS_NAO_COBRAVEL, `status=${status}`);
  }
});

// ─── 5. assinatura Asaas existente não cobra ─────────────────────────────────
test('empresa com asaas_subscription_id → pular (evita duplicidade)', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, asaas_subscription_id: 'sub_999' },
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'pular');
  assert.equal(r.motivo, MOTIVOS.ASSINATURA_ASAAS_EXISTENTE);
});

// ─── 6. sem customer Asaas não cobra ─────────────────────────────────────────
test('empresa sem asaas_customer_id → pular (customer ausente)', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, asaas_customer_id: null },
    plano: PLANO_FIXO,
    faturasExistentes: [],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'pular');
  assert.equal(r.motivo, MOTIVOS.CUSTOMER_ASAAS_AUSENTE);
});

// ─── 7. plano gratuito / preço 0 não cobra ───────────────────────────────────
test('plano gratuito (preco_mensal <= 0) → pular', () => {
  for (const preco of [0, 0.0, -1]) {
    const r = avaliarElegibilidadeFaturaRecorrente({
      empresa: EMPRESA_OK,
      plano: { ...PLANO_FIXO, preco_mensal: preco },
      faturasExistentes: [],
      dataReferencia: '2026-07-20',
    });
    assert.equal(r.resultado, 'pular', `preco=${preco}`);
    assert.equal(r.motivo, MOTIVOS.PLANO_GRATUITO, `preco=${preco}`);
  }
});

// ─── 7.1 plano sob negociação (Enterprise) não cobra self-service ────────────
test('plano requer_negociacao=true → pular (plano_requer_negociacao), antes da checagem de preço', () => {
  // Mesmo com preço placeholder 0 (Enterprise real), o motivo é o específico, não
  // plano_gratuito — a trava vem antes da checagem de preço.
  for (const preco of [0, 299.9]) {
    const r = avaliarElegibilidadeFaturaRecorrente({
      empresa: EMPRESA_OK,
      plano: { ...PLANO_FIXO, preco_mensal: preco, requer_negociacao: true },
      faturasExistentes: [],
      dataReferencia: '2026-07-20',
    });
    assert.equal(r.resultado, 'pular', `preco=${preco}`);
    assert.equal(r.motivo, MOTIVOS.PLANO_REQUER_NEGOCIACAO, `preco=${preco}`);
  }
});

// ─── 7.2 quantidade contratada acima do teto não cobra (sob proposta) ────────
test('quantidade_contratada > teto → pular (quantidade_requer_negociacao); no teto e abaixo → cobrar', () => {
  const plano = { ...PLANO_FIXO, limite_negociacao: 40 };
  // 41 > 40 → sob proposta.
  const acima = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, quantidade_contratada: 41 },
    plano, faturasExistentes: [], dataReferencia: '2026-07-20',
  });
  assert.equal(acima.resultado, 'pular');
  assert.equal(acima.motivo, MOTIVOS.QUANTIDADE_REQUER_NEGOCIACAO);

  // Exatamente no teto (40) → ainda cobra (não é "acima").
  const noTeto = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, quantidade_contratada: 40 },
    plano, faturasExistentes: [], dataReferencia: '2026-07-20',
  });
  assert.equal(noTeto.resultado, 'cobrar');

  // Sem quantidade contratada → comportamento normal preservado (cobrar).
  const semQtd = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK, plano, faturasExistentes: [], dataReferencia: '2026-07-20',
  });
  assert.equal(semQtd.resultado, 'cobrar');

  // Teto padrão 40 quando o plano não declara limite_negociacao.
  const padrao = avaliarElegibilidadeFaturaRecorrente({
    empresa: { ...EMPRESA_OK, quantidade_contratada: 41 },
    plano: PLANO_FIXO, faturasExistentes: [], dataReferencia: '2026-07-20',
  });
  assert.equal(padrao.resultado, 'pular');
  assert.equal(padrao.motivo, MOTIVOS.QUANTIDADE_REQUER_NEGOCIACAO);
});

// ─── 8. plano inativo/arquivado/ausente não cobra ────────────────────────────
test('plano inativo, arquivado ou ausente → pular (plano inválido)', () => {
  const casos = [
    { ...PLANO_FIXO, ativo: false },
    { ...PLANO_FIXO, arquivado_em: '2026-01-01T00:00:00Z' },
    null,
  ];
  for (const plano of casos) {
    const r = avaliarElegibilidadeFaturaRecorrente({
      empresa: EMPRESA_OK,
      plano,
      faturasExistentes: [],
      dataReferencia: '2026-07-20',
    });
    assert.equal(r.resultado, 'pular');
    assert.equal(r.motivo, MOTIVOS.PLANO_INVALIDO);
  }
});

// ─── 9. recorrente já existente no período não cobra ─────────────────────────
test('fatura recorrente já existente no período → pular', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK,
    plano: PLANO_FIXO,
    faturasExistentes: [
      { origem: 'recorrente', periodo_referencia: '2026-07-01' },
    ],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'pular');
  assert.equal(r.motivo, MOTIVOS.FATURA_RECORRENTE_JA_EXISTE);
});

test('recorrente de OUTRO mês não bloqueia a competência atual', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK,
    plano: PLANO_FIXO,
    faturasExistentes: [
      { origem: 'recorrente', periodo_referencia: '2026-06-01' },
    ],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'cobrar');
});

// ─── 10. upgrade/manual/origem NULL no mesmo mês NÃO bloqueia ─────────────────
test('faturas de upgrade/manual/origem NULL no mesmo mês não bloqueiam recorrente', () => {
  const r = avaliarElegibilidadeFaturaRecorrente({
    empresa: EMPRESA_OK,
    plano: PLANO_FIXO,
    faturasExistentes: [
      { origem: null, periodo_referencia: null },                    // manual/importada
      { origem: 'upgrade', periodo_referencia: '2026-07-01' },       // hipotética de upgrade
      { origem: null, periodo_referencia: '2026-07-01' },            // avulsa com período (não recorrente)
    ],
    dataReferencia: '2026-07-20',
  });
  assert.equal(r.resultado, 'cobrar');
  assert.equal(r.motivo, MOTIVOS.OK);
});

// ─── 11 & 12. payload: origem e período ──────────────────────────────────────
test('payload usa origem=recorrente e periodo_referencia no dia 1', () => {
  const p = montarPayloadFaturaRecorrente({
    empresa: EMPRESA_OK,
    plano: PLANO_FIXO,
    dataReferencia: '2026-07-20',
  });
  assert.equal(p.origem, ORIGEM_RECORRENTE);
  assert.equal(p.origem, 'recorrente');
  assert.equal(p.periodo_referencia, '2026-07-01');
  assert.equal(p.tipo_pagamento, 'PIX');
  assert.equal(p.status, 'pendente');
  assert.equal(p.due_date, calcularDueDate('2026-07-20'));
  assert.equal(p.due_date, '2026-07-27'); // referência + 7 dias
});

// ─── 13. client_request_id determinístico ────────────────────────────────────
test('client_request_id é determinístico por empresa/período', () => {
  const p1 = montarPayloadFaturaRecorrente({ empresa: EMPRESA_OK, plano: PLANO_FIXO, dataReferencia: '2026-07-20' });
  const p2 = montarPayloadFaturaRecorrente({ empresa: EMPRESA_OK, plano: PLANO_FIXO, dataReferencia: '2026-07-05' });
  assert.equal(p1.client_request_id, 'recorrente:e1:2026-07');
  assert.equal(p1.client_request_id, p2.client_request_id); // mesmo mês → mesma chave
  assert.equal(montarClientRequestId('e1', '2026-07-01'), 'recorrente:e1:2026-07');
});

// ─── 14 & 15. snapshot fixo e por_motorista ──────────────────────────────────
test('snapshot fixo: unitário e quantidade NULL', () => {
  const s = montarSnapshotFaturaRecorrente(PLANO_FIXO);
  assert.equal(s.plano_id, 'p-pro');
  assert.equal(s.plano_nome_snapshot, 'Plano Profissional');
  assert.equal(s.modelo_cobranca_snapshot, 'fixo');
  assert.equal(s.preco_unitario_snapshot, null);
  assert.equal(s.quantidade_snapshot, null);
});

test('snapshot por_motorista: unitário=preco_por_motorista, quantidade=limite_motoristas', () => {
  const s = montarSnapshotFaturaRecorrente(PLANO_POR_MOTORISTA);
  assert.equal(s.modelo_cobranca_snapshot, 'por_motorista');
  assert.equal(s.preco_unitario_snapshot, 100.0);
  assert.equal(s.quantidade_snapshot, 10);
});

// Paridade comportamental com a função canônica do upgrade (decisão do PR 2).
test('snapshot em paridade com upgradeRequestService.montarSnapshotFatura', () => {
  for (const plano of [PLANO_FIXO, PLANO_POR_MOTORISTA, {}, { modelo_cobranca: 'por_motorista' }]) {
    assert.deepEqual(
      montarSnapshotFaturaRecorrente(plano),
      montarSnapshotFatura(plano),
      `divergência de snapshot para ${JSON.stringify(plano)}`
    );
  }
});

// ─── 16 & 17. valor preserva preco_mensal; não recalcula ─────────────────────
test('valor do payload preserva preco_mensal do plano (fixo)', () => {
  const p = montarPayloadFaturaRecorrente({ empresa: EMPRESA_OK, plano: PLANO_FIXO, dataReferencia: '2026-07-20' });
  assert.equal(p.valor, 149.99);
});

test('por_motorista: valor = preco_mensal derivado, NÃO recalculado de unitário×qtd', () => {
  // preco_mensal deliberadamente != preco_por_motorista × limite_motoristas para
  // provar que o serviço LÊ preco_mensal e não multiplica por conta própria.
  const planoDivergente = { ...PLANO_POR_MOTORISTA, preco_mensal: 777.77 };
  const p = montarPayloadFaturaRecorrente({ empresa: EMPRESA_OK, plano: planoDivergente, dataReferencia: '2026-07-20' });
  assert.equal(p.valor, 777.77);
  // O snapshot ainda registra a composição bruta, sem influenciar o valor.
  assert.equal(p.preco_unitario_snapshot, 100.0);
  assert.equal(p.quantidade_snapshot, 10);
});

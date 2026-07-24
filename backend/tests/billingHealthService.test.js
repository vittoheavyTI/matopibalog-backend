// Go-live PR2: agregação pura de billing health. Prova cada sinal a partir de
// listas controladas, sem I/O.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resumirBillingHealth } = require('../services/billingHealthService');

const HOJE = new Date('2026-07-22T12:00:00Z');

function fatura(over = {}) {
  return {
    id: 'f' + Math.random().toString(36).slice(2, 7),
    empresa_id: 'e1', status: 'pendente', valor: 149.9, origem: null,
    periodo_referencia: null, asaas_id: 'pay_x', invoice_url: 'https://s/i/x',
    bank_slip_url: null, due_date: '2026-08-01', pago_em: null, ...over,
  };
}

test('base saudável → ok=true e contadores zerados', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'pago', valor: 100 }), fatura({ status: 'pendente' })],
    empresas: [{ id: 'e1', nome: 'Alfa', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    webhookEvents: [{ event_type: 'PAYMENT_RECEIVED', status: 'processed', last_error: null }],
    hoje: HOJE,
  });
  assert.equal(r.ok, true);
  assert.equal(r.totais.total, 2);
  assert.equal(r.totais.pagas, 1);
  assert.equal(r.totais.total_pago, 100);
  assert.equal(r.totais.abertas, 1);
  for (const v of Object.values(r.contadores)) assert.equal(v, 0);
});

test('fatura ABERTA sem asaas_id é sinalizada (reserva órfã crítica)', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'pendente' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 1);
  assert.equal(r.detalhes.faturas_sem_asaas_id[0].origem, 'regularizacao');
  assert.equal(r.ok, false);
});

test('fatura VENCIDA sem asaas_id também entra no alerta crítico', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'vencido', due_date: '2026-07-01' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 1);
  assert.equal(r.ok, false);
});

test('fatura CANCELADA sem asaas_id NÃO entra no alerta crítico (vai p/ informativo)', () => {
  // Espelha a limpeza da migration 034: órfã soft-cancelada é inofensiva.
  const r = resumirBillingHealth({ faturas: [fatura({ asaas_id: null, origem: 'regularizacao', status: 'cancelado' })], hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 0, 'cancelada não é problema crítico');
  assert.equal(r.contadores.faturas_canceladas_sem_asaas_id, 1, 'entra no contador informativo');
  assert.equal(r.detalhes.faturas_canceladas_sem_asaas_id[0].status, 'cancelado');
  assert.equal(r.ok, true, 'órfã cancelada não derruba o ok');
});

test('cenário pós-034: 9 canceladas sem asaas_id + 0 abertas órfãs → ok=true', () => {
  const faturas = [];
  for (let i = 0; i < 9; i++) faturas.push(fatura({ asaas_id: null, origem: 'regularizacao', status: 'cancelado' }));
  // 4 regularizações reais com asaas_id, abertas
  for (let i = 0; i < 4; i++) faturas.push(fatura({ status: 'pendente', origem: 'regularizacao', asaas_id: 'pay_' + i }));
  const r = resumirBillingHealth({ faturas, hoje: HOJE });
  assert.equal(r.contadores.faturas_sem_asaas_id, 0);
  assert.equal(r.contadores.faturas_canceladas_sem_asaas_id, 9);
  assert.equal(r.ok, true);
});

test('fatura aberta sem link (nem invoice_url nem boleto) é sinalizada', () => {
  const r = resumirBillingHealth({ faturas: [fatura({ invoice_url: null, bank_slip_url: null })], hoje: HOJE });
  assert.equal(r.contadores.faturas_abertas_sem_link, 1);
});

test('vencida = aberta com due_date < hoje', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'vencido', due_date: '2026-07-01' }), fatura({ status: 'pendente', due_date: '2026-08-01' })],
    hoje: HOJE,
  });
  assert.equal(r.contadores.vencidas, 1);
  assert.equal(r.detalhes.vencidas[0].due_date, '2026-07-01');
});

test('duplicidade por empresa/origem/período > 1', () => {
  const r = resumirBillingHealth({
    faturas: [
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-07-01' }),
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-07-01' }),
      // mesma empresa, período diferente → não é duplicata
      fatura({ empresa_id: 'e1', origem: 'recorrente', periodo_referencia: '2026-08-01' }),
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.duplicidade, 1);
  assert.equal(r.detalhes.duplicidade[0].qtd, 2);
});

test('regularizacao da mesma competência para empresas diferentes NÃO é duplicidade', () => {
  const r = resumirBillingHealth({
    faturas: [
      fatura({ empresa_id: 'e1', origem: 'regularizacao', periodo_referencia: '2026-07-01' }),
      fatura({ empresa_id: 'e2', origem: 'regularizacao', periodo_referencia: '2026-07-01' }),
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.duplicidade, 0);
});

test('suspensa sem fatura aberta é sinalizada; suspensa com fatura aberta não', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ empresa_id: 'e2', status: 'pendente' })],
    empresas: [
      { id: 'e1', nome: 'SemFatura', tipo: 'autonomo', status: 'suspenso', suspension_reason: 'financial' },
      { id: 'e2', nome: 'ComFatura', tipo: 'autonomo', status: 'suspenso', suspension_reason: 'financial' },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspensas_sem_fatura, 1);
  assert.equal(r.detalhes.suspensas_sem_fatura[0].nome, 'SemFatura');
});

test('suspensa com fatura PAGA é sinalizada (bug de reativação, deveria ser 0)', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ empresa_id: 'e1', status: 'pago' })],
    empresas: [{ id: 'e1', nome: 'Presa', tipo: 'autonomo', status: 'suspenso', suspension_reason: null }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspensas_com_fatura_paga, 1);
  assert.equal(r.ok, false);
});

test('categoria incompatível (autônomo em plano empresa) é sinalizada', () => {
  const r = resumirBillingHealth({
    empresas: [
      { id: 'e1', nome: 'José', tipo: 'autonomo', status: 'ativo', planos: { categoria: 'empresa' } },
      { id: 'e2', nome: 'OK', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } },
      { id: 'e3', nome: 'SemPlano', tipo: 'autonomo', status: 'ativo', planos: null },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.categoria_incompativel, 1);
  assert.equal(r.detalhes.categoria_incompativel[0].nome, 'José');
});

test('webhook com erro é contado; contagem por status agregada', () => {
  const r = resumirBillingHealth({
    webhookEvents: [
      { event_type: 'PAYMENT_RECEIVED', status: 'processed', last_error: null },
      { event_type: 'PAYMENT_RECEIVED', status: 'failed', last_error: 'erro_atualizar_fatura', asaas_payment_id: 'pay_1' },
      { event_type: 'PAYMENT_CREATED', status: 'ignored', last_error: 'evento_sem_pagamento' },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.webhook_com_erro, 1);
  assert.equal(r.detalhes.webhook_com_erro[0].asaas_payment_id, 'pay_1');
  assert.equal(r.detalhes.webhook_por_status.processed, 1);
  assert.equal(r.detalhes.webhook_por_status.failed, 1);
  assert.equal(r.detalhes.webhook_por_status.ignored, 1);
});

test('entradas vazias não quebram (retorna estrutura zerada)', () => {
  const r = resumirBillingHealth({});
  assert.equal(r.ok, true);
  assert.equal(r.totais.total, 0);
});

// ─── Sinais INFORMATIVOS (não derrubam `ok`) ─────────────────────────────────

test('empresa ativa sem plano → informativo, ok NÃO cai', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'SemPlano', tipo: 'transportadora', status: 'ativo', plano_id: null, planos: null }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_sem_plano, 1);
  assert.equal(r.detalhes.empresa_sem_plano[0].nome, 'SemPlano');
  assert.equal(r.ok, true, 'sinal informativo não derruba o ok');
});

test('empresa suspensa sem plano NÃO conta como empresa_sem_plano (não é cobrável esperado)', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'Susp', tipo: 'transportadora', status: 'suspenso', plano_id: null, planos: null, suspension_reason: 'financial' }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_sem_plano, 0);
});

test('plano inativo/arquivado vinculado a conta cobrável → informativo', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'A', tipo: 'transportadora', status: 'ativo', plano_id: 'p1', planos: { id: 'p1', nome: 'Velho', categoria: 'empresa', ativo: false, arquivado_em: null } },
      { id: 'e2', nome: 'B', tipo: 'transportadora', status: 'trial', plano_id: 'p2', planos: { id: 'p2', nome: 'Arq', categoria: 'empresa', ativo: true, arquivado_em: '2026-01-01T00:00:00Z' } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.plano_inativo_ou_arquivado, 2);
  assert.equal(r.ok, true);
});

test('trial vencido sem fatura aberta → informativo; com fatura aberta NÃO conta', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e2', status: 'pendente' }],
    empresas: [
      { id: 'e1', nome: 'TrialVenc', tipo: 'autonomo', status: 'trial', trial_ends_at: '2026-07-01', plano_id: 'p1', planos: { id: 'p1', categoria: 'autonomo', ativo: true, arquivado_em: null } },
      { id: 'e2', nome: 'TrialVencComFat', tipo: 'autonomo', status: 'trial', trial_ends_at: '2026-07-01', plano_id: 'p1', planos: { id: 'p1', categoria: 'autonomo', ativo: true, arquivado_em: null } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.trial_vencido_sem_fatura, 1);
  assert.equal(r.detalhes.trial_vencido_sem_fatura[0].nome, 'TrialVenc');
  assert.equal(r.ok, true);
});

test('assinatura Asaas ativa é informativa', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'ComAssinatura', tipo: 'transportadora', status: 'ativo', plano_id: 'p1', asaas_subscription_id: 'sub_123', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.assinatura_asaas_ativa, 1);
  assert.equal(r.detalhes.assinatura_asaas_ativa[0].asaas_subscription_id, 'sub_123');
  assert.equal(r.ok, true);
});

test('suspensa sem motivo registrado → suspension_reason_inconsistente (informativo)', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'SemMotivo', tipo: 'transportadora', status: 'suspenso', suspension_reason: null, plano_id: 'p1', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspension_reason_inconsistente, 1);
  assert.equal(r.ok, true, 'informativo não derruba ok');
});

test('suspensa com motivo válido (financial) NÃO é inconsistente', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura(), empresa_id: 'e1', status: 'pendente' }],
    empresas: [{ id: 'e1', nome: 'ComMotivo', tipo: 'transportadora', status: 'suspenso', suspension_reason: 'financial', plano_id: 'p1', planos: { id: 'p1', categoria: 'empresa', ativo: true, arquivado_em: null } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.suspension_reason_inconsistente, 0);
});

// ─── Arquivadas: fora do escrutínio operacional (mega-frente higiene) ─────────

test('empresa arquivada é contada como arquivada e SAI dos outros sinais', () => {
  // Conta de teste arquivada: suspensa, sem plano, sem motivo — nada disso deve
  // pontuar, porque ela está fora da operação.
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{
      id: 'e1', nome: 'TesteArquivada', tipo: 'transportadora', status: 'suspenso',
      suspension_reason: null, plano_id: null, planos: null,
      arquivada_em: '2026-07-24T00:00:00Z',
    }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.arquivadas, 1);
  assert.equal(r.detalhes.arquivadas[0].nome, 'TesteArquivada');
  assert.equal(r.contadores.suspensas_sem_fatura, 0, 'arquivada não polui suspensas_sem_fatura');
  assert.equal(r.contadores.empresa_sem_plano, 0, 'arquivada não polui empresa_sem_plano');
  assert.equal(r.contadores.suspension_reason_inconsistente, 0);
  assert.equal(r.ok, true);
});

test('arquivada com fatura paga entra no sinal arquivadas_com_fatura_paga', () => {
  const r = resumirBillingHealth({
    faturas: [{ ...fatura({ status: 'pago', valor: 100 }), empresa_id: 'e1' }],
    empresas: [{ id: 'e1', nome: 'ArqPaga', tipo: 'transportadora', status: 'ativo', arquivada_em: '2026-07-24T00:00:00Z', planos: null }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.arquivadas, 1);
  assert.equal(r.contadores.arquivadas_com_fatura_paga, 1);
  assert.equal(r.detalhes.arquivadas_com_fatura_paga[0].nome, 'ArqPaga');
  // A fatura paga ainda soma no total_pago (histórico preservado).
  assert.equal(r.totais.total_pago, 100);
  assert.equal(r.ok, true);
});

test('sem arquivadas (coluna inexistente) → contador zerado, base intacta', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'Normal', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.arquivadas, 0);
  assert.equal(r.contadores.arquivadas_com_fatura_paga, 0);
});

// ─── FASE 4 (mega-frente comercial) — sinais comerciais ─────────────────────
// Regra: são todos INFORMATIVOS — nunca derrubam `ok`. E sem as entradas novas,
// nada muda em relação a hoje (compatibilidade).

test('sem entradas comerciais, contadores novos ficam 0 e ok inalterado', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'pago', valor: 100 })],
    empresas: [{ id: 'e1', nome: 'Alfa', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    hoje: HOJE,
  });
  assert.equal(r.ok, true);
  assert.equal(r.contadores.implantacao_pendente, 0);
  assert.equal(r.contadores.promocoes_ativas, 0);
  assert.equal(r.contadores.empresas_sob_negociacao, 0);
  assert.equal(r.contadores.empresas_acima_capacidade, 0);
});

test('implantação em aberto entra em implantacao_pendente (informativo, ok=true)', () => {
  const r = resumirBillingHealth({
    faturas: [
      fatura({ origem: 'implantacao', status: 'pendente', valor: 299 }),
      fatura({ origem: 'implantacao', status: 'pago', valor: 299 }), // paga não conta
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.implantacao_pendente, 1);
  assert.equal(r.detalhes.implantacao_pendente[0].valor, 299);
  assert.equal(r.ok, true);
});

test('promoções ativas x expiradas conforme a janela e a flag ativo', () => {
  const r = resumirBillingHealth({
    faturas: [],
    promocoes: [
      { id: 'p1', nome: 'Ativa', tipo: 'desconto_fixo_mensalidade', ativo: true, data_inicio: '2026-07-01T00:00:00Z', data_fim: '2026-07-31T23:59:59Z' },
      { id: 'p2', nome: 'Expirada ativa', tipo: 'isencao_implantacao', ativo: true, data_inicio: '2026-06-01T00:00:00Z', data_fim: '2026-07-10T00:00:00Z' },
      { id: 'p3', nome: 'Inativa futura', tipo: 'trial_estendido', ativo: false, data_inicio: '2026-08-01T00:00:00Z', data_fim: '2026-08-31T00:00:00Z' },
    ],
    hoje: HOJE, // 2026-07-22
  });
  assert.equal(r.contadores.promocoes_ativas, 1); // só p1
  assert.equal(r.contadores.promocoes_expiradas, 1); // p2 (fim < hoje)
  assert.equal(r.detalhes.promocoes_expiradas[0].ativa_ainda, true);
  assert.equal(r.ok, true);
});

test('resgates manuais são contados', () => {
  const r = resumirBillingHealth({
    faturas: [],
    promocaoResgates: [
      { promocao_id: 'p1', empresa_id: 'e1', manual: true, criado_em: '2026-07-20' },
      { promocao_id: 'p1', empresa_id: 'e2', manual: false, criado_em: '2026-07-20' },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.promocoes_aplicadas_manualmente, 1);
});

test('plano requer_negociacao: empresa sob negociação + subconjunto cobrável inválido + catálogo', () => {
  const planoNeg = { id: 'pn', nome: 'Enterprise', categoria: 'empresa', requer_negociacao: true, ativo: true };
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'Big', tipo: 'transportadora', status: 'ativo', planos: planoNeg },
      { id: 'e2', nome: 'BigSusp', tipo: 'transportadora', status: 'suspenso', planos: planoNeg },
    ],
    planos: [planoNeg, { id: 'p2', nome: 'Start', requer_negociacao: false, ativo: true }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresas_sob_negociacao, 2);
  assert.equal(r.contadores.empresas_plano_automatico_invalido, 1); // só a ativa (cobrável)
  assert.equal(r.contadores.planos_requer_negociacao_ativos, 1);
  assert.equal(r.ok, true);
});

test('empresas acima da capacidade inclusa (motoristas > capacidade)', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'Cheia', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa', nome: 'Start', capacidade_inclusa: 5 } },
      { id: 'e2', nome: 'Ok', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa', nome: 'Start', capacidade_inclusa: 5 } },
    ],
    contagemMotoristasPorEmpresa: { e1: 7, e2: 5 },
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresas_acima_capacidade, 1);
  assert.equal(r.detalhes.empresas_acima_capacidade[0].excedente, 2);
  assert.equal(r.ok, true);
});

// ─── FASE 5 (sync Asaas) — sinais de sync (informativos, não afetam ok) ─────
test('sem asaasSyncEstado, contadores de sync ficam 0 e ok inalterado', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'pago', valor: 100 })],
    empresas: [{ id: 'e1', nome: 'Alfa', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    hoje: HOJE,
  });
  assert.equal(r.ok, true);
  assert.equal(r.contadores.sync_asaas_pendente, 0);
  assert.equal(r.contadores.sync_asaas_erro, 0);
  assert.equal(r.contadores.assinatura_asaas_desatualizada, 0);
});

test('fila de sync: pendente, erro e desatualizada são contados', () => {
  const r = resumirBillingHealth({
    faturas: [],
    asaasSyncEstado: [
      { empresa_id: 'e1', status: 'pendente', motivo: 'plano_reprecificado', valor_alvo: 299.90, valor_sincronizado: 149.90 },
      { empresa_id: 'e2', status: 'erro', ultimo_erro: 'timeout', tentativas: 3, valor_alvo: 499.90, valor_sincronizado: 499.90 },
      { empresa_id: 'e3', status: 'sincronizado', valor_alvo: 799.90, valor_sincronizado: 799.90 },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.sync_asaas_pendente, 1);
  assert.equal(r.contadores.sync_asaas_erro, 1);
  // e1 (alvo 299,90 != sync 149,90) → desatualizada; e2/e3 batem.
  assert.equal(r.contadores.assinatura_asaas_desatualizada, 1);
  assert.equal(r.detalhes.assinatura_asaas_desatualizada[0].empresa_id, 'e1');
  assert.equal(r.ok, true);
});

test('empresa cobrável + plano pago sem assinatura → empresa_sem_assinatura_esperada', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'Sem sub', tipo: 'transportadora', status: 'ativo', asaas_subscription_id: null,
        planos: { categoria: 'empresa', nome: 'Start', preco_mensal: 299.90, ativo: true, arquivado_em: null, requer_negociacao: false } },
      { id: 'e2', nome: 'Com sub', tipo: 'transportadora', status: 'ativo', asaas_subscription_id: 'sub_2',
        planos: { categoria: 'empresa', nome: 'Start', preco_mensal: 299.90, ativo: true } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_sem_assinatura_esperada, 1);
  assert.equal(r.detalhes.empresa_sem_assinatura_esperada[0].id, 'e1');
});

test('assinatura existente com plano inválido (sob negociação) → empresa_com_assinatura_mas_plano_invalido', () => {
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      { id: 'e1', nome: 'Neg', tipo: 'transportadora', status: 'ativo', asaas_subscription_id: 'sub_1',
        planos: { categoria: 'empresa', nome: 'Enterprise', preco_mensal: 0, requer_negociacao: true, ativo: true } },
    ],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_com_assinatura_mas_plano_invalido, 1);
  assert.equal(r.ok, true);
});

// ─── Extras por empresa (quantidade contratada) — informativos ──────────────
test('sinais de quantidade contratada: null, < motoristas, >40, upgrade recomendado', () => {
  const START = { id: 'start', nome: 'Start', categoria: 'empresa', preco_mensal: 299.90, capacidade_inclusa: 5, preco_motorista_extra: 100, ativo: true };
  const ESSENCIAL = { id: 'essencial', nome: 'Essencial', categoria: 'empresa', preco_mensal: 499.90, capacidade_inclusa: 10, preco_motorista_extra: 90, ativo: true };
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [
      // sem quantidade → null
      { id: 'e1', nome: 'SemQtd', tipo: 'transportadora', status: 'ativo', planos: START },
      // 15 contratados no Start → upgrade recomendado (Growth/Essencial) + acima? 15<=40
      { id: 'e2', nome: 'Muitos', tipo: 'transportadora', status: 'ativo', quantidade_contratada: 15, planos: START },
      // quantidade 3 < 6 motoristas ativos
      { id: 'e3', nome: 'Menor', tipo: 'transportadora', status: 'ativo', quantidade_contratada: 3, planos: START },
    ],
    planos: [START, ESSENCIAL],
    contagemMotoristasPorEmpresa: { e3: 6 },
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_quantidade_contratada_null, 1);
  assert.equal(r.contadores.empresa_quantidade_contratada_menor_que_motoristas_ativos, 1);
  assert.equal(r.contadores.empresa_upgrade_recomendado >= 1, true); // e2 (15 no Start) recomenda outro
  assert.equal(r.ok, true);
});

test('quantidade contratada acima do teto self-service (>40) é sinalizada', () => {
  const SCALE = { id: 'scale', nome: 'Scale', categoria: 'empresa', preco_mensal: 1199.90, capacidade_inclusa: 40, preco_motorista_extra: 70, ativo: true };
  const r = resumirBillingHealth({
    faturas: [],
    empresas: [{ id: 'e1', nome: 'Grande', tipo: 'transportadora', status: 'ativo', quantidade_contratada: 45, planos: SCALE }],
    planos: [SCALE],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_quantidade_contratada_acima_limite_self_service, 1);
});

test('sem quantidade contratada em nenhuma empresa → contadores 0, ok inalterado', () => {
  const r = resumirBillingHealth({
    faturas: [fatura({ status: 'pago', valor: 100 })],
    empresas: [{ id: 'e1', nome: 'Alfa', tipo: 'transportadora', status: 'ativo', planos: { categoria: 'empresa' } }],
    hoje: HOJE,
  });
  assert.equal(r.contadores.empresa_quantidade_contratada_null, 0);
  assert.equal(r.contadores.empresa_upgrade_recomendado, 0);
  assert.equal(r.ok, true);
});

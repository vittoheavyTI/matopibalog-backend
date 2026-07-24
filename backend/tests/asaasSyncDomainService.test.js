// MEGA-FRENTE Fechamento Comercial + Sync Asaas — FASE 4: decisões puras do sync.
// Prova: criar, atualizar_valor, idempotência (pular), isento/gratuito, não
// cobrável, requer_negociacao, cadastro incompleto, empresas afetadas, e o
// forward-only (valor-alvo derivado do plano; nunca toca fatura).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarSync,
  empresasAfetadasPorPlano,
  valorAlvoDaEmpresa,
  mesmoValor,
  montarEstadoResultado,
  montarTentativa,
  ACAO,
  MOTIVOS,
} = require('../services/asaasSyncDomainService');

const PLANO = { id: 'p-start', preco_mensal: 299.90, requer_negociacao: false };

test('empresa cobrável sem assinatura → criar', () => {
  const r = avaliarSync({ empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null }, plano: PLANO });
  assert.equal(r.acao, ACAO.CRIAR);
  assert.equal(r.valorAlvo, 299.90);
});

test('assinatura com valor divergente → atualizar_valor (forward-only)', () => {
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: 'sub_1' },
    plano: PLANO, valorSincronizado: 149.90,
  });
  assert.equal(r.acao, ACAO.ATUALIZAR_VALOR);
  assert.equal(r.valorAlvo, 299.90);
});

test('idempotência: valor já sincronizado → pular', () => {
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: 'sub_1' },
    plano: PLANO, valorSincronizado: 299.90,
  });
  assert.equal(r.acao, ACAO.PULAR);
  assert.equal(r.motivo, MOTIVOS.JA_SINCRONIZADO);
});

test('idempotência via valor atual da assinatura no Asaas → pular', () => {
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: 'sub_1' },
    plano: PLANO, valorAssinaturaAtual: 299.90, valorSincronizado: 149.90,
  });
  assert.equal(r.acao, ACAO.PULAR); // valor atual manda
});

test('plano gratuito/isento → pular (nada a cobrar)', () => {
  const r = avaliarSync({ empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null }, plano: { preco_mensal: 0 } });
  assert.equal(r.acao, ACAO.PULAR);
  assert.equal(r.motivo, MOTIVOS.PLANO_GRATUITO);
});

test('status não cobrável (suspenso) → pular', () => {
  const r = avaliarSync({ empresa: { id: 'e1', status: 'suspenso', asaas_subscription_id: 'sub_1' }, plano: PLANO });
  assert.equal(r.acao, ACAO.PULAR);
  assert.equal(r.motivo, MOTIVOS.NAO_COBRAVEL);
});

test('plano requer_negociacao → pular (não cobra sob proposta)', () => {
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null },
    plano: { preco_mensal: 0, requer_negociacao: true },
  });
  assert.equal(r.acao, ACAO.PULAR);
  assert.equal(r.motivo, MOTIVOS.REQUER_NEGOCIACAO);
});

test('sem assinatura + cadastro incompleto → erro (não cria reserva órfã)', () => {
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: null },
    plano: PLANO, cadastroCompleto: false,
  });
  assert.equal(r.acao, ACAO.ERRO);
  assert.equal(r.motivo, MOTIVOS.CADASTRO_INCOMPLETO);
});

test('valorExplicito (base + extras) tem precedência sobre preco_mensal', () => {
  const alvo = valorAlvoDaEmpresa({ plano: PLANO, valorExplicito: 499.90 });
  assert.equal(alvo.valor, 499.90);
  const r = avaliarSync({
    empresa: { id: 'e1', status: 'ativo', asaas_subscription_id: 'sub_1' },
    plano: PLANO, valorSincronizado: 299.90, valorExplicito: 499.90,
  });
  assert.equal(r.acao, ACAO.ATUALIZAR_VALOR);
  assert.equal(r.valorAlvo, 499.90);
});

test('mesmoValor compara em centavos (sem ruído de float)', () => {
  assert.equal(mesmoValor(299.90, 299.90), true);
  assert.equal(mesmoValor(299.90, 299.91), false);
  assert.equal(mesmoValor(null, 1), false);
});

test('empresasAfetadasPorPlano: só cobráveis, no plano, não arquivadas', () => {
  const empresas = [
    { id: 'a', plano_id: 'p1', status: 'ativo', arquivada_em: null },
    { id: 'b', plano_id: 'p1', status: 'trial', arquivada_em: null },
    { id: 'c', plano_id: 'p1', status: 'suspenso', arquivada_em: null },   // não cobrável
    { id: 'd', plano_id: 'p1', status: 'ativo', arquivada_em: '2026-01-01' }, // arquivada
    { id: 'e', plano_id: 'p2', status: 'ativo', arquivada_em: null },        // outro plano
  ];
  const ids = empresasAfetadasPorPlano({ empresas, planoId: 'p1' });
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('montarEstadoResultado: ok grava valor_sincronizado e zera erro; erro incrementa tentativa', () => {
  const ok = montarEstadoResultado({ empresaId: 'e1', ok: true, valorAlvo: 299.90, tentativasAtual: 0 });
  assert.equal(ok.status, 'sincronizado');
  assert.equal(ok.valor_sincronizado, 299.90);
  assert.equal(ok.ultimo_erro, null);
  assert.equal(ok.tentativas, 1);
  const err = montarEstadoResultado({ empresaId: 'e1', ok: false, valorAlvo: 299.90, erro: 'timeout', tentativasAtual: 2 });
  assert.equal(err.status, 'erro');
  assert.equal(err.ultimo_erro, 'timeout');
  assert.equal(err.tentativas, 3);
});

test('montarTentativa: resumo sem segredo/PII, registra ambiente sandbox', () => {
  const t = montarTentativa({ empresaId: 'e1', acao: 'atualizar_valor', valorAntes: 149.90, valorDepois: 299.90, resultado: 'ok', asaasSubscriptionId: 'sub_1' });
  assert.equal(t.ambiente, 'sandbox');
  assert.match(t.payload_resumo, /sub=sub_1 value=299\.9/);
  assert.equal(t.valor_antes, 149.90);
  assert.equal(t.valor_depois, 299.90);
});

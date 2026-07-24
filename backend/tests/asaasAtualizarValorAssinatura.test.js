// MEGA-FRENTE Fechamento Comercial + Sync Asaas — atualizarValorAssinatura.
// Prova (com http/supabase MOCKADOS — sem rede): forward-only
// (updatePendingPayments=false), idempotência, needsCreate e recusa de valor inválido.

const test = require('node:test');
const assert = require('node:assert/strict');

const { atualizarValorAssinatura } = require('../services/asaasSubscriptionService');

const config = { baseURL: 'https://sandbox.asaas.test/api', apiKey: 'k' };

function fakeSupabase(empresa) {
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    single() { return Promise.resolve({ data: empresa, error: null }); },
  };
  return chain;
}

function fakeHttp(subValue) {
  return {
    puts: [],
    async get() { return { data: subValue == null ? null : { id: 'sub_1', value: subValue, status: 'ACTIVE' } }; },
    async put(url, body) { this.puts.push({ url, body }); return { data: { id: 'sub_1', value: body.value } }; },
  };
}

const empresaComSub = { id: 'e1', asaas_subscription_id: 'sub_1', planos: { preco_mensal: 299.90 } };

test('valor divergente → PUT com value alvo e updatePendingPayments=false (forward-only)', async () => {
  const http = fakeHttp(149.90);
  const r = await atualizarValorAssinatura({ empresaId: 'e1', valorAlvo: 299.90, config, supabase: fakeSupabase(empresaComSub), http });
  assert.equal(r.atualizado, true);
  assert.equal(r.valor_antes, 149.90);
  assert.equal(r.valor_depois, 299.90);
  assert.equal(http.puts.length, 1);
  assert.match(http.puts[0].url, /\/subscriptions\/sub_1$/);
  assert.equal(http.puts[0].body.value, 299.90);
  assert.equal(http.puts[0].body.updatePendingPayments, false); // NÃO altera cobrança emitida
});

test('idempotência: valor atual já é o alvo → não chama o Asaas', async () => {
  const http = fakeHttp(299.90);
  const r = await atualizarValorAssinatura({ empresaId: 'e1', valorAlvo: 299.90, config, supabase: fakeSupabase(empresaComSub), http });
  assert.equal(r.atualizado, false);
  assert.equal(http.puts.length, 0);
  assert.match(r.mensagem, /já está no valor/i);
});

test('sem assinatura → needsCreate=true, não faz PUT', async () => {
  const http = fakeHttp(null);
  const empresaSemSub = { id: 'e1', asaas_subscription_id: null, planos: { preco_mensal: 299.90 } };
  const r = await atualizarValorAssinatura({ empresaId: 'e1', valorAlvo: 299.90, config, supabase: fakeSupabase(empresaSemSub), http });
  assert.equal(r.needsCreate, true);
  assert.equal(r.atualizado, false);
  assert.equal(http.puts.length, 0);
});

test('valor-alvo inválido (0) → lança', async () => {
  const http = fakeHttp(149.90);
  await assert.rejects(
    () => atualizarValorAssinatura({ empresaId: 'e1', valorAlvo: 0, config, supabase: fakeSupabase(empresaComSub), http }),
    /Valor-alvo inválido/,
  );
});

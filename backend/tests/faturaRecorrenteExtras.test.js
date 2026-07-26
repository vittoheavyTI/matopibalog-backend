// MEGA-FRENTE (extras por empresa) — cobertura da FATURA RECORRENTE com VALOR
// EFETIVO (base + extras) pela quantidade_contratada da empresa.
//
// Lacuna que este arquivo fecha: os testes de recorrência existentes cobrem
// snapshot 'fixo'/'por_motorista' e "valor = preco_mensal (não recalcula)", mas
// NÃO exercitam o caminho base+extras — em que a empresa contratou mais
// motoristas/caminhões do que a capacidade inclusa do plano e a fatura recorrente
// tem de cobrar base + (extras × preço do extra), congelando a composição no
// snapshot. Cenário canônico do produto: Empresa Start (base R$299,90, capacidade
// 5, extra R$100) com quantidade_contratada = 7 → R$499,90.
//
// Prova, ponta a ponta do SERVIÇO (gerarFaturaRecorrenteParaEmpresa, com supabase
// e http mockados — sem rede/DB), a fiação derivarValorEfetivoFatura →
// montarPayloadFaturaRecorrente → reserva/cobrança:
//   * valor da fatura = valor efetivo (499,90), NÃO só a base;
//   * snapshot com capacidade_inclusa/quantidade_contratada/quantidade_extra/
//     valor_extra e o unitário do extra;
//   * idempotência (duas execuções não duplicam);
//   * fatura já paga não é recalculada nem tocada;
//   * plano Enterprise/sob negociação (sem preço de tabela) não gera self-service;
//   * valor efetivo acima do teto de negociação não inventa preço.

const test = require('node:test');
const assert = require('node:assert/strict');

const { gerarFaturaRecorrenteParaEmpresa } = require('../services/faturaRecorrenteService');
const { derivarValorEfetivoFatura, valorEfetivoEmpresa } = require('../services/calculadoraComercialService');

// ─── Fixtures do catálogo real (valores de produção) ─────────────────────────
const START = {
  id: '00000000-0000-0000-0000-000000000002', nome: 'Empresa Start', ativo: true, arquivado_em: null,
  preco_mensal: 299.90, modelo_cobranca: 'fixo', preco_por_motorista: null,
  limite_motoristas: 5, capacidade_inclusa: 5, preco_motorista_extra: 100,
};
const ENTERPRISE = {
  id: '00000000-0000-0000-0000-000000000004', nome: 'Enterprise / Sob negociação', ativo: true, arquivado_em: null,
  preco_mensal: 0, modelo_cobranca: 'fixo', preco_por_motorista: null,
  limite_motoristas: 999, capacidade_inclusa: 41, preco_motorista_extra: null,
  requer_negociacao: true, limite_negociacao: 40,
};

function empresaAtiva(over = {}) {
  return {
    id: 'e-start', status: 'ativo', asaas_customer_id: 'cus_1', asaas_subscription_id: null,
    plano_id: START.id, nome: 'Empresa Start Test', cnpj: '12345678000199',
    email_contato: 'start@ex.com', telefone_contato: '63999998888',
    quantidade_contratada: 7, planos: START, ...over,
  };
}
const DATA_REF = '2026-07-26';
const PERIODO = '2026-07-01';
const CRID = 'recorrente:e-start:2026-07';

// ─── Mock mínimo do query builder do supabase-js (mesma forma do teste irmão) ─
function makeSupabase({ faturas = [], planos = {} } = {}) {
  const calls = { inserts: [], updates: [] };
  const store = { faturas: [...faturas] };

  function faturaQuery() {
    const filtros = {};
    const api = {
      select() { return api; },
      eq(k, v) { filtros[k] = v; return api; },
      maybeSingle() {
        if (filtros.client_request_id !== undefined) {
          const f = store.faturas.find((x) => x.client_request_id === filtros.client_request_id);
          return Promise.resolve({ data: f || null, error: null });
        }
        const f = store.faturas.find((x) => x.id === filtros.id);
        return Promise.resolve({ data: f || null, error: null });
      },
      then(resolve) {
        const lista = store.faturas.filter((x) => Object.entries(filtros).every(([k, v]) => x[k] === v));
        resolve({ data: lista, error: null });
      },
    };
    return api;
  }

  return {
    _calls: calls,
    _store: store,
    from(tabela) {
      if (tabela === 'planos') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: planos.data || null, error: planos.error || null }); },
        };
      }
      return {
        select() { return faturaQuery(); },
        insert(row) {
          calls.inserts.push(row);
          return {
            select() { return this; },
            single() {
              const nova = { id: `fat-${store.faturas.length + 1}`, ...row };
              store.faturas.push(nova);
              return Promise.resolve({ data: nova, error: null });
            },
          };
        },
        update(patch) {
          const flt = {};
          const upd = {
            eq(k, v) { flt[k] = v; return upd; },
            select() { return upd; },
            single() {
              calls.updates.push({ patch, flt });
              const idx = store.faturas.findIndex((x) => x.id === flt.id);
              const atual = idx >= 0 ? { ...store.faturas[idx], ...patch } : { id: flt.id, ...patch };
              if (idx >= 0) store.faturas[idx] = atual;
              return Promise.resolve({ data: atual, error: null });
            },
          };
          return upd;
        },
      };
    },
  };
}

function makeHttp({ getPayments = { data: { data: [] } }, pixQr = { data: { payload: 'pix-copia-cola' } } } = {}) {
  const calls = { gets: [], posts: [] };
  return {
    _calls: calls,
    get(url, cfg) {
      calls.gets.push({ url, cfg });
      if (url.includes('/pixQrCode')) return Promise.resolve(pixQr);
      if (url.includes('/payments')) return Promise.resolve(getPayments);
      return Promise.resolve({ data: {} });
    },
    post(url, body, cfg) {
      calls.posts.push({ url, body, cfg });
      if (url.endsWith('/customers')) return Promise.resolve({ data: { id: 'cus_novo' } });
      if (url.endsWith('/payments')) return Promise.resolve({ data: { id: 'pay_1', status: 'PENDING', invoiceUrl: 'http://inv/1', bankSlipUrl: null } });
      return Promise.resolve({ data: {} });
    },
  };
}
const CONFIG = { baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'k' };

// ─── 1. Start 7 → R$499,90 com snapshot completo de extras ───────────────────
test('Empresa Start + quantidade_contratada=7 → recorrente R$499,90 com snapshot base+extras', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });

  assert.equal(r.resultado, 'gerada');
  assert.equal(r.periodo, PERIODO);

  const ins = supabase._calls.inserts[0];
  // valor efetivo (base + extras), NÃO a base pura.
  assert.equal(ins.valor, 499.90);
  assert.equal(ins.origem, 'recorrente');
  assert.equal(ins.periodo_referencia, PERIODO);
  assert.equal(ins.client_request_id, CRID);
  assert.equal(ins.tipo_pagamento, 'PIX');
  assert.equal(ins.status, 'pendente');
  assert.equal(ins.asaas_id, null);
  // Snapshot da composição congelado na fatura.
  assert.equal(ins.plano_nome_snapshot, 'Empresa Start');
  assert.equal(ins.modelo_cobranca_snapshot, 'fixo');
  assert.equal(ins.capacidade_inclusa_snapshot, 5);
  assert.equal(ins.quantidade_snapshot, 7);          // quantidade CONTRATADA
  assert.equal(ins.quantidade_extra_snapshot, 2);    // 7 - 5
  assert.equal(ins.valor_extra_snapshot, 200);       // 2 × 100
  assert.equal(ins.preco_unitario_snapshot, 100);    // unitário do extra
  // Base derivável do snapshot: valor_total - valor_extra = preco_mensal.
  assert.equal(ins.valor - ins.valor_extra_snapshot, START.preco_mensal);

  // Cobrança Asaas no valor efetivo (não recalcula divergente).
  const post = http._calls.posts.find((p) => p.url.endsWith('/payments'));
  assert.equal(post.body.value, 499.90);
  assert.equal(post.body.externalReference, CRID);
  assert.equal(post.body.billingType, 'PIX');
  assert.equal(http._calls.posts.some((p) => p.url.includes('/subscriptions')), false);
});

// ─── 2. Idempotência: duas execuções não duplicam ────────────────────────────
test('duas execuções seguidas não duplicam a recorrente (2ª = idempotente)', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();

  const r1 = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });
  const r2 = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });

  assert.equal(r1.resultado, 'gerada');
  assert.equal(r2.resultado, 'idempotente');
  // Exatamente 1 insert e 1 cobrança no total das duas execuções.
  assert.equal(supabase._calls.inserts.length, 1);
  assert.equal(http._calls.posts.filter((p) => p.url.endsWith('/payments')).length, 1);
  // Uma única recorrente para o par (empresa, período).
  const recorrentes = supabase._store.faturas.filter((f) => f.origem === 'recorrente' && f.periodo_referencia === PERIODO);
  assert.equal(recorrentes.length, 1);
});

// ─── 3. Fatura já paga não é recalculada nem tocada ──────────────────────────
test('recorrente já PAGA do período → idempotente, valor preservado, zero insert/update/cobrança', async () => {
  const paga = {
    id: 'fat-paga', empresa_id: 'e-start', origem: 'recorrente', periodo_referencia: PERIODO,
    client_request_id: CRID, asaas_id: 'pay_pago', status: 'pago', valor: 499.90,
  };
  const supabase = makeSupabase({ faturas: [paga] });
  const http = makeHttp();

  // Mesmo passando um plano com OUTRO preço, a paga não pode ser recalculada.
  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: CONFIG,
    empresa: empresaAtiva({ planos: { ...START, preco_mensal: 999, preco_motorista_extra: 999 } }),
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'idempotente');
  assert.equal(r.fatura.id, 'fat-paga');
  assert.equal(r.fatura.valor, 499.90);          // inalterado
  assert.equal(r.fatura.status, 'pago');
  assert.equal(supabase._calls.inserts.length, 0);
  assert.equal(supabase._calls.updates.length, 0);
  assert.equal(http._calls.posts.length, 0);
});

// ─── 4. Enterprise / sob negociação não gera self-service ────────────────────
test('plano Enterprise / sob negociação (sem preço de tabela) → recorrência NÃO gera, zero Asaas', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: CONFIG,
    empresa: empresaAtiva({ plano_id: ENTERPRISE.id, planos: ENTERPRISE, quantidade_contratada: 50 }),
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'pulada');
  // Enterprise não tem preço de tabela (preco_mensal = 0) → pulado pela regra de
  // plano sem preço válido; nenhuma cobrança self-service é emitida.
  assert.equal(r.motivo, 'plano_gratuito');
  assert.equal(supabase._calls.inserts.length, 0);
  assert.equal(http._calls.posts.length, 0);
});

// ─── 5. Valor efetivo acima do teto de negociação não inventa preço ──────────
test('valor efetivo: quantidade acima do teto (41 > 40) exige negociação e não deriva valor', () => {
  const derivado = derivarValorEfetivoFatura({ plano: START, quantidade_contratada: 41 });
  assert.equal(derivado.valorEfetivo, null);   // não inventa preço fora da tabela
  assert.equal(derivado.extras, null);

  const ve = valorEfetivoEmpresa({ plano: START, quantidade_contratada: 41 });
  assert.equal(ve.requer_negociacao, true);
  assert.equal(ve.acomoda, false);
  assert.equal(ve.valor_total, null);
});

// Frente #5 (Billing v2) — PR 3 (Commit 1): serviço de I/O da fatura recorrente.
// Prova a coreografia RESERVA-PRIMEIRO + reconciliação por externalReference,
// com supabase e http mockados (sem rede/DB). Cobre elegibilidade herdada do
// domínio, idempotência em camadas e recuperação de falha do Asaas.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  gerarFaturaRecorrenteParaEmpresa,
} = require('../services/faturaRecorrenteService');

// ─── Fakes de dados ──────────────────────────────────────────────────────────
const PLANO_FIXO = {
  id: 'p-pro', nome: 'Plano Profissional', ativo: true, arquivado_em: null,
  preco_mensal: 149.99, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 10,
};
function empresaAtiva(over = {}) {
  return {
    id: 'e1', status: 'ativo', asaas_customer_id: 'cus_1', asaas_subscription_id: null,
    plano_id: 'p-pro', nome: 'Empresa Alfa', cnpj: '12345678000199',
    email_contato: 'alfa@ex.com', telefone_contato: '63999998888',
    planos: PLANO_FIXO, ...over,
  };
}
const DATA_REF = '2026-08-15';
const PERIODO = '2026-08-01';
const CRID = 'recorrente:e1:2026-08';

// ─── Mock mínimo do query builder do supabase-js ─────────────────────────────
// Suporta as cadeias usadas pelo serviço:
//   from(t).select(c).eq(k,v).eq(...).maybeSingle()
//   from(t).select(c).eq('origem',...)              (retorna array)
//   from(t).insert(row).select().single()
//   from(t).update(patch).eq('id',id).select().single()
function makeSupabase({ faturas = [], onInsert, onUpdate, planos = {} } = {}) {
  const calls = { inserts: [], updates: [] };
  const store = { faturas: [...faturas] };

  function faturaQuery() {
    const filtros = {};
    const api = {
      _op: 'select',
      select() { return api; },
      eq(k, v) { filtros[k] = v; return api; },
      maybeSingle() {
        // por client_request_id
        if (filtros.client_request_id !== undefined) {
          const f = store.faturas.find((x) => x.client_request_id === filtros.client_request_id);
          return Promise.resolve({ data: f || null, error: null });
        }
        const f = store.faturas.find((x) => x.id === filtros.id);
        return Promise.resolve({ data: f || null, error: null });
      },
      // select(...).eq('origem',...) resolvido como array via then
      then(resolve) {
        const lista = store.faturas.filter((x) =>
          Object.entries(filtros).every(([k, v]) => x[k] === v)
        );
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
      // faturas
      return {
        select() { return faturaQuery(); },
        insert(row) {
          calls.inserts.push(row);
          return {
            select() { return this; },
            single() {
              if (onInsert) return Promise.resolve(onInsert(row, store));
              const nova = { id: 'fat-1', ...row };
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
              if (onUpdate) return Promise.resolve(onUpdate(patch, flt, store));
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

// Mock http (axios-like). Registra chamadas; respostas configuráveis.
function makeHttp({ getPayments = { data: { data: [] } }, postPayment, pixQr = { data: { payload: 'pix-copia-cola' } }, postCustomer } = {}) {
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
      if (url.endsWith('/customers')) {
        if (postCustomer) return postCustomer(body);
        return Promise.resolve({ data: { id: 'cus_novo' } });
      }
      if (url.endsWith('/payments')) {
        if (postPayment === 'throw') return Promise.reject(new Error('asaas 500'));
        if (postPayment) return postPayment(body);
        return Promise.resolve({ data: { id: 'pay_1', status: 'PENDING', invoiceUrl: 'http://inv/1', bankSlipUrl: null } });
      }
      return Promise.resolve({ data: {} });
    },
  };
}
const CONFIG = { baseURL: 'https://sandbox.asaas.com/api/v3', apiKey: 'k' };

// ─── Caminho feliz ───────────────────────────────────────────────────────────
test('elegível: cria reserva, cria cobrança Asaas e completa a fatura', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });

  assert.equal(r.resultado, 'gerada');
  assert.equal(r.periodo, PERIODO);
  // Reserva inserida sem asaas_id, com os campos recorrentes.
  const ins = supabase._calls.inserts[0];
  assert.equal(ins.origem, 'recorrente');
  assert.equal(ins.periodo_referencia, PERIODO);
  assert.equal(ins.client_request_id, CRID);
  assert.equal(ins.valor, 149.99);
  assert.equal(ins.tipo_pagamento, 'PIX');
  assert.equal(ins.status, 'pendente');
  assert.equal(ins.asaas_id, null);
  assert.equal(ins.plano_id, 'p-pro');
  assert.equal(ins.modelo_cobranca_snapshot, 'fixo');
  // Cobrança criada e fatura completada.
  const criouPayment = http._calls.posts.some((p) => p.url.endsWith('/payments'));
  assert.equal(criouPayment, true);
  assert.equal(r.fatura.asaas_id, 'pay_1');
  assert.equal(r.fatura.status, 'pendente'); // PENDING → pendente
  // externalReference determinístico.
  const post = http._calls.posts.find((p) => p.url.endsWith('/payments'));
  assert.equal(post.body.externalReference, CRID);
  assert.equal(post.body.billingType, 'PIX');
  // NUNCA assinatura.
  assert.equal(http._calls.posts.some((p) => p.url.includes('/subscriptions')), false);
});

// ─── Não cobra (herdado do domínio) ──────────────────────────────────────────
for (const [nome, over, motivo] of [
  ['trial', { status: 'trial' }, 'empresa_status_nao_cobravel'],
  ['suspenso', { status: 'suspenso' }, 'empresa_status_nao_cobravel'],
  ['assinatura Asaas', { asaas_subscription_id: 'sub_1' }, 'assinatura_asaas_existente'],
  ['plano gratuito', { planos: { ...PLANO_FIXO, preco_mensal: 0 } }, 'plano_gratuito'],
]) {
  test(`${nome} → pulada, sem Asaas e sem insert`, async () => {
    const supabase = makeSupabase();
    const http = makeHttp();
    const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(over), dataReferencia: DATA_REF });
    assert.equal(r.resultado, 'pulada');
    assert.equal(r.motivo, motivo);
    assert.equal(supabase._calls.inserts.length, 0);
    assert.equal(http._calls.posts.length, 0);
  });
}

// ─── Sem customer → cria via garantirCustomer ────────────────────────────────
test('empresa elegível sem asaas_customer_id: cria customer e cobra', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: CONFIG,
    empresa: empresaAtiva({ asaas_customer_id: null }),
    dataReferencia: DATA_REF,
  });
  assert.equal(r.resultado, 'gerada');
  assert.equal(http._calls.posts.some((p) => p.url.endsWith('/customers')), true);
  const payPost = http._calls.posts.find((p) => p.url.endsWith('/payments'));
  assert.equal(payPost.body.customer, 'cus_novo');
});

// ─── Cadastro incompleto → pulada controlada, sem cobrança ───────────────────
test('sem customer e cadastro incompleto: pulada ANTES da reserva (anti-órfã)', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();
  // Comportamento NOVO (pré-validação): o cadastro inválido é barrado ANTES da
  // reserva — nenhuma fatura local órfã, nenhuma chamada ao Asaas.
  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: CONFIG,
    empresa: empresaAtiva({ asaas_customer_id: null, cnpj: '123' }),
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'pulada');
  assert.equal(r.motivo, 'cadastro_incompleto');
  assert.equal(http._calls.posts.length, 0);
  assert.equal(supabase._calls.inserts.length, 0, 'reserva órfã não pode mais nascer');
  assert.equal(supabase._store.faturas.some((f) => f.client_request_id === CRID), false);
});

// ─── Idempotência: recorrente já existe e completa ───────────────────────────
test('fatura recorrente já existente (com asaas_id) → idempotente, sem nova cobrança', async () => {
  const supabase = makeSupabase({
    faturas: [{ id: 'fat-x', empresa_id: 'e1', origem: 'recorrente', periodo_referencia: PERIODO, client_request_id: CRID, asaas_id: 'pay_old', status: 'pendente' }],
  });
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });
  assert.equal(r.resultado, 'idempotente');
  assert.equal(r.fatura.id, 'fat-x');
  assert.equal(supabase._calls.inserts.length, 0);
  assert.equal(http._calls.posts.length, 0);
});

// ─── 23505 no insert → retorna existente ─────────────────────────────────────
test('23505 no insert da reserva → recupera a fatura da corrida vencedora', async () => {
  // Store começa VAZIA (domínio decide "cobrar"); no insert, a corrida vencedora
  // aparece e o índice bate 23505; a recuperação por client_request_id a encontra.
  const winner = { id: 'fat-corrida', empresa_id: 'e1', origem: 'recorrente', periodo_referencia: PERIODO, client_request_id: CRID, asaas_id: 'pay_race', status: 'pendente' };
  const supabase = makeSupabase({
    onInsert: (row, store) => { store.faturas.push(winner); return { data: null, error: { code: '23505' } }; },
  });
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });
  assert.equal(r.resultado, 'idempotente');
  assert.equal(r.motivo, 'corrida_resolvida');
  assert.equal(r.fatura.id, 'fat-corrida');
  // Não criou cobrança nova (a vencedora já tinha asaas_id).
  assert.equal(http._calls.posts.some((p) => p.url.endsWith('/payments')), false);
});

// ─── Reserva sem asaas_id → reconcilia por externalReference (reutiliza) ─────
test('reserva sem asaas_id: reconcilia payment por externalReference e NÃO cria outro', async () => {
  const supabase = makeSupabase({
    faturas: [{ id: 'fat-reserva', empresa_id: 'e1', origem: 'recorrente', periodo_referencia: PERIODO, client_request_id: CRID, asaas_id: null, status: 'pendente' }],
  });
  // GET /payments?externalReference retorna um payment já existente.
  const http = makeHttp({ getPayments: { data: { data: [{ id: 'pay_existente', status: 'PENDING', invoiceUrl: 'http://inv/ex', bankSlipUrl: null }] } } });
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });

  assert.equal(r.resultado, 'gerada');
  assert.equal(r.motivo, 'reconciliada');
  assert.equal(r.fatura.asaas_id, 'pay_existente');
  // NÃO criou payment novo (reutilizou o reconciliado).
  assert.equal(http._calls.posts.some((p) => p.url.endsWith('/payments')), false);
  // NÃO inseriu nova reserva.
  assert.equal(supabase._calls.inserts.length, 0);
});

// ─── Asaas falha após reserva → estado recuperável ───────────────────────────
test('Asaas falha ao criar payment: reserva fica sem asaas_id (recuperável), sem duplicar', async () => {
  const supabase = makeSupabase();
  const http = makeHttp({ postPayment: 'throw' });
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF })
    .then((x) => ({ ok: x })).catch((e) => ({ err: e }));

  assert.ok(r.err, 'deve lançar erro recuperável');
  assert.equal(r.err.motivo, 'falha_criar_cobranca_asaas');
  assert.equal(r.err.recuperavel, true);
  // Reserva existe sem asaas_id → retry reconcilia/cria sem duplicar.
  const reserva = supabase._store.faturas.find((f) => f.client_request_id === CRID);
  assert.ok(reserva);
  assert.equal(reserva.asaas_id, null);
});

test('retry após falha do Asaas: encontra a reserva e completa sem inserir de novo', async () => {
  // Estado pós-falha: reserva já existe sem asaas_id.
  const supabase = makeSupabase({
    faturas: [{ id: 'fat-reserva', empresa_id: 'e1', origem: 'recorrente', periodo_referencia: PERIODO, client_request_id: CRID, asaas_id: null, status: 'pendente' }],
  });
  const http = makeHttp(); // agora o Asaas responde; reconciliação vazia → cria uma vez
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva(), dataReferencia: DATA_REF });
  assert.equal(r.resultado, 'gerada');
  assert.equal(r.fatura.asaas_id, 'pay_1');
  assert.equal(supabase._calls.inserts.length, 0); // não reinsere; completa a reserva
});

// ─── valor / snapshot ────────────────────────────────────────────────────────
test('valor = preco_mensal (não recalcula); snapshot por_motorista correto', async () => {
  const planoPM = { id: 'p-pm', nome: 'Por Motorista', ativo: true, arquivado_em: null, preco_mensal: 1000, modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 10 };
  const supabase = makeSupabase();
  const http = makeHttp();
  const r = await gerarFaturaRecorrenteParaEmpresa({ supabase, http, config: CONFIG, empresa: empresaAtiva({ plano_id: 'p-pm', planos: planoPM }), dataReferencia: DATA_REF });
  const ins = supabase._calls.inserts[0];
  assert.equal(ins.valor, 1000);
  assert.equal(ins.modelo_cobranca_snapshot, 'por_motorista');
  assert.equal(ins.preco_unitario_snapshot, 100);
  assert.equal(ins.quantidade_snapshot, 10);
  // valor cobrado no Asaas = preco_mensal, não unitário×qtd recalculado divergente.
  const post = http._calls.posts.find((p) => p.url.endsWith('/payments'));
  assert.equal(post.body.value, 1000);
});

// ─── Pré-validação de cadastro ANTES da reserva (anti-órfã) ──────────────────

test('recorrência: sem customer e sem CPF/CNPJ → pulada cadastro_incompleto, ZERO reserva, ZERO Asaas', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();

  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: { apiKey: 'k', baseURL: 'https://sandbox.asaas.com/api/v3' },
    empresa: empresaAtiva({ asaas_customer_id: null, cnpj: '' }),
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'pulada');
  assert.equal(r.motivo, 'cadastro_incompleto');
  assert.deepEqual(r.camposFaltantes, ['cpf_cnpj']);
  assert.equal(supabase._calls.inserts.length, 0, 'não pode criar reserva órfã');
  assert.equal(http._calls.posts.length, 0);
});

test('recorrência: sem customer e sem e-mail → pulada cadastro_incompleto sem reserva', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();

  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: { apiKey: 'k', baseURL: 'https://sandbox.asaas.com/api/v3' },
    empresa: empresaAtiva({ asaas_customer_id: null, email_contato: 'invalido' }),
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'pulada');
  assert.equal(r.motivo, 'cadastro_incompleto');
  assert.equal(supabase._calls.inserts.length, 0);
});

test('recorrência: customer existente com cadastro incompleto → segue cobrando (validação não se aplica)', async () => {
  const supabase = makeSupabase();
  const http = makeHttp();

  const r = await gerarFaturaRecorrenteParaEmpresa({
    supabase, http, config: { apiKey: 'k', baseURL: 'https://sandbox.asaas.com/api/v3' },
    empresa: empresaAtiva({ cnpj: '', email_contato: '' }), // tem cus_1
    dataReferencia: DATA_REF,
  });

  assert.equal(r.resultado, 'gerada');
  assert.equal(supabase._calls.inserts.length, 1);
});

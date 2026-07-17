// Frente #8-C (Billing v2 / Macrofrente 1) — PR 2: orquestração da solicitação
// de upgrade + cobrança/fatura sandbox. Testes com supabase/http injetados
// (sem rede/DB). Provam: elegibilidade→status HTTP, idempotência, sem duplicar
// cobrança, e a trava de segurança de NÃO alterar empresas.plano_id.

const test = require('node:test');
const assert = require('node:assert/strict');

const { solicitarUpgrade, montarSnapshotFatura } = require('../services/upgradeRequestService');

const CONFIG = { apiKey: 'k-sandbox', baseURL: 'https://sandbox.asaas.com/api/v3' };
const PLANO_NOVO_UUID = '11111111-1111-1111-1111-111111111111';
const OUTRO_PLANO_UUID = '22222222-2222-2222-2222-222222222222';

// Empresa base: ativa, plano Básico (49.90), com customer Asaas e cadastro OK.
function empresaBase(over = {}) {
  return {
    id: 'e1',
    status: 'ativo',
    plano_id: 'p-basico',
    asaas_customer_id: 'cus_1',
    nome: 'Empresa Alfa',
    cnpj: '12345678000199',
    email_contato: 'alfa@example.com',
    telefone_contato: '',
    planos: { id: 'p-basico', nome: 'Plano Básico', preco_mensal: 49.9 },
    ...over,
  };
}

const PLANO_NOVO = { id: PLANO_NOVO_UUID, nome: 'Plano Profissional', preco_mensal: 99.9, ativo: true };

// ── Mock supabase encadeável, guiado por cenário; registra inserts/updates ────
function makeSupabase(scenario = {}) {
  const rec = { inserts: [], updates: [] };
  let solSeq = 0, fatSeq = 0;

  function builder(tabela) {
    const ctx = { tabela, filtros: {}, op: 'select', payload: null, maybe: false };
    const b = {
      select() { return b; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; rec.inserts.push({ tabela, payload: p }); return b; },
      update(p) { ctx.op = 'update'; ctx.payload = p; rec.updates.push({ tabela, payload: p }); return b; },
      eq(c, v) { ctx.filtros[c] = v; return b; },
      order() { return b; },
      limit() { return b; },
      in() { return b; },
      single() { return resolve(ctx); },
      maybeSingle() { ctx.maybe = true; return resolve(ctx); },
      then(onF, onR) { return resolve(ctx).then(onF, onR); },
    };
    return b;
  }

  async function resolve(ctx) {
    const { tabela, op, filtros, payload } = ctx;

    if (tabela === 'empresas' && op === 'select') {
      return { data: scenario.empresa ?? null, error: scenario.empresaError ?? null };
    }
    if (tabela === 'empresas' && op === 'update') {
      return { data: null, error: null };
    }
    if (tabela === 'planos' && op === 'select') {
      return { data: scenario.planoNovo ?? null, error: scenario.planoNovoError ?? null };
    }
    if (tabela === 'solicitacoes_upgrade_plano') {
      if (op === 'insert') {
        if (scenario.solicInsertError) return { data: null, error: scenario.solicInsertError };
        solSeq += 1;
        return { data: { id: `sol-${solSeq}`, status: 'pendente', ...payload }, error: null };
      }
      if (op === 'update') return { data: null, error: null };
      if (ctx.maybe) return { data: scenario.solicRecuperada ?? null, error: null };
      return { data: scenario.pendentes ?? [], error: scenario.pendErr ?? null };
    }
    if (tabela === 'faturas') {
      if (op === 'insert') {
        if (scenario.faturaInsertError) return { data: null, error: scenario.faturaInsertError };
        fatSeq += 1;
        return { data: { id: `fat-${fatSeq}`, ...payload }, error: null };
      }
      if (filtros.client_request_id) return { data: scenario.faturaByCrid ?? null, error: null };
      if (filtros.id) return { data: scenario.faturaById ?? null, error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  return { from: (t) => builder(t), __rec: rec };
}

// ── Mock http (axios-like) ───────────────────────────────────────────────────
function makeHttp(scenario = {}) {
  const calls = { posts: [], gets: [] };
  return {
    calls,
    async post(url, body) {
      calls.posts.push({ url, body });
      if (url.endsWith('/customers')) {
        if (scenario.customerError) throw scenario.customerError;
        return { data: { id: scenario.customerId || 'cus_new' } };
      }
      if (url.endsWith('/payments')) {
        if (scenario.paymentError) throw scenario.paymentError;
        return { data: scenario.payment || { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://asaas/inv/1' } };
      }
      return { data: {} };
    },
    async get(url) {
      calls.gets.push({ url });
      if (url.includes('/pixQrCode')) {
        if (scenario.pixError) throw scenario.pixError;
        return { data: { payload: scenario.pixPayload || 'PIX-COPIA-COLA' } };
      }
      return { data: {} };
    },
  };
}

function countPayments(http) {
  return http.calls.posts.filter((p) => p.url.endsWith('/payments')).length;
}
function nenhumUpdatePlanoId(rec) {
  return rec.updates.every(
    (u) => !(u.tabela === 'empresas' && u.payload && Object.prototype.hasOwnProperty.call(u.payload, 'plano_id'))
  );
}
async function capturar(promise) {
  try { await promise; return null; } catch (e) { return e; }
}

// ── Casos ─────────────────────────────────────────────────────────────────────

test('sucesso: cria solicitação + fatura (201) e NÃO altera plano_id', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_NOVO, pendentes: [] });
  const http = makeHttp({});
  const { httpStatus, resultado } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, criadoPor: 'u1', clientRequestId: 'req-1', config: CONFIG, supabase, http,
  });
  assert.equal(httpStatus, 201);
  assert.equal(resultado.solicitacao_id, 'sol-1');
  assert.equal(resultado.status, 'pendente');
  assert.equal(resultado.fatura.id, 'fat-1');
  assert.equal(resultado.fatura.valor, 99.9);
  assert.equal(resultado.fatura.tipo_pagamento, 'PIX');
  assert.equal(resultado.redirect, '/minhas-faturas');
  assert.equal(resultado.idempotente, false);
  assert.equal(countPayments(http), 1);
  assert.ok(nenhumUpdatePlanoId(supabase.__rec), 'não pode atualizar empresas.plano_id');
});

test('empresa sem customer + cadastro OK: cria customer e depois payment', async () => {
  const supabase = makeSupabase({ empresa: empresaBase({ asaas_customer_id: null }), planoNovo: PLANO_NOVO, pendentes: [] });
  const http = makeHttp({});
  const { httpStatus } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-2', config: CONFIG, supabase, http,
  });
  assert.equal(httpStatus, 201);
  const urls = http.calls.posts.map((p) => p.url);
  assert.ok(urls.some((u) => u.endsWith('/customers')), 'deve criar customer');
  assert.ok(urls.some((u) => u.endsWith('/payments')), 'deve criar payment');
  // garantirCustomer grava asaas_customer_id — mas NUNCA plano_id.
  assert.ok(nenhumUpdatePlanoId(supabase.__rec));
});

test('cadastro incompleto (sem CNPJ) e sem customer: 400', async () => {
  const supabase = makeSupabase({ empresa: empresaBase({ asaas_customer_id: null, cnpj: '' }), planoNovo: PLANO_NOVO, pendentes: [] });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-3', config: CONFIG, supabase, http,
  }));
  assert.ok(err);
  assert.equal(err.httpStatus, 400);
  assert.equal(countPayments(http), 0);
});

test('empresa suspensa: 409 regularizacaoNecessaria, sem cobrança', async () => {
  const supabase = makeSupabase({ empresa: empresaBase({ status: 'suspenso' }), planoNovo: PLANO_NOVO, pendentes: [] });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-4', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 409);
  assert.equal(err.body.regularizacaoNecessaria, true);
  assert.equal(err.body.redirect, '/minhas-faturas');
  assert.equal(countPayments(http), 0);
});

test('downgrade (plano inferior): 422 planoInvalido, sem cobrança', async () => {
  const supabase = makeSupabase({
    empresa: empresaBase({ planos: { id: 'p-pro', nome: 'Pro', preco_mensal: 199.9 } }),
    planoNovo: { id: PLANO_NOVO_UUID, nome: 'Menor', preco_mensal: 99.9, ativo: true },
    pendentes: [],
  });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-5', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 422);
  assert.equal(err.body.planoInvalido, true);
  assert.equal(countPayments(http), 0);
});

test('plano novo inexistente: 422 planoInvalido', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: null, pendentes: [] });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-6', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 422);
  assert.equal(err.body.planoInvalido, true);
});

test('plano_novo_id não-UUID: 400 planoInvalido (sem tocar Asaas)', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_NOVO });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: 'nao-uuid', clientRequestId: 'req-7', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 400);
  assert.equal(err.body.planoInvalido, true);
  assert.equal(countPayments(http), 0);
});

test('empresaId ausente: 400', async () => {
  const supabase = makeSupabase({});
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: null, planoNovoId: PLANO_NOVO_UUID, config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 400);
});

test('idempotência: pendente do MESMO plano com fatura → 200, sem 2ª cobrança', async () => {
  const supabase = makeSupabase({
    empresa: empresaBase(),
    planoNovo: PLANO_NOVO,
    pendentes: [{ id: 'sol-9', status: 'pendente', plano_novo_id: PLANO_NOVO_UUID, fatura_id: 'fat-9' }],
    faturaById: { id: 'fat-9', valor: 99.9, tipo_pagamento: 'PIX', status: 'pendente', invoice_url: 'u', pix_qr_code: 'p', due_date: '2026-07-23' },
  });
  const http = makeHttp({});
  const { httpStatus, resultado } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-8', config: CONFIG, supabase, http,
  });
  assert.equal(httpStatus, 200);
  assert.equal(resultado.idempotente, true);
  assert.equal(resultado.fatura.id, 'fat-9');
  assert.equal(countPayments(http), 0);
});

test('pendente de OUTRO plano: 409 upgradePendente, sem cobrança', async () => {
  const supabase = makeSupabase({
    empresa: empresaBase(),
    planoNovo: PLANO_NOVO,
    pendentes: [{ id: 'sol-9', status: 'pendente', plano_novo_id: OUTRO_PLANO_UUID, fatura_id: 'fat-9' }],
  });
  const http = makeHttp({});
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-9', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 409);
  assert.equal(err.body.upgradePendente, true);
  assert.equal(err.body.redirect, '/minhas-faturas');
  assert.equal(countPayments(http), 0);
});

test('falha do Asaas ao criar payment: 502, sem fatura inserida', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_NOVO, pendentes: [] });
  const http = makeHttp({ paymentError: new Error('asaas down') });
  const err = await capturar(solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-10', config: CONFIG, supabase, http,
  }));
  assert.equal(err.httpStatus, 502);
  // Solicitação foi criada; NENHUMA fatura inserida.
  assert.equal(supabase.__rec.inserts.filter((i) => i.tabela === 'solicitacoes_upgrade_plano').length, 1);
  assert.equal(supabase.__rec.inserts.filter((i) => i.tabela === 'faturas').length, 0);
  assert.equal(countPayments(http), 1);
});

test('corrida 23505 na solicitação com fatura existente → 200 idempotente', async () => {
  const supabase = makeSupabase({
    empresa: empresaBase(),
    planoNovo: PLANO_NOVO,
    pendentes: [],
    solicInsertError: { code: '23505', message: 'duplicate' },
    solicRecuperada: { id: 'sol-7', status: 'pendente', plano_novo_id: PLANO_NOVO_UUID, fatura_id: 'fat-7' },
    faturaById: { id: 'fat-7', valor: 99.9, tipo_pagamento: 'PIX', status: 'pendente', invoice_url: 'u', pix_qr_code: 'p', due_date: '2026-07-23' },
  });
  const http = makeHttp({});
  const { httpStatus, resultado } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-11', config: CONFIG, supabase, http,
  });
  assert.equal(httpStatus, 200);
  assert.equal(resultado.idempotente, true);
  assert.equal(resultado.fatura.id, 'fat-7');
  assert.equal(countPayments(http), 0);
});

// ── Frente #4 (PR 6): snapshot de plano na fatura (migration 030) ─────────────

// Devolve o payload do INSERT em `faturas` (o que de fato foi gravado).
function faturaInserida(rec) {
  const ins = rec.inserts.filter((i) => i.tabela === 'faturas');
  assert.equal(ins.length, 1, 'esperava exatamente 1 insert em faturas');
  return ins[0].payload;
}

const PLANO_POR_MOTORISTA = {
  id: PLANO_NOVO_UUID,
  nome: 'Plano Frota 10',
  preco_mensal: 1000, // derivado pelo backend: 100,00 × 10
  ativo: true,
  modelo_cobranca: 'por_motorista',
  preco_por_motorista: 100,
  limite_motoristas: 10,
};

const PLANO_FIXO = {
  id: PLANO_NOVO_UUID,
  nome: 'Plano Profissional',
  preco_mensal: 99.9,
  ativo: true,
  modelo_cobranca: 'fixo',
  preco_por_motorista: null,
  limite_motoristas: 10,
};

test('upgrade com plano FIXO grava snapshot fixo (unitário e quantidade NULL)', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_FIXO, pendentes: [] });
  const http = makeHttp({});
  await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-1', config: CONFIG, supabase, http,
  });

  const fatura = faturaInserida(supabase.__rec);
  assert.equal(fatura.plano_id, PLANO_NOVO_UUID);
  assert.equal(fatura.plano_nome_snapshot, 'Plano Profissional');
  assert.equal(fatura.modelo_cobranca_snapshot, 'fixo');
  // Não houve conta: o valor foi digitado. NULL = "não se aplica".
  assert.equal(fatura.preco_unitario_snapshot, null);
  assert.equal(fatura.quantidade_snapshot, null);
  // O valor cobrado continua sendo o final do plano.
  assert.equal(fatura.valor, 99.9);
});

test('upgrade com plano POR MOTORISTA grava snapshot completo', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_POR_MOTORISTA, pendentes: [] });
  const http = makeHttp({});
  await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-2', config: CONFIG, supabase, http,
  });

  const fatura = faturaInserida(supabase.__rec);
  assert.equal(fatura.plano_id, PLANO_NOVO_UUID);
  assert.equal(fatura.plano_nome_snapshot, 'Plano Frota 10');
  assert.equal(fatura.modelo_cobranca_snapshot, 'por_motorista');
  assert.equal(fatura.preco_unitario_snapshot, 100);
  assert.equal(fatura.quantidade_snapshot, 10);
  // A conta fecha: 100,00 × 10 = 1.000,00 — e é ISSO que foi cobrado.
  assert.equal(fatura.valor, 1000);
  assert.equal(fatura.preco_unitario_snapshot * fatura.quantidade_snapshot, fatura.valor);
});

test('o valor cobrado é o preco_mensal do plano, nunca recalculado aqui', async () => {
  // Plano incoerente de propósito: unitário × quantidade daria 500, mas
  // preco_mensal diz 1000. A fatura tem que seguir preco_mensal — quem deriva o
  // valor é o painel/backend de planos (PR 3), não este serviço.
  const incoerente = { ...PLANO_POR_MOTORISTA, preco_por_motorista: 50 };
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: incoerente, pendentes: [] });
  const http = makeHttp({});
  await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-3', config: CONFIG, supabase, http,
  });

  const fatura = faturaInserida(supabase.__rec);
  assert.equal(fatura.valor, 1000); // preco_mensal, não 50 × 10
  assert.equal(fatura.preco_unitario_snapshot, 50); // snapshot registra o que estava lá
});

test('o valor enviado ao Asaas é o mesmo da fatura (snapshot não interfere)', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_POR_MOTORISTA, pendentes: [] });
  const http = makeHttp({});
  await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-4', config: CONFIG, supabase, http,
  });

  const payment = http.calls.posts.find((p) => p.url.endsWith('/payments'));
  const fatura = faturaInserida(supabase.__rec);
  assert.equal(payment.body.value, 1000);
  assert.equal(payment.body.value, fatura.valor);
});

test('a solicitação continua vinculada à fatura e o plano_id da empresa não muda', async () => {
  const supabase = makeSupabase({ empresa: empresaBase(), planoNovo: PLANO_POR_MOTORISTA, pendentes: [] });
  const http = makeHttp({});
  const { resultado } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-5', config: CONFIG, supabase, http,
  });

  const vinculo = supabase.__rec.updates.find(
    (u) => u.tabela === 'solicitacoes_upgrade_plano' && u.payload && u.payload.fatura_id
  );
  assert.ok(vinculo, 'a solicitação precisa receber fatura_id');
  assert.equal(vinculo.payload.fatura_id, 'fat-1');
  assert.equal(resultado.fatura.id, 'fat-1');
  assert.ok(nenhumUpdatePlanoId(supabase.__rec), 'não pode atualizar empresas.plano_id');
});

test('idempotência: reuso de solicitação com fatura NÃO cria fatura nem cobrança extra', async () => {
  const supabase = makeSupabase({
    empresa: empresaBase(),
    planoNovo: PLANO_POR_MOTORISTA,
    pendentes: [{ id: 'sol-9', status: 'pendente', plano_novo_id: PLANO_NOVO_UUID, fatura_id: 'fat-9' }],
    faturaById: { id: 'fat-9', valor: 1000, tipo_pagamento: 'PIX', status: 'pendente', invoice_url: 'u', pix_qr_code: 'p', due_date: '2026-07-23' },
  });
  const http = makeHttp({});
  const { httpStatus, resultado } = await solicitarUpgrade({
    empresaId: 'e1', planoNovoId: PLANO_NOVO_UUID, clientRequestId: 'req-snap-6', config: CONFIG, supabase, http,
  });

  assert.equal(httpStatus, 200);
  assert.equal(resultado.idempotente, true);
  assert.equal(countPayments(http), 0);
  assert.equal(supabase.__rec.inserts.filter((i) => i.tabela === 'faturas').length, 0);
});

// ── montarSnapshotFatura isolado ─────────────────────────────────────────────

test('montarSnapshotFatura: plano sem modelo_cobranca (legado) resolve como fixo', async () => {
  const s = montarSnapshotFatura({ id: 'p1', nome: 'Legado', preco_mensal: 50 });
  assert.equal(s.modelo_cobranca_snapshot, 'fixo');
  assert.equal(s.preco_unitario_snapshot, null);
  assert.equal(s.quantidade_snapshot, null);
});

test('montarSnapshotFatura: fixo IGNORA unitário/quantidade fantasma do plano', async () => {
  // Defesa: mesmo que a linha tenha unitário sobrando, plano fixo não compõe.
  const s = montarSnapshotFatura({
    id: 'p1', nome: 'Fixo', modelo_cobranca: 'fixo', preco_por_motorista: 50, limite_motoristas: 3,
  });
  assert.equal(s.preco_unitario_snapshot, null);
  assert.equal(s.quantidade_snapshot, null);
});

test('montarSnapshotFatura: campos nulos não explodem (fatura antiga segue possível)', async () => {
  const s = montarSnapshotFatura(undefined);
  assert.deepEqual(s, {
    plano_id: null,
    plano_nome_snapshot: null,
    modelo_cobranca_snapshot: 'fixo',
    preco_unitario_snapshot: null,
    quantidade_snapshot: null,
  });
});

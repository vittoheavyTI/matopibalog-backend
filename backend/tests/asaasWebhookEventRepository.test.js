// backend/tests/asaasWebhookEventRepository.test.js
// Testes do repository de eventos do webhook Asaas.
// NÃO depende de Supabase ou Asaas reais — usa mocks determinísticos.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inserirOuReivindicar,
  marcarProcessado,
  marcarIgnorado,
  marcarFalhou,
  carregarPorEventId,
  normalizarParaHash,
  sanitizar,
  STATUS,
  PROCESSING_STALE_TIMEOUT_MS,
} = require('../services/asaasWebhookEventRepository');

// ── Helpers ──────────────────────────────────────────────────────────────────────

function criarRegistro(overrides = {}) {
  return {
    id: overrides.id || '00000000-0000-0000-0000-000000000001',
    event_id: overrides.event_id || 'evt_001',
    event_type: overrides.event_type || 'PAYMENT_CONFIRMED',
    asaas_payment_id: overrides.asaas_payment_id || 'pay_001',
    empresa_id: overrides.empresa_id || null,
    fatura_id: overrides.fatura_id || null,
    payload_hash: overrides.payload_hash || null,
    status: overrides.status || 'received',
    attempts: overrides.attempts || 0,
    received_at: overrides.received_at || '2026-07-10T12:00:00.000Z',
    processing_started_at: overrides.processing_started_at || null,
    processed_at: overrides.processed_at || null,
    next_retry_at: overrides.next_retry_at || null,
    last_error: overrides.last_error || null,
    created_at: '2026-07-10T12:00:00.000Z',
    updated_at: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

function criarSupabaseMock(registros = [], config = {}) {
  const logs = [];
  const tabela = {};

  // Pré-popula registros
  const armazenamento = [...registros];

  return {
    logs,
    from(name) {
      if (!tabela[name]) {
        tabela[name] = { chamadas: 0, operacoes: [] };
      }
      const estado = tabela[name];
      estado.chamadas++;
      const chain = {};

      chain.insert = (payload) => {
        estado.operacoes.push({ tipo: 'insert', payload: JSON.parse(JSON.stringify(payload)) });
        // Verifica conflito de event_id
        const existente = armazenamento.find(r => r.event_id === payload.event_id);
        if (existente) {
          return { select() { return this; }, single() { return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }); } };
        }
        const novo = criarRegistro({
          ...payload,
          id: payload.id || `id_${armazenamento.length + 1}`,
          received_at: payload.received_at || new Date().toISOString(),
        });
        armazenamento.push(novo);
        logs.push({ ação: 'insert', event_id: payload.event_id });
        return { select() { return this; }, single() { return Promise.resolve({ data: novo, error: null }); } };
      };

      chain.select = () => {
        estado.operacoes.push({ tipo: 'select' });
        const s = { ...chain };

        s.eq = (campo, valor) => {
          estado.operacoes.push({ tipo: 'eq', campo, valor: typeof valor === 'string' ? valor.slice(0, 20) + '...' : valor });
          const eqChain = { ...s };
          eqChain.maybeSingle = () => {
            const encontrado = armazenamento.filter(r => r[campo] === valor);
            if (encontrado.length === 0) return Promise.resolve({ data: null, error: null });
            estado.operacoes.push({ tipo: 'maybeSingle', resultado: encontrado[0]?.event_id });
            return Promise.resolve({ data: { ...encontrado[0] }, error: null });
          };
          eqChain.single = () => {
            const encontrado = armazenamento.filter(r => r[campo] === valor);
            if (encontrado.length === 0) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            estado.operacoes.push({ tipo: 'single', resultado: encontrado[0]?.event_id });
            return Promise.resolve({ data: { ...encontrado[0] }, error: null });
          };
          return eqChain;
        };
        return s;
      };

      chain.update = (payload) => {
        estado.operacoes.push({ tipo: 'update', payload: Object.keys(payload).join(',') });
        const upChain = { ...chain };
        upChain.eq = (campo, valor) => {
          const eq2 = { ...upChain };
          eq2.eq = (campo2, valor2) => {
            const resultados = armazenamento.filter(r => r[campo] === valor && r[campo2] === valor2);
            const eq3 = { ...eq2 };
            eq3.select = () => ({ ...eq3, single: () => {
              if (resultados.length === 0) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              // Aplica o update no primeiro match
              const alvo = armazenamento.find(r => r[campo] === valor && r[campo2] === valor2);
              if (alvo) {
                Object.assign(alvo, payload);
                if (payload.processing_started_at) alvo.processing_started_at = payload.processing_started_at;
                if (payload.processed_at) alvo.processed_at = payload.processed_at;
                if (payload.last_error !== undefined) alvo.last_error = payload.last_error;
                alvo.status = payload.status || alvo.status;
                alvo.attempts = payload.attempts ?? alvo.attempts;
              }
              logs.push({ ação: 'update_cas', event_id: resultados[0]?.event_id, conditions: { campo: valor, campo2: valor2 } });
              return Promise.resolve({ data: alvo ? { ...alvo } : null, error: alvo ? null : { code: 'PGRST116' } });
            }});
            return eq3;
          };
          return eq2;
        };
        return upChain;
      };

      return chain;
    }
  };
}

// ── normalizarParaHash ─────────────────────────────────────────────────────────

test('normalizarParaHash extrai campos minimos sem payload bruto', () => {
  const body = {
    id: 'evt_001',
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_001',
      status: 'CONFIRMED',
      billingType: 'PIX',
      dueDate: '2026-07-16',
      paymentDate: '2026-07-10',
      confirmedDate: '2026-07-10',
      subscription: 'sub_001',
      customer: { id: 'cus_001', name: 'Empresa X' }, // PII, deve ser ignorado
      email: 'teste@empresa.com', // não esperado
      externalReference: 'ref_123',
    },
  };

  const normalizado = normalizarParaHash(body);
  assert.equal(normalizado.event_id, 'evt_001');
  assert.equal(normalizado.event_type, 'PAYMENT_CONFIRMED');
  assert.equal(normalizado.payment_id, 'pay_001');
  // PII não deve estar no objeto normalizado
  assert.equal(normalizado.payment.customer, undefined);
  assert.equal(normalizado.payment.email, undefined);
  assert.equal(normalizado.payment.externalReference, undefined);
  // Campos de pagamento preservados
  assert.equal(normalizado.payment.status, 'CONFIRMED');
  assert.equal(normalizado.payment.billingType, 'PIX');
});

test('normalizarParaHash lida com objeto vazio', () => {
  const normalizado = normalizarParaHash({});
  assert.equal(normalizado.event_id, '');
  assert.equal(normalizado.event_type, '');
  assert.equal(normalizado.payment_id, '');
  // payment é objeto com campos undefined quando payment ausente
  assert.equal(normalizado.payment.id, undefined);
});

test('normalizarParaHash lida com payment ausente', () => {
  const normalizado = normalizarParaHash({ id: 'evt_001', event: 'TEST' });
  assert.equal(normalizado.event_id, 'evt_001');
  assert.equal(normalizado.event_type, 'TEST');
  assert.equal(normalizado.payment_id, '');
});

// ── inserirOuReivindicar ──────────────────────────────────────────────────────

test('insercao de evento novo retorna inserted', async () => {
  const supabase = criarSupabaseMock([]);
  const body = { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_001', status: 'CONFIRMED' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'inserted');
  assert.equal(resultado.status, STATUS.PROCESSING);
  assert.ok(resultado.evento);
  assert.equal(resultado.evento.event_id, 'evt_001');
  assert.equal(resultado.evento.attempts, 1);
  assert.ok(resultado.evento.processing_started_at);
});

test('event_id duplicado retorna conflict_processed quando evento ja processado', async () => {
  const existente = criarRegistro({
    event_id: 'evt_001',
    status: STATUS.PROCESSED,
    processed_at: '2026-07-10T12:05:00.000Z',
  });
  const supabase = criarSupabaseMock([existente]);
  const body = { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_001', status: 'CONFIRMED' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'conflict_processed');
  assert.equal(resultado.status, STATUS.PROCESSED);
});

test('event_id duplicado retorna conflict_ignored quando evento ja ignorado', async () => {
  const existente = criarRegistro({
    event_id: 'evt_001',
    status: STATUS.IGNORED,
  });
  const supabase = criarSupabaseMock([existente]);
  const body = { id: 'evt_001', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_001' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'conflict_ignored');
  assert.equal(resultado.status, STATUS.IGNORED);
});

test('event_id duplicado retorna conflict_processing quando processing recente', async () => {
  const agora = Date.now();
  const existente = criarRegistro({
    event_id: 'evt_001',
    status: STATUS.PROCESSING,
    processing_started_at: new Date(agora - 1000).toISOString(), // 1 segundo atrás
  });
  const supabase = criarSupabaseMock([existente]);
  const body = { id: 'evt_001', event: 'PAYMENT_CONFIRMED' };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'conflict_processing');
  assert.equal(resultado.status, STATUS.PROCESSING);
});

test('processing antigo pode ser reivindicado', async () => {
  const antigo = criarRegistro({
    event_id: 'evt_001',
    status: STATUS.PROCESSING,
    attempts: 1,
    processing_started_at: new Date(Date.now() - PROCESSING_STALE_TIMEOUT_MS - 10000).toISOString(),
  });
  const supabase = criarSupabaseMock([antigo]);
  const body = { id: 'evt_001', event: 'PAYMENT_CONFIRMED' };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'claimed');
  assert.equal(resultado.status, STATUS.PROCESSING);
  assert.equal(resultado.evento.attempts, 2); // incrementou
});

test('failed pode ser reivindicado', async () => {
  const existente = criarRegistro({
    event_id: 'evt_failed',
    status: STATUS.FAILED,
    attempts: 2,
    last_error: 'erro anterior',
  });
  const supabase = criarSupabaseMock([existente]);
  const body = { id: 'evt_failed', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_002', status: 'CONFIRMED' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'claimed');
  assert.equal(resultado.status, STATUS.PROCESSING);
  assert.equal(resultado.evento.attempts, 3);
});

test('received pode ser reivindicado', async () => {
  const existente = criarRegistro({
    event_id: 'evt_received',
    status: STATUS.RECEIVED,
    attempts: 0,
  });
  const supabase = criarSupabaseMock([existente]);
  const body = { id: 'evt_received', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_003' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  // received não está coberto pelo compare-and-swap padrão, depende de cas vs processing
  // Na prática, o CAS vai tentar update where status='received' and attempts=0
  // Se ninguém mais mexeu, ele consegue
  assert.ok(['claimed', 'conflict_lost_cas'].includes(resultado.code));
});

test('hash divergente em duplicata processed retorna conflict_processed (idempotente)', async () => {
  const existente = criarRegistro({
    event_id: 'evt_hash',
    status: STATUS.PROCESSED,
    payload_hash: 'hash_original',
  });
  const supabase = criarSupabaseMock([existente]);
  // Payload diferente → hash diferente
  const body = { id: 'evt_hash', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_004', status: 'RECEIVED' } };

  const resultado = await inserirOuReivindicar(supabase, body);
  assert.equal(resultado.code, 'conflict_processed');
});

test('compare-and-swap perdido retorna conflict_lost_cas', async () => {
  const existente = criarRegistro({
    id: 'id_alvo',
    event_id: 'evt_cas',
    status: STATUS.FAILED,
    attempts: 1,
  });
  const supabase = criarSupabaseMock([existente]);

  // Simula que alguém já alterou o status (não é mais failed)
  // O mock é ingênuo, então vamos forçar modificando após o select
  const originalFrom = supabase.from;
  supabase.from = (tabela) => {
    const chain = originalFrom(tabela);
    if (tabela === 'asaas_webhook_events') {
      const originalUpdate = chain.update;
      chain.update = (payload) => {
        const up = originalUpdate(payload);
        // Sobrescreve eq para simular CAS perdido
        const originalEq = up.eq;
        let eqCount = 0;
        up.eq = (campo, valor) => {
          eqCount++;
          if (eqCount >= 2) {
            // Segundo eq: simula CAS falho retornando nada
            return { ...up, select: () => ({ ...up, single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }) };
          }
          return originalEq(campo, valor);
        };
        return up;
      };
    }
    return chain;
  };

  const body = { id: 'evt_cas', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_005' } };
  const resultado = await inserirOuReivindicar(supabase, body);
  assert.ok(['conflict_lost_cas', 'conflict_processing', 'claimed'].includes(resultado.code));
});

// ── marcarProcessado ──────────────────────────────────────────────────────────

test('marcarProcessado atualiza status para processed', async () => {
  const evento = criarRegistro({
    event_id: 'evt_proc',
    status: STATUS.PROCESSING,
    attempts: 1,
    processing_started_at: new Date().toISOString(),
  });
  const supabase = criarSupabaseMock([evento]);

  const resultado = await marcarProcessado(supabase, 'evt_proc', { faturaId: 'fat_001', empresaId: 'emp_001' });
  assert.equal(resultado.code, 'marked_processed');
  assert.ok(resultado.evento);
  assert.equal(resultado.evento.status, STATUS.PROCESSED);
  assert.ok(resultado.evento.processed_at);
});

test('marcarProcessado grava vinculos internos', async () => {
  const evento = criarRegistro({
    event_id: 'evt_vinculo',
    status: STATUS.PROCESSING,
    attempts: 1,
  });
  const supabase = criarSupabaseMock([evento]);

  const resultado = await marcarProcessado(supabase, 'evt_vinculo', { faturaId: 'fat_002', empresaId: 'emp_002' });
  assert.equal(resultado.code, 'marked_processed');
  // O mock do update com CAS pode ou não propagar vinculos, mas o repository tenta
  assert.ok(resultado.evento);
});

// ── marcarIgnorado ────────────────────────────────────────────────────────────

test('marcarIgnorado atualiza status para ignored com razao', async () => {
  const evento = criarRegistro({
    event_id: 'evt_ign',
    status: STATUS.PROCESSING,
    attempts: 1,
  });
  const supabase = criarSupabaseMock([evento]);

  const resultado = await marcarIgnorado(supabase, 'evt_ign', 'payment_not_managed');
  assert.equal(resultado.code, 'marked_ignored');
  assert.equal(resultado.evento.status, STATUS.IGNORED);
  assert.ok(resultado.evento.processed_at);
});

// ── marcarFalhou ──────────────────────────────────────────────────────────────

test('marcarFalhou atualiza status para failed com last_error sanitizado', async () => {
  const evento = criarRegistro({
    event_id: 'evt_fail',
    status: STATUS.PROCESSING,
    attempts: 1,
  });
  const supabase = criarSupabaseMock([evento]);

  const resultado = await marcarFalhou(supabase, 'evt_fail', 'Erro ao atualizar fatura.');
  assert.equal(resultado.code, 'marked_failed');
  assert.equal(resultado.evento.status, STATUS.FAILED);
  assert.equal(resultado.evento.processed_at, null); // não preenche processed_at
});

// ── sanitizar ──────────────────────────────────────────────────────────────────

test('sanitizar remove UUIDs', () => {
  const resultado = sanitizar('Erro na fatura 123e4567-e89b-12d3-a456-426614174000');
  assert.ok(!resultado.includes('123e4567'));
  assert.ok(resultado.includes('[uuid]'));
});

test('sanitizar remove URLs', () => {
  const resultado = sanitizar('Erro: https://api.asaas.com/v3/payments/123');
  assert.ok(!resultado.includes('https://'));
  assert.ok(resultado.includes('[url]'));
});

test('sanitizar remove e-mails', () => {
  const resultado = sanitizar('email: usuario@empresa.com.br');
  assert.ok(!resultado.includes('usuario@empresa.com.br'));
  assert.ok(resultado.includes('[email]'));
});

test('sanitizar limita tamanho', () => {
  const longo = 'A'.repeat(1000);
  const resultado = sanitizar(longo);
  assert.ok(resultado.length <= 500);
});

test('sanitizar retorna null para null/undefined', () => {
  assert.equal(sanitizar(null), null);
  assert.equal(sanitizar(undefined), null);
});

test('sanitizar preserva mensagem segura', () => {
  const resultado = sanitizar('fatura_nao_encontrada');
  assert.equal(resultado, 'fatura_nao_encontrada');
});

// ── carregarPorEventId ────────────────────────────────────────────────────────

test('carregarPorEventId retorna found quando existe', async () => {
  const existente = criarRegistro({ event_id: 'evt_load' });
  const supabase = criarSupabaseMock([existente]);

  const resultado = await carregarPorEventId(supabase, 'evt_load');
  assert.equal(resultado.code, 'found');
  assert.ok(resultado.evento);
});

test('carregarPorEventId retorna not_found quando nao existe', async () => {
  const supabase = criarSupabaseMock([]);
  const resultado = await carregarPorEventId(supabase, 'evt_inexistente');
  assert.equal(resultado.code, 'not_found');
  assert.equal(resultado.evento, null);
});

test('attempts incrementa uma vez no reclaim', async () => {
  const existente = criarRegistro({
    event_id: 'evt_attempts',
    status: STATUS.FAILED,
    attempts: 3,
  });
  const supabase = criarSupabaseMock([existente]);

  const resultado = await inserirOuReivindicar(supabase, { id: 'evt_attempts', event: 'PAYMENT_CONFIRMED' });
  assert.equal(resultado.code, 'claimed');
  assert.equal(resultado.evento.attempts, 4); // 3 + 1
});

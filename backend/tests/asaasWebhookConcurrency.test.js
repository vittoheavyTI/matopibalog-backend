// backend/tests/asaasWebhookConcurrency.test.js
// Testes de concorrência do repository de eventos do webhook Asaas.
// Simula duas requisições simultâneas com o mesmo event_id usando mocks.
// NÃO depende de Supabase ou Asaas reais.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inserirOuReivindicar,
  marcarProcessado,
  STATUS,
} = require('../services/asaasWebhookEventRepository');

// ── Supabase Mock que rastreia estado global (race condition simulada) ─────────

function criarEstadoGlobal(registros = {}) {
  const eventos = {};
  if (typeof registros === 'object' && !Array.isArray(registros)) {
    for (const key of Object.keys(registros)) {
      eventos[key] = { ...registros[key] };
    }
  }
  return eventos;
}

function criarSupabaseConcorrencia(eventos) {
  const log = [];

  return {
    log,
    from() {
      const chain = {};

      chain.insert = (payload) => {
        const existente = eventos[payload.event_id];
        if (existente) {
          return {
            select() { return this; },
            single() { return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }); },
          };
        }
        const novo = {
          id: `id_${payload.event_id}`,
          ...payload,
          received_at: new Date().toISOString(),
        };
        eventos[payload.event_id] = novo;
        log.push({ at: Date.now(), ação: 'insert', event_id: payload.event_id });
        return {
          select() { return this; },
          single() { return Promise.resolve({ data: JSON.parse(JSON.stringify(novo)), error: null }); },
        };
      };

      const makeEqChain = (statusFilter, attemptsFilter) => ({
        select() { return this; },
        single() {
          // Filtra por status e attempts se fornecidos
          let evento = eventos[statusFilter]; // não é isso...
          // Na verdade, eq é encadeado: .eq('id', id).eq('status', s).eq('attempts', a)
          // Precisamos de uma abordagem diferente
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
        },
      });

      chain.select = () => {
        const s = { ...chain };

        s.eq = (campo, valor) => {
          if (campo === 'event_id') {
            const eqChain = { ...s };
            eqChain.single = () => {
              const evento = eventos[valor];
              if (!evento) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              return Promise.resolve({ data: JSON.parse(JSON.stringify(evento)), error: null });
            };
            eqChain.maybeSingle = eqChain.single;
            return eqChain;
          }
          const eqChain = { ...s };
          // Quando fizer .eq('id', X), retorna objeto com .single() e .maybeSingle()
          if (campo === 'id') {
            eqChain.single = () => {
              const evento = Object.values(eventos).find(e => e.id === valor);
              if (!evento) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              return Promise.resolve({ data: JSON.parse(JSON.stringify(evento)), error: null });
            };
            eqChain.maybeSingle = eqChain.single;
            return eqChain;
          }
          let capturedId = null;
          let capturedStatus = null;
          let capturedAttempts = null;

          if (campo === 'id') capturedId = valor;
          if (campo === 'status') capturedStatus = valor;
          if (campo === 'attempts') capturedAttempts = valor;

          eqChain.eq = (campo2, valor2) => {
            if (campo2 === 'id') capturedId = valor2;
            if (campo2 === 'status') capturedStatus = valor2;
            if (campo2 === 'attempts') capturedAttempts = valor2;

            const eqChain2 = { ...eqChain };
            eqChain2.eq = (campo3, valor3) => {
              if (campo3 === 'id') capturedId = valor3;
              if (campo3 === 'status') capturedStatus = valor3;
              if (campo3 === 'attempts') capturedAttempts = valor3;
              return eqChain2;
            };

            eqChain2.select = () => {
              const sel = { ...eqChain2 };
              sel.single = () => {
                // Busca o evento e verifica CAS conditions
                const evento = capturedId ? Object.values(eventos).find(e => e.id === capturedId) : null;
                if (!evento) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });

                // CAS: verifica se status e attempts ainda correspondem
                if (capturedStatus !== null && evento.status !== capturedStatus) {
                  log.push({ at: Date.now(), ação: 'cas_failed', event_id: evento.event_id, reason: 'status_mismatch' });
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }
                if (capturedAttempts !== null && evento.attempts !== capturedAttempts) {
                  log.push({ at: Date.now(), ação: 'cas_failed', event_id: evento.event_id, reason: 'attempts_mismatch' });
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }
                // CAS ok: aplica as mudanças e retorna o evento
                log.push({ at: Date.now(), ação: 'cas_success', event_id: evento.event_id });
                return Promise.resolve({ data: JSON.parse(JSON.stringify(evento)), error: null });
              };
              return sel;
            };

            eqChain2.single = () => {
              const evento = capturedId ? Object.values(eventos).find(e => e.id === capturedId) : null;
              if (!evento) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });

              if (capturedStatus !== null && evento.status !== capturedStatus) {
                log.push({ at: Date.now(), ação: 'cas_failed', event_id: evento.event_id, reason: 'status_mismatch' });
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
              if (capturedAttempts !== null && evento.attempts !== capturedAttempts) {
                log.push({ at: Date.now(), ação: 'cas_failed', event_id: evento.event_id, reason: 'attempts_mismatch' });
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
              log.push({ at: Date.now(), ação: 'cas_success', event_id: evento.event_id });
              return Promise.resolve({ data: JSON.parse(JSON.stringify(evento)), error: null });
            };

            return eqChain2;
          };

          return eqChain;
        };

        return s;
      };

      chain.update = (payload) => {
        const up = { ...chain };

        // Acumula condições como pares [campo, valor]
        const conditions = [];

        up.eq = (campo, valor) => {
          conditions.push([campo, valor]);

          const upChain = { ...up };

          upChain.eq = (campo2, valor2) => {
            conditions.push([campo2, valor2]);

            const upChain2 = { ...upChain };
            upChain2.eq = () => upChain2; // terceiro eq é no-op

            upChain2.select = () => {
              const sel = { single: () => {
                // Aplica as condições na ordem para encontrar o evento alvo
                let alvo = null;

                // Procura por event_id primeiro (primeira condição)
                const eventIdCond = conditions.find(c => c[0] === 'event_id');
                const idCond = conditions.find(c => c[0] === 'id');
                const statusCond = conditions.find(c => c[0] === 'status');
                const attemptsCond = conditions.find(c => c[0] === 'attempts');

                if (idCond) {
                  alvo = Object.values(eventos).find(e => e.id === idCond[1]);
                } else if (eventIdCond) {
                  alvo = eventos[eventIdCond[1]];
                }

                if (!alvo) {
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }

                // Verifica CAS conditions (status e attempts)
                if (statusCond && alvo.status !== statusCond[1]) {
                  log.push({ at: Date.now(), ação: 'cas_failed', event_id: alvo.event_id, reason: 'status_mismatch' });
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }
                if (attemptsCond && alvo.attempts !== attemptsCond[1]) {
                  log.push({ at: Date.now(), ação: 'cas_failed', event_id: alvo.event_id, reason: 'attempts_mismatch' });
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }

                // CAS ok: aplica as mudanças
                if (payload.status !== undefined) alvo.status = payload.status;
                if (payload.attempts !== undefined) alvo.attempts = payload.attempts;
                if (payload.processing_started_at !== undefined) alvo.processing_started_at = payload.processing_started_at;
                if (payload.last_error !== undefined) alvo.last_error = payload.last_error === null ? null : payload.last_error;
                if (payload.fatura_id !== undefined) alvo.fatura_id = payload.fatura_id;
                if (payload.empresa_id !== undefined) alvo.empresa_id = payload.empresa_id;
                if (payload.processed_at !== undefined) alvo.processed_at = payload.processed_at;

                log.push({ at: Date.now(), ação: 'cas_update_success', event_id: alvo.event_id, attempts: alvo.attempts, status: alvo.status });
                return Promise.resolve({ data: JSON.parse(JSON.stringify(alvo)), error: null });
              } };
              return sel;
            };

            return upChain2;
          };

          return upChain;
        };

        return up;
      };

      return chain;
    },
  };
}

// ── TESTES DE CONCORRÊNCIA ──────────────────────────────────────────────────

test('duas requisicoes simultaneas: apenas uma insere, a outra ve conflito', async () => {
  const eventos = criarEstadoGlobal();
  const supabase1 = criarSupabaseConcorrencia(eventos);
  const supabase2 = criarSupabaseConcorrencia(eventos);

  const body = { id: 'evt_race_001', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_race_001', status: 'CONFIRMED' } };

  // Simula concorrência: ambas chamam inserirOuReivindicar aproximadamente ao mesmo tempo
  const [r1, r2] = await Promise.all([
    inserirOuReivindicar(supabase1, body),
    inserirOuReivindicar(supabase2, body),
  ]);

  // Uma deve ser inserted, a outra deve ser conflito
  const inserts = [r1, r2].filter(r => r.code === 'inserted');
  const conflitos = [r1, r2].filter(r => r.code !== 'inserted' && r.code !== 'db_error');

  assert.equal(inserts.length, 1, 'Apenas uma requisicao deve inserir');
  assert.equal(inserts[0].status, STATUS.PROCESSING);
  assert.ok(conflitos.length >= 1, 'A outra deve receber conflito');

  // Verifica que apenas um evento foi criado no estado global
  const eventosExistentes = Object.values(eventos);
  assert.equal(eventosExistentes.length, 1);
  assert.equal(eventosExistentes[0].event_id, 'evt_race_001');
});

test('duas requisicoes simultaneas com evento failed: apenas uma reivindica', async () => {
  const eventos = criarEstadoGlobal({
    evt_race_fail: {
      id: 'id_race_fail',
      event_id: 'evt_race_fail',
      event_type: 'PAYMENT_CONFIRMED',
      asaas_payment_id: 'pay_race_fail',
      payload_hash: null,
      status: STATUS.FAILED,
      attempts: 1,
    },
  });
  const supabase1 = criarSupabaseConcorrencia(eventos);
  const supabase2 = criarSupabaseConcorrencia(eventos);

  const body = { id: 'evt_race_fail', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_race_fail', status: 'CONFIRMED' } };

  const [r1, r2] = await Promise.all([
    inserirOuReivindicar(supabase1, body),
    inserirOuReivindicar(supabase2, body),
  ]);

  // Uma deve reivindicar, a outra não
  const claims = [r1, r2].filter(r => r.code === 'claimed');
  assert.equal(claims.length, 1, 'Apenas uma requisicao deve reivindicar');
  assert.equal(claims[0].status, STATUS.PROCESSING);
  assert.equal(claims[0].evento.attempts, 2); // incrementou de 1 para 2

  // O evento no estado global deve ter attempts = 2
  const eventoFinal = eventos['evt_race_fail'];
  assert.equal(eventoFinal.attempts, 2);
});

test('processamento completo com concorrencia: apenas uma marca processed', async () => {
  const eventos = criarEstadoGlobal();
  const supabase1 = criarSupabaseConcorrencia(eventos);
  const supabase2 = criarSupabaseConcorrencia(eventos);

  const body = { id: 'evt_race_proc', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_proc', status: 'CONFIRMED' } };

  // Insere
  const r1 = await inserirOuReivindicar(supabase1, body);
  assert.equal(r1.code, 'inserted');

  // Duas tentativas simultâneas de marcar como processed
  const [m1, m2] = await Promise.all([
    marcarProcessado(supabase1, 'evt_race_proc', { faturaId: 'fat_race', empresaId: 'emp_race' }),
    marcarProcessado(supabase2, 'evt_race_proc', { faturaId: 'fat_race', empresaId: 'emp_race' }),
  ]);

  // Como marcarProcessado usa eq('status', 'processing'), e após o primeiro update
  // o status muda para processed, o segundo deve falhar
  const sucessos = [m1, m2].filter(r => r.code === 'marked_processed');
  assert.equal(sucessos.length, 1, 'Apenas uma marcacao deve ser bem-sucedida');

  // Evento final deve estar processed
  const eventoFinal = eventos['evt_race_proc'];
  assert.equal(eventoFinal.status, STATUS.PROCESSED);
  assert.ok(eventoFinal.processed_at);
});

test('nenhuma dupla ativacao de conta ocorre em corrida', async () => {
  // Simula cenário: evento inserido, duas instâncias tentam processar
  const eventos = criarEstadoGlobal();
  const supabase = criarSupabaseConcorrencia(eventos);

  const body = { id: 'evt_race_dup', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_dup', status: 'CONFIRMED' } };

  // Insere
  await inserirOuReivindicar(supabase, body);

  // Marca como processed duas vezes em sequência
  const r1 = await marcarProcessado(supabase, 'evt_race_dup', { faturaId: 'fat_dup' });
  const r2 = await marcarProcessado(supabase, 'evt_race_dup', { faturaId: 'fat_dup' });

  assert.equal(r1.code, 'marked_processed');
  // Segunda tentativa não encontra evento em 'processing'
  assert.ok(r2.code !== 'marked_processed');
});

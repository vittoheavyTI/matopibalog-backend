'use strict';

// Contrato do OUTBOX do ERP Hub (§9). Define a máquina de estados e os invariantes
// crash-safe SEM criar schema nesta fatia (MIGRATION_REQUIRED=false). A persistência
// real (tabela + claim CAS multi-processo, no idioma do billing_outbox/066) é a
// próxima fatia (E3.7B) — mas os invariantes já são definidos e testados aqui contra
// uma implementação em memória, para que o schema futuro apenas os materialize.
//
// Invariantes (idênticos em espírito ao billing_outbox):
//   - idempotência de ENFILEIRAMENTO: 1 item por dedupe_key (idempotency key).
//   - tenant isolation: todo item carrega empresa_id; consultas filtram por ele.
//   - máquina de estados explícita: pending → processing → processed | failed → dead.
//   - retry com backoff; max_attempts excedido → dead (nunca loop infinito).
//   - last_error SEMPRE sanitizado (sem segredo/PII).
//   - nenhum sucesso é registrado antes da confirmação da autoridade (o worker só
//     chama markProcessed após o adapter confirmar — reconcile SUCCEEDED).

const { LIMITS } = require('./config');

const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  DEAD: 'dead',
});

// Transições válidas — qualquer outra é recusada (defesa da máquina de estados).
const VALID_TRANSITIONS = Object.freeze({
  pending: ['processing'],
  // De 'processing' um item pode ser concluído, falhar (com retry) ou, se estourou
  // max_attempts, ir direto para 'dead' — uma falha terminal não precisa passar por
  // 'failed' antes de morrer.
  processing: ['processed', 'failed', 'dead'],
  failed: ['processing', 'dead'],
  processed: [],
  dead: [],
});

function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// Sanitiza mensagens de erro antes de persistir (mesmo idioma do billing).
function sanitizeError(msg) {
  if (!msg) return null;
  let s = String(msg);
  if (s.length > 500) s = s.slice(0, 497) + '...';
  s = s.replace(/\b[a-fA-F0-9]{20,}\b/g, '[token]');
  s = s.replace(/\bBearer\s+[^\s]+/gi, '[secret]');
  s = s.replace(/https?:\/\/[^\s]+/g, '[url]');
  return s;
}

function backoffMs(attempts) {
  return Math.min(60 * 60 * 1000, Math.max(30 * 1000, attempts * 60 * 1000));
}

// Implementação em MEMÓRIA do contrato do outbox. Injetável em testes/worker.
// A assinatura dos métodos é intencionalmente compatível com um repositório
// persistente futuro (async), para que trocar in-memory → SQL não mude o worker.
function createInMemoryOutbox({ maxAttempts = LIMITS.MAX_ATTEMPTS_DEFAULT } = {}) {
  const items = new Map();        // id → item
  const byDedupe = new Map();     // dedupe_key → id
  let seq = 0;

  function novoId() { seq += 1; return `erpobx_${seq}`; }

  async function enqueue({ empresaId, eventType, dedupeKey, payload = {} }) {
    if (!empresaId) throw new Error('outbox.enqueue: empresaId obrigatorio');
    if (!dedupeKey) throw new Error('outbox.enqueue: dedupeKey obrigatorio');
    // Idempotência: mesmo dedupe_key nunca cria duas linhas.
    if (byDedupe.has(dedupeKey)) {
      return { enfileirado: false, code: 'duplicate', item: items.get(byDedupe.get(dedupeKey)) };
    }
    const id = novoId();
    const now = new Date().toISOString();
    const item = {
      id, empresa_id: empresaId, event_type: eventType, dedupe_key: dedupeKey,
      status: OUTBOX_STATUS.PENDING, attempts: 0, max_attempts: maxAttempts,
      next_retry_at: null, last_error: null, payload,
      created_at: now, updated_at: now,
    };
    items.set(id, item);
    byDedupe.set(dedupeKey, id);
    return { enfileirado: true, code: 'inserted', item };
  }

  // Reivindica um item elegível (pending, ou failed com retry vencido). CAS
  // implícito: em memória é single-thread; a assinatura casa com o CAS do SQL.
  async function claimNext({ now = new Date() } = {}) {
    const nowMs = now.getTime();
    const candidatos = [...items.values()]
      .filter((it) => it.status === OUTBOX_STATUS.PENDING
        || (it.status === OUTBOX_STATUS.FAILED && (!it.next_retry_at || new Date(it.next_retry_at).getTime() <= nowMs)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const cand = candidatos[0];
    if (!cand) return { item: null, code: 'empty' };
    if (!canTransition(cand.status, OUTBOX_STATUS.PROCESSING)) return { item: null, code: 'blocked' };
    cand.status = OUTBOX_STATUS.PROCESSING;
    cand.attempts += 1;
    cand.updated_at = now.toISOString();
    cand.last_error = null;
    return { item: { ...cand }, code: 'claimed' };
  }

  async function markProcessed(id, { now = new Date() } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    if (!canTransition(it.status, OUTBOX_STATUS.PROCESSED)) return { code: 'invalid_transition', from: it.status };
    it.status = OUTBOX_STATUS.PROCESSED;
    it.processed_at = now.toISOString();
    it.updated_at = it.processed_at;
    it.last_error = null;
    return { code: 'processed', item: { ...it } };
  }

  async function markFailed(id, razao, { now = new Date() } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const excedeu = it.attempts >= it.max_attempts;
    const alvo = excedeu ? OUTBOX_STATUS.DEAD : OUTBOX_STATUS.FAILED;
    if (!canTransition(it.status, alvo)) return { code: 'invalid_transition', from: it.status };
    it.status = alvo;
    it.next_retry_at = excedeu ? null : new Date(now.getTime() + backoffMs(it.attempts)).toISOString();
    it.updated_at = now.toISOString();
    it.last_error = sanitizeError(razao);
    return { code: excedeu ? 'dead' : 'failed', item: { ...it } };
  }

  async function countByStatus(empresaId = null) {
    const contagem = { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 };
    for (const it of items.values()) {
      if (empresaId && it.empresa_id !== empresaId) continue;
      if (contagem[it.status] != null) contagem[it.status] += 1;
    }
    return contagem;
  }

  // Só para inspeção em testes; um repositório real não exporia isto.
  function _all(empresaId = null) {
    return [...items.values()].filter((it) => !empresaId || it.empresa_id === empresaId).map((it) => ({ ...it }));
  }

  return { enqueue, claimNext, markProcessed, markFailed, countByStatus, _all };
}

module.exports = {
  OUTBOX_STATUS,
  VALID_TRANSITIONS,
  canTransition,
  sanitizeError,
  backoffMs,
  createInMemoryOutbox,
};

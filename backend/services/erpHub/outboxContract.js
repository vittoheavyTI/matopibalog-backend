'use strict';

// Contrato do OUTBOX do ERP Hub (§9). Define a máquina de estados e os invariantes
// de recuperação SEM criar schema nesta fatia (MIGRATION_REQUIRED=false). A
// persistência real (tabela + claim CAS multi-processo, no idioma do
// billing_outbox/066) é a próxima fatia (E3.7B) — mas os invariantes já são
// definidos e testados aqui contra uma implementação em memória, para que o schema
// futuro apenas os materialize.
//
// Estado do contrato: CRASH_SAFE_CONTRACT_DEFINED. Não é "production crash-safe":
// sem persistência, um crash do processo perde a fila inteira. O que está definido e
// provado aqui é a SEMÂNTICA que torna a versão persistida recuperável — lease com
// expiração, reclaim determinístico e recusa de claim obsoleto.
//
// Invariantes:
//   - idempotência de ENFILEIRAMENTO: 1 item por (empresa_id, dedupe_key).
//   - tenant isolation NA PRÓPRIA CAMADA (HIGH-02), não por convenção do caller.
//   - só aceita ENVELOPE CANÔNICO válido (MEDIUM-03) — nada de payload arbitrário.
//   - máquina de estados explícita: pending → processing → processed | failed → dead.
//   - lease de processamento com expiração + reclaim (HIGH-04).
//   - claim obsoleto não finaliza trabalho de outro worker (HIGH-04).
//   - retry com backoff; max_attempts excedido → dead (nunca loop infinito).
//   - last_error SEMPRE sanitizado (sem segredo/PII).
//   - nenhum sucesso é registrado antes da confirmação da autoridade (o worker só
//     chama markProcessed após o adapter confirmar — reconcile SUCCEEDED).

const crypto = require('node:crypto');
const { LIMITS } = require('./config');
const { validateEnvelope } = require('./canonicalEnvelope');

const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  DEAD: 'dead',
});

// Transições válidas — qualquer outra é recusada (defesa da máquina de estados).
// O self-loop processing→processing é o RECLAIM de um lease expirado: o item segue
// em processamento, mas sob um novo claim (o antigo passa a ser obsoleto).
const VALID_TRANSITIONS = Object.freeze({
  pending: ['processing'],
  processing: ['processed', 'failed', 'dead', 'processing'],
  failed: ['processing', 'dead'],
  processed: [],
  dead: [],
});

// Lease padrão: janela em que um worker tem posse exclusiva do item. Curto o
// bastante para o trabalho voltar rápido se o worker morrer, longo o bastante para
// uma chamada externa normal terminar.
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// Sanitiza mensagens de erro antes de persistir.
// Ordem importa: os padrões específicos rodam ANTES do genérico de URL, e o
// TRUNCAMENTO vem por último — truncar antes poderia cortar um token ao meio e
// deixar o fragmento passar pelos padrões seguintes.
// Escopo honesto: isto é higiene de log, não DLP. Cobre os formatos que este
// domínio realmente produz (Authorization, chaves de API com prefixo, segredo em
// query string, hex longo); um segredo em formato arbitrário pode escapar, e por
// isso a regra primária continua sendo NUNCA passar segredo ao Hub (o envelope
// recusa chaves sensíveis fail-closed).
function sanitizeError(msg) {
  if (!msg) return null;
  let s = String(msg);
  s = s.replace(/\bBearer\s+\S+/gi, 'Bearer [secret]');
  s = s.replace(/\b(?:sk|pk|rk|api|key)[-_][A-Za-z0-9_-]{8,}\b/gi, '[secret]');
  // segredo em query string (com ou sem URL completa em volta)
  s = s.replace(/([?&](?:token|key|api_?key|secret|password|senha|access_token)=)[^\s&#]+/gi, '$1[secret]');
  s = s.replace(/https?:\/\/\S+/g, '[url]');
  s = s.replace(/\b[a-fA-F0-9]{20,}\b/g, '[token]');
  if (s.length > 500) s = s.slice(0, 497) + '...';
  return s;
}

function backoffMs(attempts) {
  return Math.min(60 * 60 * 1000, Math.max(30 * 1000, attempts * 60 * 1000));
}

// Implementação em MEMÓRIA do contrato do outbox. Injetável em testes/worker.
// A assinatura dos métodos é intencionalmente compatível com um repositório
// persistente futuro (async), para que trocar in-memory → SQL não mude o worker.
function createInMemoryOutbox({
  maxAttempts = LIMITS.MAX_ATTEMPTS_DEFAULT,
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  const items = new Map();        // id → item
  const byDedupe = new Map();     // `${empresa_id}|${dedupe_key}` → id
  let seq = 0;

  function novoId() { seq += 1; return `erpobx_${seq}`; }

  // HIGH-02: a identidade de dedupe é composta pelo TENANT + a chave. Antes o mapa
  // era indexado só por dedupe_key, então a camada dependia de o caller ter incluído
  // empresa_id na chave — uma garantia por convenção, não por contrato. Bastava um
  // caller usar uma chave "natural" (um número de pedido, por exemplo) para o evento
  // do tenant B ser descartado como duplicata do tenant A, ou pior, para um duplicate
  // devolver o item de OUTRO tenant.
  function dedupeIndex(empresaId, dedupeKey) {
    return `${empresaId}|${dedupeKey}`;
  }

  // MEDIUM-03: o outbox é um elo da cadeia
  //   DOMÍNIO → ENVELOPE CANÔNICO → OUTBOX → PROVIDER ADAPTER → ERP
  // então ele só aceita o envelope canônico. `empresa_id` e `event_type` são LIDOS
  // do envelope, nunca recebidos em paralelo: duas autoridades para o mesmo dado
  // divergiriam em silêncio.
  async function enqueue({ envelope, dedupeKey }) {
    const v = validateEnvelope(envelope);
    if (!v.ok) {
      return { enfileirado: false, code: 'invalid_envelope', motivo: v.motivo, chaveSensivel: v.chaveSensivel || null };
    }
    if (typeof dedupeKey !== 'string' || dedupeKey.trim() === '') {
      throw new Error('outbox.enqueue: dedupeKey obrigatorio');
    }

    const empresaId = envelope.empresa_id;   // autoridade única
    const eventType = envelope.event_type;   // autoridade única
    const idx = dedupeIndex(empresaId, dedupeKey);

    // Idempotência: mesmo (tenant, dedupe_key) nunca cria duas linhas.
    if (byDedupe.has(idx)) {
      const existente = items.get(byDedupe.get(idx));
      return { enfileirado: false, code: 'duplicate', item: { ...existente } };
    }

    const id = novoId();
    const now = new Date().toISOString();
    const item = {
      id,
      empresa_id: empresaId,
      event_type: eventType,
      dedupe_key: dedupeKey,
      envelope,
      status: OUTBOX_STATUS.PENDING,
      attempts: 0,
      max_attempts: maxAttempts,
      next_retry_at: null,
      claim_id: null,
      claimed_at: null,
      lease_expires_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
    items.set(id, item);
    byDedupe.set(idx, id);
    return { enfileirado: true, code: 'inserted', item: { ...item } };
  }

  function elegivel(it, nowMs) {
    if (it.status === OUTBOX_STATUS.PENDING) return true;
    if (it.status === OUTBOX_STATUS.FAILED) {
      return !it.next_retry_at || new Date(it.next_retry_at).getTime() <= nowMs;
    }
    // HIGH-04: item preso em `processing` cujo lease venceu — o worker que o
    // reivindicou provavelmente morreu. Sem isto, um crash deixaria o item travado
    // para sempre e a fila silenciosamente pararia de progredir.
    if (it.status === OUTBOX_STATUS.PROCESSING) {
      return Boolean(it.lease_expires_at) && new Date(it.lease_expires_at).getTime() <= nowMs;
    }
    return false; // processed/dead são terminais e NUNCA voltam
  }

  // Reivindica um item elegível e devolve um claimToken. O token é a prova de posse:
  // markProcessed/markFailed exigem o token VIGENTE, então um worker que voltou do
  // limbo depois do reclaim não consegue finalizar o trabalho de quem o substituiu.
  async function claimNext({ now = new Date(), leaseMs: leaseOverride } = {}) {
    const nowMs = now.getTime();
    const janela = leaseOverride || leaseMs;
    const candidatos = [...items.values()]
      .filter((it) => elegivel(it, nowMs))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const cand = candidatos[0];
    if (!cand) return { item: null, claimToken: null, code: 'empty' };
    if (!canTransition(cand.status, OUTBOX_STATUS.PROCESSING)) {
      return { item: null, claimToken: null, code: 'blocked' };
    }

    const reclaim = cand.status === OUTBOX_STATUS.PROCESSING;
    const claimToken = crypto.randomUUID();
    cand.status = OUTBOX_STATUS.PROCESSING;
    cand.attempts += 1;
    cand.claim_id = claimToken;              // invalida qualquer claim anterior
    cand.claimed_at = now.toISOString();
    cand.lease_expires_at = new Date(nowMs + janela).toISOString();
    cand.updated_at = cand.claimed_at;
    cand.last_error = null;
    return { item: { ...cand }, claimToken, code: reclaim ? 'reclaimed' : 'claimed' };
  }

  // Valida posse antes de qualquer transição terminal.
  function verificarClaim(it, claimToken) {
    if (it.status !== OUTBOX_STATUS.PROCESSING) return { ok: false, code: 'invalid_transition', from: it.status };
    if (!claimToken || it.claim_id !== claimToken) return { ok: false, code: 'stale_claim' };
    return { ok: true };
  }

  async function markProcessed(id, claimToken, { now = new Date() } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const posse = verificarClaim(it, claimToken);
    if (!posse.ok) return posse.code === 'stale_claim' ? { code: 'stale_claim' } : posse;
    if (!canTransition(it.status, OUTBOX_STATUS.PROCESSED)) return { code: 'invalid_transition', from: it.status };
    it.status = OUTBOX_STATUS.PROCESSED;
    it.processed_at = now.toISOString();
    it.updated_at = it.processed_at;
    it.last_error = null;
    it.claim_id = null;
    it.lease_expires_at = null;
    return { code: 'processed', item: { ...it } };
  }

  async function markFailed(id, claimToken, razao, { now = new Date() } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const posse = verificarClaim(it, claimToken);
    if (!posse.ok) return posse.code === 'stale_claim' ? { code: 'stale_claim' } : posse;
    const excedeu = it.attempts >= it.max_attempts;
    const alvo = excedeu ? OUTBOX_STATUS.DEAD : OUTBOX_STATUS.FAILED;
    if (!canTransition(it.status, alvo)) return { code: 'invalid_transition', from: it.status };
    it.status = alvo;
    it.next_retry_at = excedeu ? null : new Date(now.getTime() + backoffMs(it.attempts)).toISOString();
    it.updated_at = now.toISOString();
    it.last_error = sanitizeError(razao);
    it.claim_id = null;
    it.lease_expires_at = null;
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
  DEFAULT_LEASE_MS,
  canTransition,
  sanitizeError,
  backoffMs,
  createInMemoryOutbox,
};

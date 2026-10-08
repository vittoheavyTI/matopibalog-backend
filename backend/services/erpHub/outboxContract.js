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
// provado aqui é a SEMÂNTICA que torna a versão persistida recuperável.
//
// AUTORIDADES CONGELADAS NESTA CAMADA
//   OUTBOX_PROVIDER_AUTHORITY       = EXPLICIT
//   OUTBOX_DEDUPE_AUTHORITY         = (empresa_id, provider, event_id)
//   OUTBOX_INTENT_GUARD             = intent_fingerprint
//   ERP_OUTBOX_AMBIGUOUS_RECOVERY   = RECONCILE_BEFORE_RESEND
//   ERP_RETRY_POLICY                = aplicada PELA MÁQUINA, não só por helper
//
// Invariantes:
//   - o outbox DERIVA identidade/dedupe/fingerprint; não aceita chave arbitrária
//     do caller como autoridade (R3-HIGH-02).
//   - dedupe é por (empresa_id, provider, event_id): tenants e providers nunca
//     colidem, mesmo com o mesmo event_id.
//   - mesmo event_id com intenção DIFERENTE → idempotency_conflict, nunca duplicate.
//   - o envelope enfileirado é SNAPSHOT PROFUNDO IMUTÁVEL: mutar a referência do
//     caller, o item devolvido ou o read model não altera a fila (R3-HIGH-03).
//   - só aceita ENVELOPE CANÔNICO válido — nada de payload arbitrário.
//   - máquina de estados explícita: pending → processing → processed | failed → dead.
//   - lease de processamento com expiração + reclaim; claim obsoleto não finaliza
//     trabalho de outro worker.
//   - trabalho é TIPADO: CLAIM_FOR_SEND vs CLAIM_FOR_RECONCILE. Um item cujo lease
//     de SEND expirou só libera RECONCILE (R3-HIGH-05).
//   - FAILED sem evidência NÃO volta para SEND automaticamente (R3-HIGH-04).
//   - max_attempts excedido → dead (nunca loop infinito), inclusive no reconcile.
//   - last_error SEMPRE sanitizado (sem segredo/PII).

const crypto = require('node:crypto');
const { LIMITS } = require('./config');
const { validateEnvelope } = require('./canonicalEnvelope');
const { deriveIdempotencyKey, intentFingerprintForEnvelope } = require('./idempotency');
const { RECONCILE_STATUS, normalizeReconcile, safeToRetry } = require('./reconcile');

const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  DEAD: 'dead',
});

// R3-HIGH-05 — o trabalho seguinte de um item é TIPADO. Sem isto, "voltar para a
// fila" significava sempre "reenviar", e um crash depois de o ERP ter aplicado o
// efeito produzia um segundo envio. `next_action = null` é o estado bloqueado:
// nenhum trabalho automático é permitido, o item aguarda revisão.
const CLAIM_ACTION = Object.freeze({
  SEND: 'SEND',
  RECONCILE: 'RECONCILE',
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

// R3-HIGH-03 — o snapshot do evento não pode mudar de conteúdo depois de aceito.
// `{ ...item }` era shallow: `item.envelope` continuava sendo a MESMA referência
// que o caller ainda segurava, então `original.payload.valor = outro` (ou uma
// escrita no item devolvido) reescrevia a fila DEPOIS da validação — o que foi
// validado deixava de ser o que seria enviado. Clone profundo na entrada, freeze
// profundo no interno, clone profundo na saída.
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
  return out;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const k of Object.keys(value)) deepFreeze(value[k]);
  return value;
}

// Implementação em MEMÓRIA do contrato do outbox. Injetável em testes/worker.
// A assinatura dos métodos é intencionalmente compatível com um repositório
// persistente futuro (async), para que trocar in-memory → SQL não mude o worker.
function createInMemoryOutbox({
  maxAttempts = LIMITS.MAX_ATTEMPTS_DEFAULT,
  maxReconcileAttempts = LIMITS.MAX_RECONCILE_ATTEMPTS_DEFAULT,
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  const items = new Map();        // id → item (envelope congelado)
  const byDedupe = new Map();     // `${empresa_id}|${provider}|${event_id}` → id
  let seq = 0;

  function novoId() { seq += 1; return `erpobx_${seq}`; }

  // R3-HIGH-02 — a identidade de dedupe é do OUTBOX, não do caller. Antes o
  // provider entrava só por convenção (embutido, ou não, numa `dedupeKey` que o
  // caller inventava) e o índice era `empresa_id + dedupe_key`. Bastava um caller
  // usar uma chave "natural" para dois providers colidirem, ou para um duplicate
  // devolver o item errado. Agora a camada deriva tudo do par (provider, envelope).
  function dedupeIndex(empresaId, provider, eventId) {
    return `${empresaId}|${provider}|${eventId}`;
  }

  // Cópia de leitura: nunca devolve referência ao estado interno.
  function readItem(it) {
    return deepClone(it);
  }

  // O outbox é um elo da cadeia
  //   DOMÍNIO → ENVELOPE CANÔNICO → OUTBOX → PROVIDER ADAPTER → ERP
  // então ele só aceita o envelope canônico. `empresa_id`, `event_id` e
  // `event_type` são LIDOS do envelope, nunca recebidos em paralelo: duas
  // autoridades para o mesmo dado divergiriam em silêncio.
  async function enqueue({ provider, envelope }) {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('outbox.enqueue: provider obrigatorio');
    }
    const v = validateEnvelope(envelope);
    if (!v.ok) {
      return { enfileirado: false, code: 'invalid_envelope', motivo: v.motivo, chaveSensivel: v.chaveSensivel || null };
    }

    const empresaId = envelope.empresa_id;   // autoridade única
    const eventId = envelope.event_id;       // identidade da ocorrência lógica
    const eventType = envelope.event_type;

    const dedupeKey = deriveIdempotencyKey({
      provider, empresaId, eventId, schemaVersion: envelope.schema_version,
    });
    const fingerprint = intentFingerprintForEnvelope(envelope);
    const idx = dedupeIndex(empresaId, provider, eventId);

    if (byDedupe.has(idx)) {
      const existente = items.get(byDedupe.get(idx));
      // Mesma ocorrência, mesma intenção → replay idempotente.
      if (existente.intent_fingerprint === fingerprint) {
        return { enfileirado: false, code: 'duplicate', dedupeKey, intentFingerprint: fingerprint, item: readItem(existente) };
      }
      // Mesma ocorrência, intenção DIFERENTE → conflito. Nunca duplicate benigno:
      // alguém reusou a identidade de um evento para dizer outra coisa, e engolir
      // isso descartaria uma das duas intenções sem ninguém saber.
      return {
        enfileirado: false,
        code: 'idempotency_conflict',
        dedupeKey,
        intentFingerprint: fingerprint,
        intentFingerprintExistente: existente.intent_fingerprint,
        item: readItem(existente),
      };
    }

    const id = novoId();
    const now = new Date().toISOString();
    const item = {
      id,
      empresa_id: empresaId,
      provider,
      event_id: eventId,
      event_type: eventType,
      dedupe_key: dedupeKey,
      intent_fingerprint: fingerprint,
      // Snapshot profundo e CONGELADO — desligado da referência do caller.
      envelope: deepFreeze(deepClone(envelope)),
      status: OUTBOX_STATUS.PENDING,
      next_action: CLAIM_ACTION.SEND,
      claim_action: null,
      retry_authorized: false,
      retry_reason: null,
      blocked_reason: null,
      last_reconcile_status: null,
      send_attempts: 0,
      reconcile_attempts: 0,
      max_attempts: maxAttempts,
      max_reconcile_attempts: maxReconcileAttempts,
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
    return { enfileirado: true, code: 'inserted', dedupeKey, intentFingerprint: fingerprint, item: readItem(item) };
  }

  // Qual trabalho — se algum — está autorizado AGORA para este item.
  // Devolve CLAIM_ACTION.SEND, CLAIM_ACTION.RECONCILE ou null.
  function acaoPermitida(it, nowMs) {
    if (it.status === OUTBOX_STATUS.PROCESSED || it.status === OUTBOX_STATUS.DEAD) return null;

    if (it.status === OUTBOX_STATUS.PROCESSING) {
      const vencido = Boolean(it.lease_expires_at) && new Date(it.lease_expires_at).getTime() <= nowMs;
      if (!vencido) return null; // outro worker tem posse válida
      // R3-HIGH-05 — lease vencido é AMBIGUIDADE, não permissão de reenvio. O
      // worker anterior pode ter morrido DEPOIS de o ERP aplicar o efeito e antes
      // de confirmar. O único trabalho seguro é RECONCILE, qualquer que fosse a
      // ação anterior.
      return CLAIM_ACTION.RECONCILE;
    }

    if (it.status === OUTBOX_STATUS.PENDING) return it.next_action;

    if (it.status === OUTBOX_STATUS.FAILED) {
      if (!it.next_action) return null; // bloqueado: exige revisão humana
      const pronto = !it.next_retry_at || new Date(it.next_retry_at).getTime() <= nowMs;
      return pronto ? it.next_action : null;
    }
    return null;
  }

  // Reivindica um item elegível PARA UMA AÇÃO ESPECÍFICA e devolve um claimToken.
  // O token é a prova de posse: markProcessed/markFailed/recordReconcile exigem o
  // token VIGENTE, então um worker que voltou do limbo depois do reclaim não
  // consegue finalizar o trabalho de quem o substituiu.
  async function claimNext({ action = CLAIM_ACTION.SEND, now = new Date(), leaseMs: leaseOverride } = {}) {
    if (action !== CLAIM_ACTION.SEND && action !== CLAIM_ACTION.RECONCILE) {
      throw new Error(`outbox.claimNext: acao invalida: ${action}`);
    }
    const nowMs = now.getTime();
    const janela = leaseOverride || leaseMs;
    const cand = [...items.values()]
      .filter((it) => acaoPermitida(it, nowMs) === action)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!cand) return { item: null, claimToken: null, action, code: 'empty' };
    if (!canTransition(cand.status, OUTBOX_STATUS.PROCESSING)) {
      return { item: null, claimToken: null, action, code: 'blocked' };
    }

    const reclaim = cand.status === OUTBOX_STATUS.PROCESSING;
    const claimToken = crypto.randomUUID();
    cand.status = OUTBOX_STATUS.PROCESSING;
    // §20 — contadores separados: um recovery/reconcile NÃO consome tentativa de
    // envio. Misturá-los faria um item morrer por "excesso de envios" que nunca
    // aconteceram.
    if (action === CLAIM_ACTION.SEND) cand.send_attempts += 1;
    else cand.reconcile_attempts += 1;
    cand.claim_action = action;
    cand.claim_id = claimToken;              // invalida qualquer claim anterior
    cand.claimed_at = now.toISOString();
    cand.lease_expires_at = new Date(nowMs + janela).toISOString();
    cand.updated_at = cand.claimed_at;
    cand.last_error = null;
    return { item: readItem(cand), claimToken, action, code: reclaim ? 'reclaimed' : 'claimed' };
  }

  // Valida posse antes de qualquer transição terminal.
  function verificarClaim(it, claimToken) {
    if (it.status !== OUTBOX_STATUS.PROCESSING) return { ok: false, code: 'invalid_transition', from: it.status };
    if (!claimToken || it.claim_id !== claimToken) return { ok: false, code: 'stale_claim' };
    return { ok: true };
  }

  function soltarLease(it) {
    it.claim_id = null;
    it.claim_action = null;
    it.lease_expires_at = null;
  }

  async function markProcessed(id, claimToken, { now = new Date() } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const posse = verificarClaim(it, claimToken);
    if (!posse.ok) return posse.code === 'stale_claim' ? { code: 'stale_claim' } : posse;
    // Sucesso direto só existe para quem executou o ENVIO. Um claim de reconcile
    // conclui por `recordReconcile`, onde o status do ERP é a autoridade.
    if (it.claim_action !== CLAIM_ACTION.SEND) return { code: 'invalid_claim_action', claimAction: it.claim_action };
    if (!canTransition(it.status, OUTBOX_STATUS.PROCESSED)) return { code: 'invalid_transition', from: it.status };
    it.status = OUTBOX_STATUS.PROCESSED;
    it.next_action = null;
    it.retry_authorized = false;
    it.processed_at = now.toISOString();
    it.updated_at = it.processed_at;
    it.last_error = null;
    it.next_retry_at = null;
    soltarLease(it);
    return { code: 'processed', item: readItem(it) };
  }

  // Encerra o claim atual sem sucesso.
  //
  // R3-HIGH-04 — a política conservadora vive AQUI, na máquina, e não só num
  // helper que o outbox podia não consultar. Antes, `markFailed` agendava um
  // `next_retry_at` e o item voltava elegível para envio quando o backoff vencia:
  // o outbox autorizava, sozinho, exatamente o reenvio que D-083 proíbe. Agora,
  // falha de SEND sem evidência de segurança NÃO reabre SEND — reabre RECONCILE.
  //
  // `retrySafe:true` é a evidência explícita do provider/adapter de que o efeito
  // comprovadamente não foi aplicado; é a ÚNICA porta para reenvio direto.
  async function markFailed(id, claimToken, razao, { now = new Date(), retrySafe = false, retryReason = null } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const posse = verificarClaim(it, claimToken);
    if (!posse.ok) return posse.code === 'stale_claim' ? { code: 'stale_claim' } : posse;

    const eraSend = it.claim_action === CLAIM_ACTION.SEND;
    const excedeu = eraSend
      ? it.send_attempts >= it.max_attempts
      : it.reconcile_attempts >= it.max_reconcile_attempts;
    const alvo = excedeu ? OUTBOX_STATUS.DEAD : OUTBOX_STATUS.FAILED;
    if (!canTransition(it.status, alvo)) return { code: 'invalid_transition', from: it.status };

    it.status = alvo;
    it.last_error = sanitizeError(razao);
    it.updated_at = now.toISOString();

    if (excedeu) {
      it.next_action = null;
      it.retry_authorized = false;
      it.next_retry_at = null;
      it.blocked_reason = eraSend ? 'max_send_attempts' : 'max_reconcile_attempts';
    } else if (eraSend && retrySafe === true) {
      it.next_action = CLAIM_ACTION.SEND;
      it.retry_authorized = true;
      it.retry_reason = retryReason || 'provider_retry_safe';
      it.blocked_reason = null;
      it.next_retry_at = new Date(now.getTime() + backoffMs(it.send_attempts)).toISOString();
    } else if (eraSend) {
      // Falha de envio sem prova: o efeito externo é AMBÍGUO. Reconciliar primeiro.
      it.next_action = CLAIM_ACTION.RECONCILE;
      it.retry_authorized = false;
      it.retry_reason = null;
      it.blocked_reason = 'send_failed_sem_evidencia';
      it.next_retry_at = new Date(now.getTime() + backoffMs(it.send_attempts)).toISOString();
    } else {
      // A própria tentativa de reconcile falhou (rede, timeout): reconciliar de novo.
      it.next_action = CLAIM_ACTION.RECONCILE;
      it.retry_authorized = false;
      it.blocked_reason = 'reconcile_falhou';
      it.next_retry_at = new Date(now.getTime() + backoffMs(it.reconcile_attempts)).toISOString();
    }

    soltarLease(it);
    return { code: excedeu ? 'dead' : 'failed', item: readItem(it) };
  }

  // R3-HIGH-05 — resultado de um CLAIM_FOR_RECONCILE. Está no CONTRATO da máquina,
  // não em comentário: é a máquina que decide se um novo SEND fica autorizado.
  //
  //   SUCCEEDED → PROCESSED (o efeito existe; zero reenvio)
  //   NOT_FOUND → o ERP comprovadamente não conhece o envio → SEND liberado
  //   PENDING   → aguardar e reconciliar de novo
  //   UNKNOWN   → aguardar e reconciliar de novo; NUNCA send
  //   FAILED    → SEND só com evidence.retry_safe === true; senão fica bloqueado
  async function recordReconcile(id, claimToken, statusBruto, { now = new Date(), evidence = null } = {}) {
    const it = items.get(id);
    if (!it) return { code: 'not_found' };
    const posse = verificarClaim(it, claimToken);
    if (!posse.ok) return posse.code === 'stale_claim' ? { code: 'stale_claim' } : posse;
    if (it.claim_action !== CLAIM_ACTION.RECONCILE) {
      return { code: 'invalid_claim_action', claimAction: it.claim_action };
    }

    const status = normalizeReconcile(statusBruto);
    it.last_reconcile_status = status;
    it.updated_at = now.toISOString();

    if (status === RECONCILE_STATUS.SUCCEEDED) {
      it.status = OUTBOX_STATUS.PROCESSED;
      it.next_action = null;
      it.retry_authorized = false;
      it.blocked_reason = null;
      it.next_retry_at = null;
      it.last_error = null;
      it.processed_at = now.toISOString();
      soltarLease(it);
      return { code: 'processed', reconcileStatus: status, item: readItem(it) };
    }

    // A autoridade de reenvio continua sendo a mesma do reconcile — e agora a
    // máquina a CONSULTA, em vez de reimplementar um critério paralelo.
    const podeReenviar = safeToRetry(status, evidence);
    const excedeuReconcile = it.reconcile_attempts >= it.max_reconcile_attempts;

    if (podeReenviar) {
      it.status = OUTBOX_STATUS.FAILED;
      it.next_action = CLAIM_ACTION.SEND;
      it.retry_authorized = true;
      it.retry_reason = status === RECONCILE_STATUS.NOT_FOUND ? 'reconcile_not_found' : 'provider_retry_safe';
      it.blocked_reason = null;
      it.next_retry_at = new Date(now.getTime() + backoffMs(it.send_attempts)).toISOString();
      soltarLease(it);
      return { code: 'resend_authorized', reconcileStatus: status, item: readItem(it) };
    }

    if (status === RECONCILE_STATUS.FAILED) {
      // Sem prova de que nada foi aplicado, reenviar duplicaria efeito de negócio.
      // O item para aqui e espera decisão humana — não volta sozinho para SEND.
      it.status = OUTBOX_STATUS.FAILED;
      it.next_action = null;
      it.retry_authorized = false;
      it.blocked_reason = 'reconcile_failed_sem_evidencia';
      it.next_retry_at = null;
      soltarLease(it);
      return { code: 'blocked', reconcileStatus: status, item: readItem(it) };
    }

    // PENDING / UNKNOWN → reconciliar de novo, com teto para não girar para sempre.
    if (excedeuReconcile) {
      it.status = OUTBOX_STATUS.DEAD;
      it.next_action = null;
      it.retry_authorized = false;
      it.blocked_reason = 'max_reconcile_attempts';
      it.next_retry_at = null;
      soltarLease(it);
      return { code: 'dead', reconcileStatus: status, item: readItem(it) };
    }
    it.status = OUTBOX_STATUS.FAILED;
    it.next_action = CLAIM_ACTION.RECONCILE;
    it.retry_authorized = false;
    it.blocked_reason = `reconcile_${status.toLowerCase()}`;
    it.next_retry_at = new Date(now.getTime() + backoffMs(it.reconcile_attempts)).toISOString();
    soltarLease(it);
    return { code: 'reconcile_again', reconcileStatus: status, item: readItem(it) };
  }

  async function countByStatus(empresaId = null) {
    const contagem = { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 };
    for (const it of items.values()) {
      if (empresaId && it.empresa_id !== empresaId) continue;
      if (contagem[it.status] != null) contagem[it.status] += 1;
    }
    return contagem;
  }

  // Só para inspeção em testes; um repositório real não exporia isto. Devolve
  // CÓPIAS PROFUNDAS: mutar o read model não pode alcançar a fila (R3-HIGH-03).
  function _all(empresaId = null) {
    return [...items.values()].filter((it) => !empresaId || it.empresa_id === empresaId).map(readItem);
  }

  return { enqueue, claimNext, markProcessed, markFailed, recordReconcile, countByStatus, _all };
}

module.exports = {
  OUTBOX_STATUS,
  CLAIM_ACTION,
  VALID_TRANSITIONS,
  DEFAULT_LEASE_MS,
  OUTBOX_PROVIDER_AUTHORITY: 'EXPLICIT',
  OUTBOX_DEDUPE_AUTHORITY: 'EMPRESA_ID+PROVIDER+EVENT_ID',
  ERP_OUTBOX_AMBIGUOUS_RECOVERY: 'RECONCILE_BEFORE_RESEND',
  canTransition,
  sanitizeError,
  backoffMs,
  deepClone,
  createInMemoryOutbox,
};

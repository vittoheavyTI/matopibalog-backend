'use strict';

// Idempotência / proveniência (§9) — R3-HIGH-01.
//
//   ERP_EVENT_IDENTITY      = LOGICAL_EVENT_ID
//   ERP_INTENT_FINGERPRINT  = CONFLICT_GUARD
//
// DUAS obrigações, UMA autoridade cada — e elas não são a mesma coisa:
//
//   (a) IDENTIDADE da ocorrência: `event_id`. Estável entre retries do MESMO
//       evento lógico, distinta entre ocorrências distintas.
//   (b) GUARDA de conflito: o fingerprint canônico da INTENÇÃO. Não identifica
//       nada; só responde "este `event_id` está sendo reapresentado com o mesmo
//       conteúdo de antes?".
//
// POR QUE A AUTORIDADE ANTERIOR ESTAVA ERRADA. A versão R2 usava o fingerprint do
// intent COMO identidade (`CANONICAL_INTENT_FINGERPRINT`). Isso resolvia o colapso
// de revisões consecutivas, mas quebrava no caso A→B→A:
//
//   E1: entidade X, status=A
//   E2: entidade X, status=B
//   E3: entidade X, status=A     ← ocorrência LEGÍTIMA e nova
//
// E1 e E3 têm payload idêntico, logo fingerprint idêntico. Com dedupe permanente,
// E3 seria descartado como replay de E1 e o ERP ficaria parado em B — um estado
// de negócio errado, em silêncio. Conteúdo repetido não é evento repetido.
//
// A CHAVE, portanto, deriva de:  provider | empresa_id | event_id | schema_version
// e NUNCA do payload. Ela responde só "é a mesma ocorrência?".
//
// O fingerprint continua existindo, com papel estritamente diferente:
//   mesmo event_id + mesmo fingerprint      → replay idempotente (duplicate benigno)
//   mesmo event_id + fingerprint DIFERENTE  → IDEMPOTENCY_CONFLICT
// O segundo caso nunca é tratado como duplicata benigna: alguém reusou a
// identidade de uma ocorrência para dizer outra coisa, e engolir isso perderia
// uma das duas intenções.
//
// COMPÕEM A INTENÇÃO: schema_version, entity_type, entity_id, event_type, source,
// payload. NÃO compõem: request_id, correlation_id, occurred_at (transporte /
// tentativa) e metadata (diagnóstico, não intenção).
//
// SCHEMA_VERSION entra na CHAVE deliberadamente: um bump muda a FORMA do que é
// enviado ao provider, então a ocorrência é reemitida em vez de deduplicar contra
// a versão antiga. Decisão explícita, coberta por teste.

const crypto = require('node:crypto');
const { canonicalizeJsonSafe } = require('./canonicalEnvelope');

// Canonicalização determinística e JSON-safe — a MESMA usada pelo builder e pelo
// validator. Estourar profundidade ou conteúdo não-JSON lança em vez de truncar,
// para que dois payloads diferentes jamais produzam o mesmo fingerprint (R3-MEDIUM-02).
function canonicalJson(value) {
  return JSON.stringify(canonicalizeJsonSafe(value === undefined ? {} : value));
}

// Fingerprint determinístico da INTENÇÃO (guarda de conflito, não identidade).
function intentFingerprint({
  schemaVersion = null, entityType, entityId, eventType, source, payload = {},
} = {}) {
  const intent = {
    schema_version: schemaVersion == null ? null : schemaVersion,
    entity_type: entityType == null ? null : String(entityType),
    entity_id: entityId == null ? null : String(entityId),
    event_type: eventType == null ? null : String(eventType),
    source: source == null ? null : String(source),
    payload: payload === undefined ? {} : payload,
  };
  return crypto.createHash('sha256').update(canonicalJson(intent)).digest('hex');
}

function intentFingerprintForEnvelope(env) {
  return intentFingerprint({
    schemaVersion: env.schema_version,
    entityType: env.entity_type,
    entityId: env.entity_id,
    eventType: env.event_type,
    source: env.source,
    payload: env.payload,
  });
}

// Chave de idempotência: identidade da OCORRÊNCIA LÓGICA. Não depende do payload.
function deriveIdempotencyKey({ provider, empresaId, eventId, schemaVersion }) {
  for (const [nome, v] of Object.entries({ provider, empresaId, eventId })) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`deriveIdempotencyKey: campo obrigatorio ausente: ${nome}`);
    }
  }
  const canonical = [
    String(provider),
    String(empresaId),
    String(eventId),
    String(schemaVersion == null ? '' : schemaVersion),
  ].join('|');
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  // Prefixo legível ajuda diagnóstico sem revelar nada sensível.
  return `erp:${provider}:${hash}`;
}

// Deriva a chave direto de um envelope canônico + provider.
function idempotencyKeyForEnvelope(provider, env) {
  return deriveIdempotencyKey({
    provider,
    empresaId: env.empresa_id,
    eventId: env.event_id,
    schemaVersion: env.schema_version,
  });
}

module.exports = {
  ERP_EVENT_IDENTITY: 'LOGICAL_EVENT_ID',
  ERP_INTENT_FINGERPRINT: 'CONFLICT_GUARD',
  EVENT_ID_CREATED_ONCE_PER_LOGICAL_EVENT: true,
  canonicalJson,
  intentFingerprint,
  intentFingerprintForEnvelope,
  deriveIdempotencyKey,
  idempotencyKeyForEnvelope,
};

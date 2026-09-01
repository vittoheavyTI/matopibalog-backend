'use strict';

// Idempotência / proveniência (§9) — HIGH-01.
//
// ERP_IDEMPOTENCY_EVENT_AUTHORITY = CANONICAL_INTENT_FINGERPRINT
//
// A chave precisa satisfazer DUAS obrigações ao mesmo tempo:
//   (a) ESTÁVEL entre retries do MESMO evento lógico — senão cada retry vira um
//       envio novo e o efeito externo duplica;
//   (b) DIFERENTE entre eventos legítimos distintos da MESMA entidade — senão
//       "frete X updated (revisão A)" e "frete X updated (revisão B)" colapsam e a
//       segunda revisão é silenciosamente descartada.
//
// A versão anterior falhava em (b): a chave era só a IDENTIDADE DA ENTIDADE
// (provider|empresa|entity_type|entity_id|event_type|schema_version), então toda
// atualização subsequente da mesma entidade produzia a mesma chave.
//
// AUTORIDADE ESCOLHIDA (uma só, deliberadamente): o **intent canônico** — isto é,
// a identidade da entidade MAIS o fingerprint determinístico do `payload`, que é o
// conteúdo imutável do que se quer comunicar.
//
// Por que não o id lógico upstream (`request_id`): ele é NULLABLE no envelope. Uma
// autoridade que às vezes não existe obrigaria a um fallback, e o fallback seria
// uma SEGUNDA autoridade divergente — exatamente o que o contrato proíbe. O payload
// canônico, ao contrário, está sempre presente.
//
// EXCLUÍDOS da chave, de propósito (são da TENTATIVA/transporte, não do evento):
//   event_id      — gerado por chamada; incluí-lo faria todo retry parecer novo
//   request_id    — identificador de transporte, opcional
//   correlation_id— rastro de observabilidade
//   occurred_at   — timestamp; incluí-lo quebraria (a)
//   metadata      — diagnóstico, não intent
//
// SCHEMA_VERSION: entra na chave deliberadamente. Um bump de `schema_version` muda
// a FORMA do que é enviado ao provider, então o evento é reemitido em vez de
// deduplicar contra a versão antiga. É uma decisão explícita, coberta por teste.

const crypto = require('node:crypto');

// Canonicaliza recursivamente para que a ORDEM das chaves não afete o fingerprint:
// { a:1, b:2 } e { b:2, a:1 } são o MESMO intent e precisam dar o mesmo hash.
function canonicalize(value, depth = 0) {
  if (depth > 12) return null; // corta estruturas patológicas
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, depth + 1)); // ordem do array É significativa
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k], depth + 1);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value === undefined ? {} : value));
}

// Fingerprint determinístico do intent (payload canônico).
function intentFingerprint(payload) {
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function deriveIdempotencyKey({
  provider, empresaId, entityType, entityId, eventType, schemaVersion, payload = {},
}) {
  for (const [nome, v] of Object.entries({ provider, empresaId, entityType, entityId, eventType })) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`deriveIdempotencyKey: campo obrigatorio ausente: ${nome}`);
    }
  }
  const canonical = [
    String(provider),
    String(empresaId),
    String(entityType),
    String(entityId),
    String(eventType),
    String(schemaVersion == null ? '' : schemaVersion),
    intentFingerprint(payload), // ← o que distingue revisões legítimas
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
    entityType: env.entity_type,
    entityId: env.entity_id,
    eventType: env.event_type,
    schemaVersion: env.schema_version,
    payload: env.payload,
  });
}

module.exports = {
  IDEMPOTENCY_EVENT_AUTHORITY: 'CANONICAL_INTENT_FINGERPRINT',
  canonicalJson,
  intentFingerprint,
  deriveIdempotencyKey,
  idempotencyKeyForEnvelope,
};

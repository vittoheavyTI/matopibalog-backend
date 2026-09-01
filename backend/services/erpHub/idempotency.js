'use strict';

// Idempotência / proveniência (§9). Deriva uma chave ESTÁVEL a partir da
// identidade lógica do evento — o mesmo evento lógico produz sempre a mesma
// chave, então enfileirar/enviar N vezes nunca duplica o efeito externo.
//
// A chave NÃO inclui event_id (aleatório por chamada) nem timestamps: ela é a
// IDENTIDADE do que está sendo comunicado, não da tentativa.

const crypto = require('node:crypto');

// provider + empresa + entity_type + entity_id + event_type + schema_version.
// Tenant-safe por construção: dois tenants nunca colidem (empresa_id entra na chave).
function deriveIdempotencyKey({
  provider, empresaId, entityType, entityId, eventType, schemaVersion,
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
  });
}

module.exports = { deriveIdempotencyKey, idempotencyKeyForEnvelope };

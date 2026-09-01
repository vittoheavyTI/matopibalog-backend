'use strict';

// Modelo canônico mínimo do ERP Integration Hub (§6/§7). PURO (sem I/O).
//
// Princípio D-023: o domínio Matopiba NUNCA se acopla ao schema/API de um
// fornecedor. Tudo que sai do domínio vira um ENVELOPE canônico, versionado,
// provider-agnostic. O adapter do fornecedor traduz depois — nunca o domínio.
//
// ESCOPO DE ENTIDADES (ERP_CANONICAL_ENTITY_SCOPE_DECISION_NEEDED): esta fatia
// NÃO inventa uma lista fixa de entidades de negócio. entity_type é um rótulo
// livre validado por forma (não por enum), e o primeiro conjunto canônico real
// (ex.: parceiro, frete, documento fiscal) é decisão da próxima fatia. A
// arquitetura-base não depende dessa decisão.

const { LIMITS } = require('./config');
const { ErpProviderError, ERP_PROVIDER_ERROR } = require('./errors');

// Versão do contrato do envelope. Bump quando a FORMA mudar de modo incompatível.
const SCHEMA_VERSION = 1;

// Chaves NUNCA transportadas no payload/metadata (§7). Comparação case-insensitive
// e por conteúdo (substring) para pegar variações (authorization, refresh_token…).
const FORBIDDEN_KEY_FRAGMENTS = Object.freeze([
  'authorization', 'auth_token', 'jwt', 'bearer', 'senha', 'password', 'passwd',
  'secret', 'apikey', 'api_key', 'token', 'cookie', 'refresh', 'credential',
  'credencial', 'private_key', 'client_secret', 'set-cookie',
]);

function isForbiddenKey(key) {
  const k = String(key).toLowerCase();
  return FORBIDDEN_KEY_FRAGMENTS.some((frag) => k.includes(frag));
}

// Remove recursivamente qualquer chave sensível de um objeto/array. Retorna uma
// CÓPIA sanitizada; nunca muta a entrada. Profundidade limitada por sanidade.
function sanitizeObject(value, depth = 0) {
  if (depth > 8) return null; // corta estruturas patológicas
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeObject(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isForbiddenKey(k)) continue; // dropa segredo silenciosamente
      out[k] = sanitizeObject(v, depth + 1);
    }
    return out;
  }
  return value; // primitivos passam
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function uuidLike() {
  // event_id/request_id determinístico-agnóstico: usa crypto quando disponível.
  const crypto = require('node:crypto');
  return crypto.randomUUID();
}

// Constrói um envelope canônico sanitizado e validado. `now` injetável para testes.
// Campos:
//   schema_version, event_id, request_id, correlation_id, empresa_id,
//   entity_type, entity_id, event_type, occurred_at, source, payload, metadata
function buildEnvelope(input = {}, { now = new Date(), eventId = null } = {}) {
  const {
    empresaId, entityType, entityId, eventType,
    source = 'matopiba', correlationId = null, requestId = null,
    payload = {}, metadata = {},
  } = input;

  if (!isNonEmptyString(empresaId)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'empresa_id obrigatorio');
  }
  if (!isNonEmptyString(entityType) || entityType.length > LIMITS.MAX_ENTITY_TYPE) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'entity_type invalido');
  }
  if (!isNonEmptyString(entityId) || entityId.length > LIMITS.MAX_ENTITY_ID) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'entity_id invalido');
  }
  if (!isNonEmptyString(eventType) || eventType.length > LIMITS.MAX_EVENT_TYPE) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'event_type invalido');
  }
  if (!isNonEmptyString(source) || source.length > LIMITS.MAX_SOURCE) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'source invalido');
  }
  if (correlationId != null && (typeof correlationId !== 'string' || correlationId.length > LIMITS.MAX_CORRELATION_ID)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'correlation_id invalido');
  }

  const safePayload = sanitizeObject(payload) || {};
  const safeMetadata = sanitizeObject(metadata) || {};

  if (safeMetadata && Object.keys(safeMetadata).length > LIMITS.MAX_METADATA_KEYS) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'metadata excede limite de chaves');
  }

  const envelope = {
    schema_version: SCHEMA_VERSION,
    event_id: eventId || uuidLike(),
    request_id: isNonEmptyString(requestId) ? requestId : null,
    correlation_id: isNonEmptyString(correlationId) ? correlationId : null,
    empresa_id: empresaId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    occurred_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    source,
    payload: safePayload,
    metadata: safeMetadata,
  };

  // Teto de sanidade do tamanho serializado.
  const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (bytes > LIMITS.MAX_PAYLOAD_BYTES) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'envelope excede o teto de tamanho');
  }
  return envelope;
}

// Valida a FORMA de um envelope já pronto (ex.: recebido inbound). Não muta.
// Retorna { ok, motivo }. NÃO valida entity_type contra enum (escopo diferido).
function validateEnvelope(env) {
  if (!env || typeof env !== 'object') return { ok: false, motivo: 'nao_e_objeto' };
  if (env.schema_version !== SCHEMA_VERSION) return { ok: false, motivo: 'schema_version_incompativel' };
  for (const campo of ['event_id', 'empresa_id', 'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source']) {
    if (!isNonEmptyString(env[campo])) return { ok: false, motivo: `campo_obrigatorio_ausente:${campo}` };
  }
  if (env.payload == null || typeof env.payload !== 'object') return { ok: false, motivo: 'payload_invalido' };
  // Defesa em profundidade: nenhum segredo pode ter sobrevivido.
  const flat = JSON.stringify(env);
  return { ok: true, motivo: null, contemChaveSensivel: /("(?:[^"]*)(?:secret|password|token|senha|authorization)[^"]*")\s*:/i.test(flat) };
}

module.exports = {
  SCHEMA_VERSION,
  FORBIDDEN_KEY_FRAGMENTS,
  isForbiddenKey,
  sanitizeObject,
  buildEnvelope,
  validateEnvelope,
};

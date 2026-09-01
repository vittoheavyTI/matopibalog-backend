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
//
// R3-MEDIUM-01 — BUILD_AND_VALIDATE_CONSTRAINTS=SYMMETRIC. Antes existiam DUAS
// definições de "envelope válido": `buildEnvelope` aplicava bounds (tamanhos,
// teto serializado, limite de chaves de metadata) que `validateEnvelope` não
// conferia. Um envelope construído por outro processo — ou montado à mão e
// entregue inbound — passava por uma porta que a outra recusaria. A correção não
// é duplicar as regras: `buildEnvelope` NORMALIZA e depois submete o resultado ao
// MESMO `validateEnvelope`, que passa a ser a autoridade única da forma.
//
// R3-MEDIUM-01 (forma fechada) — o schema v1 aceita EXATAMENTE os campos
// canônicos. Campo top-level inesperado invalida. Isso fecha, entre outras
// coisas, `{ ...envelope, authorization: 'Bearer ...' }`, que antes escapava
// porque a varredura de segredo só olhava `payload`/`metadata`. Campo novo no
// futuro exige bump deliberado de `schema_version`, nunca extensão silenciosa.

const { LIMITS } = require('./config');
const { ErpProviderError, ERP_PROVIDER_ERROR } = require('./errors');

// Versão do contrato do envelope. Bump quando a FORMA mudar de modo incompatível.
const SCHEMA_VERSION = 1;

// Forma FECHADA do schema v1. Nada além disto no topo do envelope.
const CANONICAL_TOP_LEVEL_FIELDS = Object.freeze([
  'schema_version', 'event_id', 'request_id', 'correlation_id', 'empresa_id',
  'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source',
  'payload', 'metadata',
]);

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

// Motivos canônicos de recusa de conteúdo (usados por build, validate e fingerprint).
const CANONICAL_JSON_ERROR = Object.freeze({
  DEPTH_EXCEEDED: 'profundidade_excedida',
  NOT_JSON_SAFE: 'valor_nao_json_safe',
});

class CanonicalJsonError extends Error {
  constructor(motivo, caminho) {
    super(motivo);
    this.name = 'CanonicalJsonError';
    this.motivo = motivo;
    this.caminho = caminho || null;
  }
}

// Só objeto "simples" é conteúdo canônico. Date, Map, Set, RegExp, Buffer e
// instâncias de classe são recusados EXPLICITAMENTE: JSON.stringify os
// converteria (ou os esvaziaria) em silêncio, e o que chega ao ERP deixaria de
// ser o que o domínio quis dizer.
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Núcleo compartilhado: normaliza para JSON canônico determinístico (chaves
// ordenadas, ordem de array preservada) e RECUSA o que não é JSON-safe.
//
// R3-MEDIUM-02 — antes, estourar a profundidade devolvia `null`: um sub-objeto
// legítimo virava nada, sem erro, e dois payloads diferentes podiam produzir o
// MESMO fingerprint truncado. Agora estourar é erro. É a mesma função usada pelo
// builder, pelo validator e pelo fingerprint — uma regra de profundidade só.
function canonicalizeJsonSafe(value, { dropForbiddenKeys = false, depth = 0, caminho = '' } = {}) {
  if (depth > LIMITS.MAX_PAYLOAD_DEPTH) {
    throw new CanonicalJsonError(CANONICAL_JSON_ERROR.DEPTH_EXCEEDED, caminho);
  }
  if (value === null) return null;

  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    // NaN/Infinity viram `null` em JSON.stringify — perda silenciosa de sentido.
    if (!Number.isFinite(value)) throw new CanonicalJsonError(CANONICAL_JSON_ERROR.NOT_JSON_SAFE, caminho);
    return value;
  }
  // BigInt faz JSON.stringify LANÇAR no meio da cadeia; function/symbol/undefined
  // somem sem aviso. Todos recusados aqui, no boundary, com motivo nomeado.
  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new CanonicalJsonError(CANONICAL_JSON_ERROR.NOT_JSON_SAFE, caminho);
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => canonicalizeJsonSafe(v, {
      dropForbiddenKeys, depth: depth + 1, caminho: `${caminho}[${i}]`,
    }));
  }
  if (!isPlainObject(value)) {
    throw new CanonicalJsonError(CANONICAL_JSON_ERROR.NOT_JSON_SAFE, caminho);
  }

  const out = {};
  for (const k of Object.keys(value).sort()) {
    const v = value[k];
    const p = caminho ? `${caminho}.${k}` : k;
    // Chave com valor `undefined` é ausência de chave em JSON. Normalização
    // explícita e documentada (não é truncamento de conteúdo).
    if (v === undefined) continue;
    if (dropForbiddenKeys && isForbiddenKey(k)) continue; // dropa segredo na construção
    out[k] = canonicalizeJsonSafe(v, { dropForbiddenKeys, depth: depth + 1, caminho: p });
  }
  return out;
}

// Remove recursivamente qualquer chave sensível de um objeto/array e devolve uma
// CÓPIA canônica JSON-safe; nunca muta a entrada. Lança CanonicalJsonError se o
// conteúdo estourar a profundidade ou não for JSON-safe.
function sanitizeObject(value) {
  if (value === null || value === undefined) return value;
  return canonicalizeJsonSafe(value, { dropForbiddenKeys: true });
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function novoEventId() {
  const crypto = require('node:crypto');
  return crypto.randomUUID();
}

// Procura recursivamente uma chave proibida. Retorna o CAMINHO da primeira
// encontrada (para diagnóstico) ou null. Caminha a estrutura em vez de casar regex
// sobre o JSON serializado: um valor de texto contendo a palavra "token" não é uma
// chave sensível, e uma chave aninhada dentro de array não seria pega de forma
// confiável por regex.
function findForbiddenKeyPath(value, caminho = '', depth = 0) {
  if (depth > LIMITS.MAX_PAYLOAD_DEPTH + 2 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const achado = findForbiddenKeyPath(value[i], `${caminho}[${i}]`, depth + 1);
      if (achado) return achado;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = caminho ? `${caminho}.${k}` : k;
    if (isForbiddenKey(k)) return p;
    const achado = findForbiddenKeyPath(v, p, depth + 1);
    if (achado) return achado;
  }
  return null;
}

function limiteOk(v, max) {
  return typeof v === 'string' && v.length <= max;
}

// Valida a FORMA de um envelope já pronto (construído aqui ou recebido inbound).
// Não muta. Retorna { ok, motivo }. NÃO valida entity_type contra enum (escopo
// diferido). É a AUTORIDADE ÚNICA da forma: `buildEnvelope` termina aqui.
//
// FAIL-CLOSED: se o envelope carrega uma chave sensível — em qualquer lugar,
// inclusive no topo — `ok` é FALSE. A recusa é o default: um caller distraído não
// tem como aceitar um envelope com segredo por esquecer de conferir um flag.
function validateEnvelope(env) {
  if (!isPlainObject(env)) return { ok: false, motivo: 'nao_e_objeto' };

  // Forma FECHADA: nada além dos campos canônicos do v1.
  for (const k of Object.keys(env)) {
    if (!CANONICAL_TOP_LEVEL_FIELDS.includes(k)) {
      return { ok: false, motivo: `campo_top_level_desconhecido:${k}`, chaveSensivel: isForbiddenKey(k) ? k : null };
    }
  }

  if (env.schema_version !== SCHEMA_VERSION) return { ok: false, motivo: 'schema_version_incompativel' };

  for (const campo of ['event_id', 'empresa_id', 'entity_type', 'entity_id', 'event_type', 'occurred_at', 'source']) {
    if (!isNonEmptyString(env[campo])) return { ok: false, motivo: `campo_obrigatorio_ausente:${campo}` };
  }

  // Bounds — os MESMOS que o builder aplica (simetria).
  const bounds = [
    ['event_id', LIMITS.MAX_EVENT_ID],
    ['empresa_id', LIMITS.MAX_EMPRESA_ID],
    ['entity_type', LIMITS.MAX_ENTITY_TYPE],
    ['entity_id', LIMITS.MAX_ENTITY_ID],
    ['event_type', LIMITS.MAX_EVENT_TYPE],
    ['source', LIMITS.MAX_SOURCE],
  ];
  for (const [campo, max] of bounds) {
    if (!limiteOk(env[campo], max)) return { ok: false, motivo: `campo_excede_limite:${campo}` };
  }

  // Opcionais: ausente ou null é aceito; presente tem de ser string dentro do teto.
  const opcionais = [
    ['request_id', LIMITS.MAX_REQUEST_ID],
    ['correlation_id', LIMITS.MAX_CORRELATION_ID],
  ];
  for (const [campo, max] of opcionais) {
    const v = env[campo];
    if (v === null || v === undefined) continue;
    if (!limiteOk(v, max)) return { ok: false, motivo: `campo_opcional_invalido:${campo}` };
  }

  // occurred_at precisa ser uma data real (não só "uma string não vazia").
  if (!Number.isFinite(Date.parse(env.occurred_at))) {
    return { ok: false, motivo: 'occurred_at_invalido' };
  }

  if (!isPlainObject(env.payload)) return { ok: false, motivo: 'payload_invalido' };
  if (env.metadata !== undefined && env.metadata !== null && !isPlainObject(env.metadata)) {
    return { ok: false, motivo: 'metadata_invalido' };
  }
  const metadata = env.metadata || {};
  if (Object.keys(metadata).length > LIMITS.MAX_METADATA_KEYS) {
    return { ok: false, motivo: 'metadata_excede_limite_de_chaves' };
  }

  // Conteúdo canônico: profundidade e JSON-safety. Recusa explícita, sem truncar.
  try {
    canonicalizeJsonSafe(env.payload);
    canonicalizeJsonSafe(metadata);
  } catch (e) {
    if (e instanceof CanonicalJsonError) return { ok: false, motivo: e.motivo, caminho: e.caminho };
    throw e;
  }

  // Defesa em profundidade: nenhum segredo pode ter sobrevivido, em nível nenhum.
  const caminhoSensivel = findForbiddenKeyPath({ payload: env.payload, metadata });
  if (caminhoSensivel) {
    return { ok: false, motivo: 'chave_sensivel_detectada', chaveSensivel: caminhoSensivel };
  }

  // Teto de sanidade do tamanho serializado — também no inbound, não só no build.
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(env), 'utf8');
  } catch {
    return { ok: false, motivo: CANONICAL_JSON_ERROR.NOT_JSON_SAFE };
  }
  if (bytes > LIMITS.MAX_PAYLOAD_BYTES) return { ok: false, motivo: 'envelope_excede_teto_de_tamanho' };

  return { ok: true, motivo: null, chaveSensivel: null };
}

// Constrói um envelope canônico sanitizado e validado. `now` injetável para testes.
//
// R3-HIGH-01 — EVENT_ID_CREATED_ONCE_PER_LOGICAL_EVENT. `event_id` é a IDENTIDADE
// DA OCORRÊNCIA LÓGICA, não da tentativa. Quando o caller está CRIANDO uma
// ocorrência nova, o builder gera um UUID. Depois de criada, o envelope é um
// SNAPSHOT: um retry do MESMO evento precisa reusar o MESMO `event_id`, e por isso
// `eventId` fornecido é preservado exatamente. `request_id`, `correlation_id` e
// `occurred_at` são da tentativa/observabilidade e NÃO são identidade idempotente.
function buildEnvelope(input = {}, { now = new Date(), eventId = null } = {}) {
  const {
    empresaId, entityType, entityId, eventType,
    source = 'matopiba', correlationId = null, requestId = null,
    payload = {}, metadata = {},
  } = input;

  if (eventId !== null && eventId !== undefined && !isNonEmptyString(eventId)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'event_id fornecido invalido');
  }
  if (payload !== undefined && payload !== null && !isPlainObject(payload)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'payload_invalido');
  }
  if (metadata !== undefined && metadata !== null && !isPlainObject(metadata)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'metadata_invalido');
  }

  let safePayload;
  let safeMetadata;
  try {
    safePayload = sanitizeObject(payload) || {};
    safeMetadata = sanitizeObject(metadata) || {};
  } catch (e) {
    if (e instanceof CanonicalJsonError) {
      throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, `${e.motivo}${e.caminho ? `:${e.caminho}` : ''}`);
    }
    throw e;
  }

  const instante = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instante.getTime())) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, 'occurred_at_invalido');
  }

  const envelope = {
    schema_version: SCHEMA_VERSION,
    event_id: eventId || novoEventId(),
    request_id: isNonEmptyString(requestId) ? requestId : null,
    correlation_id: isNonEmptyString(correlationId) ? correlationId : null,
    empresa_id: empresaId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    occurred_at: instante.toISOString(),
    source,
    payload: safePayload,
    metadata: safeMetadata,
  };

  // Autoridade única da forma: o que o validator recusa, o builder não produz.
  const v = validateEnvelope(envelope);
  if (!v.ok) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.INVALID_ENVELOPE, v.motivo);
  }
  return envelope;
}

module.exports = {
  SCHEMA_VERSION,
  CANONICAL_TOP_LEVEL_FIELDS,
  FORBIDDEN_KEY_FRAGMENTS,
  CANONICAL_JSON_ERROR,
  CanonicalJsonError,
  isPlainObject,
  isForbiddenKey,
  findForbiddenKeyPath,
  canonicalizeJsonSafe,
  sanitizeObject,
  buildEnvelope,
  validateEnvelope,
};

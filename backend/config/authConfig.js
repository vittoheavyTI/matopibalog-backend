// backend/config/authConfig.js — Módulo ÚNICO de configuração de autenticação (SEC-1).
//
// Centraliza TODAS as flags/TTLs/segredos de auth. Nada de process.env espalhado
// por controllers/services/middlewares. Parsing ESTRITO e fail-closed:
//   * boolean aceita SÓ "true"/"false" (case-insensitive, trim); qualquer outro → erro;
//   * inteiros: só dígitos; fora da faixa → erro; ausência → default documentado;
//   * idle_ttl <= absolute_ttl; grace em [0,300] (mesma faixa da RPC 062);
//   * combinações incompatíveis (require sem sessions; rotation sem sessions) → erro;
//   * se sessões habilitadas sem pepper (ou sem JWT_SECRET) → FALHA no startup;
//   * segredos NUNCA são impressos (só presença via hasPepper/hasJwtSecret).
//
// Defaults locais (pré-Gate A): sessões/rotação/require = OFF; legado = ON.

class AuthConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'AuthConfigurationError'; }
}

// ── parsers estritos ─────────────────────────────────────────────────────────
function parseBoolEstrito(raw, chave, def) {
  if (raw === undefined || raw === null || raw === '') return def;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new AuthConfigurationError(`${chave}: booleano inválido ("${raw}"). Use "true" ou "false".`);
}

function parseIntEstrito(raw, chave, { def, min, max }) {
  let n;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (def === undefined) throw new AuthConfigurationError(`${chave}: ausente e sem default.`);
    n = def;
  } else {
    const s = String(raw).trim();
    if (!/^-?\d+$/.test(s)) throw new AuthConfigurationError(`${chave}: inteiro inválido ("${raw}").`);
    n = Number(s);
  }
  if (!Number.isInteger(n)) throw new AuthConfigurationError(`${chave}: não é inteiro.`);
  if (min !== undefined && n < min) throw new AuthConfigurationError(`${chave}: ${n} < mínimo ${min}.`);
  if (max !== undefined && n > max) throw new AuthConfigurationError(`${chave}: ${n} > máximo ${max}.`);
  return n;
}

function parseStr(raw, def) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  return String(raw).trim();
}

// Faixas seguras (mín/máx). grace casa com a RPC 062 (0..300).
const DIA = 86400;
const FAIXAS = {
  access:   { def: 600,        min: 60,   max: 3600 },        // 1min..1h
  idle:     { def: 1800,       min: 60,   max: 90 * DIA },    // 1min..90d
  absolute: { def: 30 * DIA,   min: 3600, max: 365 * DIA },   // 1h..365d
  grace:    { def: 10,         min: 0,    max: 300 },
  throttle: { def: 60,         min: 0,    max: 3600 },
};

/**
 * Carrega e VALIDA a configuração de auth a partir de `env` (default process.env).
 * Lança AuthConfigurationError em qualquer inconsistência (fail-closed no startup).
 * Retorna um objeto CONGELADO. Segredos ficam acessíveis via getters de valor, mas
 * nunca no summary/log.
 */
function loadAuthConfig(env = process.env) {
  const sessionsEnabled = parseBoolEstrito(env.AUTH_SESSIONS_ENABLED, 'AUTH_SESSIONS_ENABLED', false);
  const rotationEnabled = parseBoolEstrito(env.AUTH_REFRESH_ROTATION_ENABLED, 'AUTH_REFRESH_ROTATION_ENABLED', false);
  const requireSession  = parseBoolEstrito(env.AUTH_REQUIRE_SESSION, 'AUTH_REQUIRE_SESSION', false);
  const allowLegacy     = parseBoolEstrito(env.AUTH_ALLOW_LEGACY_TOKENS, 'AUTH_ALLOW_LEGACY_TOKENS', true);

  const legacyCutoffRaw = parseStr(env.AUTH_LEGACY_TOKEN_CUTOFF, null);
  let legacyCutoff = null;
  if (legacyCutoffRaw !== null) {
    const t = Date.parse(legacyCutoffRaw);
    if (Number.isNaN(t)) throw new AuthConfigurationError('AUTH_LEGACY_TOKEN_CUTOFF: data ISO inválida.');
    legacyCutoff = new Date(t).toISOString();
  }

  const accessTtl   = parseIntEstrito(env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 'AUTH_ACCESS_TOKEN_TTL_SECONDS', FAIXAS.access);
  const idleTtl     = parseIntEstrito(env.AUTH_REFRESH_IDLE_TTL_SECONDS, 'AUTH_REFRESH_IDLE_TTL_SECONDS', FAIXAS.idle);
  const absoluteTtl = parseIntEstrito(env.AUTH_REFRESH_ABSOLUTE_TTL_SECONDS, 'AUTH_REFRESH_ABSOLUTE_TTL_SECONDS', FAIXAS.absolute);
  const graceSecs   = parseIntEstrito(env.AUTH_REFRESH_REUSE_GRACE_SECONDS, 'AUTH_REFRESH_REUSE_GRACE_SECONDS', FAIXAS.grace);
  const throttleSecs = parseIntEstrito(env.AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS, 'AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS', FAIXAS.throttle);

  const issuer   = parseStr(env.AUTH_TOKEN_ISSUER, 'matopibalog');
  const audience = parseStr(env.AUTH_TOKEN_AUDIENCE, 'matopibalog-clients');

  // Segredos: só referenciados. Nunca logados.
  const pepper    = parseStr(env.AUTH_REFRESH_TOKEN_PEPPER, null);
  const jwtSecret = parseStr(env.JWT_SECRET, null);

  // ── validações cruzadas (matriz formal de modos) ─────────────────────────
  // JWT_SECRET é obrigatório SEMPRE: o login legado assina JWT e o verifyToken o
  // valida; o access token de sessão também é assinado. Enquanto o legado existir
  // (todos os modos suportados hoje), o segredo é exigido no startup.
  if (!jwtSecret) {
    throw new AuthConfigurationError('JWT_SECRET ausente (obrigatório enquanto o legado existir e para assinar o access token).');
  }
  if (idleTtl > absoluteTtl) {
    throw new AuthConfigurationError(`AUTH_REFRESH_IDLE_TTL_SECONDS (${idleTtl}) não pode exceder AUTH_REFRESH_ABSOLUTE_TTL_SECONDS (${absoluteTtl}).`);
  }
  if (throttleSecs > idleTtl) {
    throw new AuthConfigurationError(`AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS (${throttleSecs}) não pode exceder o idle TTL (${idleTtl}).`);
  }
  if (requireSession && !sessionsEnabled) {
    throw new AuthConfigurationError('AUTH_REQUIRE_SESSION=true exige AUTH_SESSIONS_ENABLED=true.');
  }
  if (rotationEnabled && !sessionsEnabled) {
    throw new AuthConfigurationError('AUTH_REFRESH_ROTATION_ENABLED=true exige AUTH_SESSIONS_ENABLED=true.');
  }
  // Modo estrito (requireSession) NÃO pode aceitar legado.
  if (requireSession && allowLegacy) {
    throw new AuthConfigurationError('AUTH_REQUIRE_SESSION=true (modo estrito) exige AUTH_ALLOW_LEGACY_TOKENS=false.');
  }
  // Se o legado é proibido, a sessão precisa ser obrigatória (senão nada autentica).
  if (!allowLegacy && !requireSession) {
    throw new AuthConfigurationError('AUTH_ALLOW_LEGACY_TOKENS=false exige AUTH_REQUIRE_SESSION=true.');
  }
  // Segredo do refresh só é exigido quando sessões/rotação estão habilitadas.
  if (sessionsEnabled && !pepper) {
    throw new AuthConfigurationError('AUTH_SESSIONS_ENABLED=true exige AUTH_REFRESH_TOKEN_PEPPER (ausente).');
  }
  if (sessionsEnabled && (!issuer || !audience)) {
    throw new AuthConfigurationError('AUTH_SESSIONS_ENABLED=true exige issuer e audience.');
  }

  // authMode derivado — controllers/middlewares consomem isto (não recalculam flags).
  const authMode = !sessionsEnabled ? 'legacy' : (requireSession ? 'strict' : 'compatible');

  const cfg = {
    authMode,
    sessionsEnabled, rotationEnabled, requireSession, allowLegacy, legacyCutoff,
    accessTtlSeconds: accessTtl,
    refreshIdleTtlSeconds: idleTtl,
    refreshAbsoluteTtlSeconds: absoluteTtl,
    refreshReuseGraceSeconds: graceSecs,
    sessionActivityThrottleSeconds: throttleSecs,
    issuer, audience,
    // presença de segredos (nunca o valor no summary)
    hasPepper: !!pepper,
    hasJwtSecret: !!jwtSecret,
    // valores dos segredos — acesso controlado; NÃO enumerar em logs.
    getPepper: () => pepper,
    getJwtSecret: () => jwtSecret,
    // summary seguro (sem segredos) para log de boot.
    summary() {
      return {
        authMode, sessionsEnabled, rotationEnabled, requireSession, allowLegacy,
        legacyCutoff, accessTtlSeconds: accessTtl, refreshIdleTtlSeconds: idleTtl,
        refreshAbsoluteTtlSeconds: absoluteTtl, refreshReuseGraceSeconds: graceSecs,
        sessionActivityThrottleSeconds: throttleSecs, issuer, audience,
        hasPepper: !!pepper, hasJwtSecret: !!jwtSecret,
      };
    },
  };
  return Object.freeze(cfg);
}

// Config carregada UMA vez, sob demanda (memoizada). O server chama getAuthConfig()
// no boot → falha rápido se inválida (ex.: JWT_SECRET ausente). NÃO é eager no
// require para não acoplar a ordem de import dos testes (que setam process.env
// localmente) — os testes usam loadAuthConfig(env) puro com env explícito.
let _cache = null;
function getAuthConfig() {
  if (!_cache) _cache = loadAuthConfig(process.env);
  return _cache;
}
// Somente para testes: limpa o cache do singleton.
function _resetAuthConfigCache() { _cache = null; }

module.exports = { loadAuthConfig, getAuthConfig, _resetAuthConfigCache, AuthConfigurationError, FAIXAS };

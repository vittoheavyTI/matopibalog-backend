// Testes do módulo central de configuração de auth (SEC-1) — backend/config/authConfig.js
// Parsing estrito, fail-closed, matriz formal de modos, segredos nunca expostos.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthConfig, getAuthConfig, _resetAuthConfigCache, AuthConfigurationError } = require('../config/authConfig');

// JWT_SECRET é obrigatório SEMPRE (legado assina/valida JWT). Base válida mínima:
const BASE = { JWT_SECRET: 'jwt-teste' };
// Sessões habilitadas exigem pepper + jwt:
const SEG = { AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste', JWT_SECRET: 'jwt-teste' };
const carregar = (env) => loadAuthConfig({ ...env });

// ── JWT_SECRET obrigatório sempre ────────────────────────────────────────────
test('JWT_SECRET ausente → falha (mesmo no modo legado)', () => {
  assert.throws(() => carregar({}), AuthConfigurationError);
  assert.throws(() => carregar({ AUTH_ALLOW_LEGACY_TOKENS: 'true' }), AuthConfigurationError);
});

test('defaults (só JWT_SECRET) → modo legado, sessões OFF, legado ON', () => {
  const c = carregar(BASE);
  assert.equal(c.authMode, 'legacy');
  assert.equal(c.sessionsEnabled, false);
  assert.equal(c.rotationEnabled, false);
  assert.equal(c.requireSession, false);
  assert.equal(c.allowLegacy, true);
  assert.equal(c.accessTtlSeconds, 600);
  assert.equal(c.refreshReuseGraceSeconds, 10);
});

// ── booleanos estritos ───────────────────────────────────────────────────────
test('boolean "true"/"false" exatos', () => {
  assert.equal(carregar({ ...BASE, AUTH_SESSIONS_ENABLED: 'false' }).sessionsEnabled, false);
});
test('boolean tolera MAIÚSCULAS e espaços', () => {
  assert.equal(carregar({ ...BASE, AUTH_ALLOW_LEGACY_TOKENS: '  FALSE ', AUTH_REQUIRE_SESSION: 'true', AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', ...SEG }).allowLegacy, false);
  assert.equal(carregar({ ...BASE, AUTH_ALLOW_LEGACY_TOKENS: 'True' }).allowLegacy, true);
});
test('boolean inválido ("1"/"yes"/"sim") → erro (sem coerção ingênua)', () => {
  for (const v of ['1', '0', 'yes', 'no', 'sim', 'on', 'off']) {
    assert.throws(() => carregar({ ...BASE, AUTH_ALLOW_LEGACY_TOKENS: v }), AuthConfigurationError, `valor=${v}`);
  }
});
test('string "false" NÃO vira true', () => {
  assert.equal(carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'false' }).sessionsEnabled, false);
});

// ── inteiros / faixas ────────────────────────────────────────────────────────
test('inteiro inválido → erro', () => {
  assert.throws(() => carregar({ ...BASE, AUTH_ACCESS_TOKEN_TTL_SECONDS: 'abc' }), AuthConfigurationError);
  assert.throws(() => carregar({ ...BASE, AUTH_ACCESS_TOKEN_TTL_SECONDS: '12.5' }), AuthConfigurationError);
});
test('inteiro negativo / abaixo do mínimo → erro', () => {
  assert.throws(() => carregar({ ...BASE, AUTH_ACCESS_TOKEN_TTL_SECONDS: '-1' }), AuthConfigurationError);
  assert.throws(() => carregar({ ...BASE, AUTH_ACCESS_TOKEN_TTL_SECONDS: '10' }), AuthConfigurationError); // <60
});
test('inteiro acima do máximo → erro', () => {
  assert.throws(() => carregar({ ...BASE, AUTH_ACCESS_TOKEN_TTL_SECONDS: '999999' }), AuthConfigurationError);
});
test('grace fora da faixa [0,300] → erro; dentro → ok', () => {
  assert.throws(() => carregar({ ...BASE, AUTH_REFRESH_REUSE_GRACE_SECONDS: '-1' }), AuthConfigurationError);
  assert.throws(() => carregar({ ...BASE, AUTH_REFRESH_REUSE_GRACE_SECONDS: '301' }), AuthConfigurationError);
  assert.equal(carregar({ ...BASE, AUTH_REFRESH_REUSE_GRACE_SECONDS: '0' }).refreshReuseGraceSeconds, 0);
  assert.equal(carregar({ ...BASE, AUTH_REFRESH_REUSE_GRACE_SECONDS: '300' }).refreshReuseGraceSeconds, 300);
});
test('idle > absoluto → erro', () => {
  assert.throws(() => carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true',
    AUTH_REFRESH_IDLE_TTL_SECONDS: String(40 * 86400), AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: String(30 * 86400) }), AuthConfigurationError);
});
test('throttle > idle → erro', () => {
  assert.throws(() => carregar({ ...BASE, AUTH_REFRESH_IDLE_TTL_SECONDS: '120', AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS: '3600' }), AuthConfigurationError);
});

// ── matriz formal de modos ───────────────────────────────────────────────────
test('MODO LEGADO', () => {
  const c = carregar({ ...BASE, AUTH_SESSIONS_ENABLED: 'false', AUTH_REFRESH_ROTATION_ENABLED: 'false', AUTH_REQUIRE_SESSION: 'false', AUTH_ALLOW_LEGACY_TOKENS: 'true' });
  assert.equal(c.authMode, 'legacy');
});
test('MODO COMPATÍVEL', () => {
  const c = carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', AUTH_REQUIRE_SESSION: 'false', AUTH_ALLOW_LEGACY_TOKENS: 'true' });
  assert.equal(c.authMode, 'compatible');
});
test('MODO ESTRITO', () => {
  const c = carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true', AUTH_REQUIRE_SESSION: 'true', AUTH_ALLOW_LEGACY_TOKENS: 'false' });
  assert.equal(c.authMode, 'strict');
});

test('rejeições da matriz', () => {
  // rotation sem sessions
  assert.throws(() => carregar({ ...BASE, AUTH_REFRESH_ROTATION_ENABLED: 'true' }), AuthConfigurationError);
  // sessions sem rotation
  assert.throws(() => carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'false' }), AuthConfigurationError);
  // require sem sessions
  assert.throws(() => carregar({ ...BASE, AUTH_REQUIRE_SESSION: 'true' }), AuthConfigurationError);
  // require (estrito) com legado permitido
  assert.throws(() => carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true', AUTH_REQUIRE_SESSION: 'true', AUTH_ALLOW_LEGACY_TOKENS: 'true' }), AuthConfigurationError);
  // legado proibido sem require
  assert.throws(() => carregar({ ...BASE, AUTH_ALLOW_LEGACY_TOKENS: 'false' }), AuthConfigurationError);
  // sessions sem pepper
  assert.throws(() => carregar({ AUTH_SESSIONS_ENABLED: 'true', JWT_SECRET: 'x' }), AuthConfigurationError);
});

test('cutoff ISO válido/inválido', () => {
  assert.equal(typeof carregar({ ...BASE, AUTH_LEGACY_TOKEN_CUTOFF: '2026-09-01T00:00:00Z' }).legacyCutoff, 'string');
  assert.throws(() => carregar({ ...BASE, AUTH_LEGACY_TOKEN_CUTOFF: 'nao-e-data' }), AuthConfigurationError);
});

// ── segredos nunca expostos ──────────────────────────────────────────────────
test('segredos NUNCA aparecem no summary (só presença)', () => {
  const c = carregar({ ...SEG, AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_ROTATION_ENABLED: 'true' });
  const json = JSON.stringify(c.summary());
  assert.ok(!json.includes('pepper-teste'), 'summary sem pepper');
  assert.ok(!json.includes('jwt-teste'), 'summary sem jwt');
  assert.equal(c.summary().hasPepper, true);
  assert.equal(c.summary().hasJwtSecret, true);
  assert.equal(c.getPepper(), 'pepper-teste');
  assert.equal(c.getJwtSecret(), 'jwt-teste');
});

test('config é congelada (imutável)', () => {
  const c = carregar(BASE);
  try { c.sessionsEnabled = true; } catch { /* strict lançaria */ }
  assert.equal(c.sessionsEnabled, false);
  assert.equal(Object.isFrozen(c), true);
});

// ── carregamento único (memoizado) ───────────────────────────────────────────
test('getAuthConfig memoiza (mesma instância) e reflete process.env do boot', () => {
  const orig = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'boot-secret';
  _resetAuthConfigCache();
  const a = getAuthConfig();
  const b = getAuthConfig();
  assert.equal(a, b, 'mesma instância memoizada');
  assert.equal(a.authMode, 'legacy');
  // restore
  if (orig === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = orig;
  _resetAuthConfigCache();
});

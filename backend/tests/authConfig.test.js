// Testes do módulo central de configuração de auth (SEC-1) — backend/config/authConfig.js
// Parsing estrito, fail-closed, faixas, combinações, segredos nunca expostos.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthConfig, AuthConfigurationError } = require('../config/authConfig');

// env base: sessões habilitadas exigem pepper+jwt; forneço-os para os casos "on".
const SEG = { AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste', JWT_SECRET: 'jwt-teste' };
const carregar = (env) => loadAuthConfig(env);

test('ausência total → defaults seguros (modo legado, sessões OFF, legado ON)', () => {
  const c = carregar({});
  assert.equal(c.sessionsEnabled, false);
  assert.equal(c.rotationEnabled, false);
  assert.equal(c.requireSession, false);
  assert.equal(c.allowLegacy, true);
  assert.equal(c.modo, 'legado');
  assert.equal(c.accessTtlSeconds, 600);
  assert.equal(c.refreshReuseGraceSeconds, 10);
});

test('boolean "true"/"false" exatos', () => {
  assert.equal(carregar({ AUTH_ALLOW_LEGACY_TOKENS: 'false' }).allowLegacy, false);
  assert.equal(carregar({ AUTH_ALLOW_LEGACY_TOKENS: 'true' }).allowLegacy, true);
});

test('boolean tolera MAIÚSCULAS e espaços', () => {
  assert.equal(carregar({ AUTH_ALLOW_LEGACY_TOKENS: '  FALSE ' }).allowLegacy, false);
  assert.equal(carregar({ AUTH_ALLOW_LEGACY_TOKENS: 'True' }).allowLegacy, true);
});

test('boolean inválido ("1"/"yes"/"sim") → erro (sem coerção ingênua)', () => {
  for (const v of ['1', '0', 'yes', 'no', 'sim', 'on', 'off']) {
    assert.throws(() => carregar({ AUTH_ALLOW_LEGACY_TOKENS: v }), AuthConfigurationError, `valor=${v}`);
  }
});

test('string "false" NÃO vira true', () => {
  assert.equal(carregar({ AUTH_SESSIONS_ENABLED: 'false', ...SEG }).sessionsEnabled, false);
});

test('inteiro inválido → erro', () => {
  assert.throws(() => carregar({ AUTH_ACCESS_TOKEN_TTL_SECONDS: 'abc' }), AuthConfigurationError);
  assert.throws(() => carregar({ AUTH_ACCESS_TOKEN_TTL_SECONDS: '12.5' }), AuthConfigurationError);
});

test('inteiro negativo / abaixo do mínimo → erro', () => {
  assert.throws(() => carregar({ AUTH_ACCESS_TOKEN_TTL_SECONDS: '-1' }), AuthConfigurationError);
  assert.throws(() => carregar({ AUTH_ACCESS_TOKEN_TTL_SECONDS: '10' }), AuthConfigurationError); // <60
});

test('inteiro acima do máximo → erro', () => {
  assert.throws(() => carregar({ AUTH_ACCESS_TOKEN_TTL_SECONDS: '999999' }), AuthConfigurationError);
});

test('grace fora da faixa [0,300] → erro; dentro → ok', () => {
  assert.throws(() => carregar({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '-1' }), AuthConfigurationError);
  assert.throws(() => carregar({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '301' }), AuthConfigurationError);
  assert.equal(carregar({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '0' }).refreshReuseGraceSeconds, 0);
  assert.equal(carregar({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '300' }).refreshReuseGraceSeconds, 300);
});

test('idle > absoluto → erro', () => {
  assert.throws(() => carregar({
    AUTH_SESSIONS_ENABLED: 'true', ...SEG,
    AUTH_REFRESH_IDLE_TTL_SECONDS: String(40 * 86400),
    AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: String(30 * 86400),
  }), AuthConfigurationError);
});

test('combinação incompatível: require sem sessions → erro', () => {
  assert.throws(() => carregar({ AUTH_REQUIRE_SESSION: 'true' }), AuthConfigurationError);
});

test('combinação incompatível: rotation sem sessions → erro', () => {
  assert.throws(() => carregar({ AUTH_REFRESH_ROTATION_ENABLED: 'true' }), AuthConfigurationError);
});

test('sessions ON sem pepper → falha; com pepper mas sem jwt → falha; com ambos → compatível', () => {
  assert.throws(() => carregar({ AUTH_SESSIONS_ENABLED: 'true', JWT_SECRET: 'x' }), AuthConfigurationError); // sem pepper
  assert.throws(() => carregar({ AUTH_SESSIONS_ENABLED: 'true', AUTH_REFRESH_TOKEN_PEPPER: 'p' }), AuthConfigurationError); // sem jwt
  const c = carregar({ AUTH_SESSIONS_ENABLED: 'true', ...SEG });
  assert.equal(c.sessionsEnabled, true);
  assert.equal(c.modo, 'compativel');
});

test('modo estrito requer sessions + require', () => {
  const c = carregar({ AUTH_SESSIONS_ENABLED: 'true', AUTH_REQUIRE_SESSION: 'true', ...SEG });
  assert.equal(c.modo, 'estrito');
});

test('cutoff ISO válido/ inválido', () => {
  assert.equal(typeof carregar({ AUTH_LEGACY_TOKEN_CUTOFF: '2026-09-01T00:00:00Z' }).legacyCutoff, 'string');
  assert.throws(() => carregar({ AUTH_LEGACY_TOKEN_CUTOFF: 'nao-e-data' }), AuthConfigurationError);
});

test('segredos NUNCA aparecem no summary (só presença)', () => {
  const c = carregar({ AUTH_SESSIONS_ENABLED: 'true', ...SEG });
  const s = c.summary();
  const json = JSON.stringify(s);
  assert.ok(!json.includes('pepper-teste'), 'summary não pode conter o pepper');
  assert.ok(!json.includes('jwt-teste'), 'summary não pode conter o jwt secret');
  assert.equal(s.hasPepper, true);
  assert.equal(s.hasJwtSecret, true);
  // valor acessível só via getter controlado
  assert.equal(c.getPepper(), 'pepper-teste');
  assert.equal(c.getJwtSecret(), 'jwt-teste');
});

test('config é congelada (imutável)', () => {
  const c = carregar({});
  try { c.sessionsEnabled = true; } catch { /* strict lançaria; non-strict ignora */ }
  assert.equal(c.sessionsEnabled, false, 'objeto congelado: atribuição não altera');
  assert.equal(Object.isFrozen(c), true);
});

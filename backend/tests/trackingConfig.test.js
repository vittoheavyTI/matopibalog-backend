const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthConfig, AuthConfigurationError } = require('../config/authConfig');

// Base de env com SESSÕES ON (modo compatível) — pré-requisito do tracking escopado.
function envSessoesOn(extra = {}) {
  return {
    JWT_SECRET: 'segredo-jwt-teste',
    AUTH_SESSIONS_ENABLED: 'true',
    AUTH_REFRESH_ROTATION_ENABLED: 'true',
    AUTH_REFRESH_TOKEN_PEPPER: 'pepper-teste',
    ...extra,
  };
}

test('default: tracking OFF, TTL = 86400s, teto absoluto = 604800s (7d)', () => {
  const cfg = loadAuthConfig(envSessoesOn());
  assert.equal(cfg.trackingScopedCredentialEnabled, false);
  assert.equal(cfg.trackingCredentialTtlSeconds, 86400);
  assert.equal(cfg.trackingCredentialMaxLifetimeSeconds, 604800);
});

test('teto absoluto NÃO pode ser menor que o TTL nominal (fail-closed)', () => {
  assert.throws(
    () => loadAuthConfig(envSessoesOn({ TRACKING_CREDENTIAL_TTL_SECONDS: '86400', TRACKING_CREDENTIAL_MAX_LIFETIME_SECONDS: '3600' })),
    AuthConfigurationError,
  );
});

test('teto absoluto configurável dentro da faixa', () => {
  const cfg = loadAuthConfig(envSessoesOn({ TRACKING_CREDENTIAL_MAX_LIFETIME_SECONDS: '1209600' }));
  assert.equal(cfg.trackingCredentialMaxLifetimeSeconds, 1209600);
});

test('tracking ON com sessões ON + pepper → habilitado', () => {
  const cfg = loadAuthConfig(envSessoesOn({ TRACKING_SCOPED_CREDENTIAL_ENABLED: 'true' }));
  assert.equal(cfg.trackingScopedCredentialEnabled, true);
});

test('tracking ON exige sessões ON (fail-closed)', () => {
  assert.throws(
    () => loadAuthConfig({ JWT_SECRET: 'x', TRACKING_SCOPED_CREDENTIAL_ENABLED: 'true' }),
    AuthConfigurationError,
  );
});

test('tracking ON sem pepper (sessões forçadas ON sem pepper) → falha', () => {
  // sessões ON sem pepper já falha; garantimos que tracking não "passa" nesse buraco.
  assert.throws(
    () => loadAuthConfig({
      JWT_SECRET: 'x',
      AUTH_SESSIONS_ENABLED: 'true',
      AUTH_REFRESH_ROTATION_ENABLED: 'true',
      TRACKING_SCOPED_CREDENTIAL_ENABLED: 'true',
      // sem AUTH_REFRESH_TOKEN_PEPPER
    }),
    AuthConfigurationError,
  );
});

test('TTL de tracking respeita faixa (min 900s)', () => {
  assert.throws(
    () => loadAuthConfig(envSessoesOn({ TRACKING_CREDENTIAL_TTL_SECONDS: '60' })),
    AuthConfigurationError,
  );
  const cfg = loadAuthConfig(envSessoesOn({ TRACKING_CREDENTIAL_TTL_SECONDS: '3600' }));
  assert.equal(cfg.trackingCredentialTtlSeconds, 3600);
});

test('TTL de tracking inválido (não-inteiro) → falha', () => {
  assert.throws(
    () => loadAuthConfig(envSessoesOn({ TRACKING_CREDENTIAL_TTL_SECONDS: 'abc' })),
    AuthConfigurationError,
  );
});

test('summary expõe flags de tracking e NUNCA o pepper', () => {
  const cfg = loadAuthConfig(envSessoesOn({ TRACKING_SCOPED_CREDENTIAL_ENABLED: 'true' }));
  const s = cfg.summary();
  assert.equal(s.trackingScopedCredentialEnabled, true);
  assert.equal(s.trackingCredentialTtlSeconds, 86400);
  assert.equal(s.trackingCredentialMaxLifetimeSeconds, 604800);
  assert.equal(s.hasPepper, true);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('pepper-teste'), 'summary não pode conter o valor do pepper');
});

test('OFF por default preserva o fluxo compatível (não altera outros campos)', () => {
  const cfg = loadAuthConfig(envSessoesOn());
  assert.equal(cfg.authMode, 'compatible');
  assert.equal(cfg.trackingScopedCredentialEnabled, false);
});

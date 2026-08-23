// MOBILE-M1-008 / D-053 — App Version Policy.
// Cobre: comparacao de versao NAO-lexicografica, calculo de severidade em todos os
// estados, defaults seguros (gate inerte) e o endpoint publico GET /app/version-policy.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  parseVersion,
  compareVersions,
  computeSeverity,
  buildPolicy,
  SEVERITY,
} = require('../utils/appVersionPolicy');

test('compareVersions nao e lexicografico (1.10.0 > 1.9.0)', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('compareVersions trata segmentos ausentes como zero e ignora build/pre-release', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0+45', '1.2.0+9'), 0); // build metadata ignorado
  assert.equal(compareVersions('1.2.0-rc1', '1.2.0'), 0); // pre-release simplificado
  assert.equal(compareVersions('1.2.1', '1.2'), 1);
});

test('compareVersions retorna null para versoes nao parseaveis', () => {
  assert.equal(compareVersions('abc', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', ''), null);
  assert.equal(compareVersions(null, '1.0.0'), null);
});

test('computeSeverity cobre todos os estados', () => {
  const policy = {
    minimum_supported_version: '1.2.0',
    recommended_version: '1.5.0',
    latest_version: '1.8.0',
  };
  assert.equal(computeSeverity('1.1.0', policy), SEVERITY.REQUIRED); // < minimo
  assert.equal(computeSeverity('1.2.0', policy), SEVERITY.RECOMMENDED); // >=min <rec
  assert.equal(computeSeverity('1.5.0', policy), SEVERITY.OPTIONAL); // >=rec <latest
  assert.equal(computeSeverity('1.8.0', policy), SEVERITY.NONE); // >= latest
  assert.equal(computeSeverity('2.0.0', policy), SEVERITY.NONE); // acima do latest
  assert.equal(computeSeverity('', policy), SEVERITY.UNKNOWN);
  assert.equal(computeSeverity('xyz', policy), SEVERITY.UNKNOWN);
});

test('buildPolicy usa defaults seguros (gate inerte) sem env', () => {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('APP_ANDROID_')) delete process.env[k];
  }
  const policy = buildPolicy('android');
  assert.equal(policy.platform, 'android');
  assert.equal(policy.latest_version, '1.0.0');
  assert.equal(policy.recommended_version, '1.0.0');
  assert.equal(policy.minimum_supported_version, '1.0.0');
  assert.ok(policy.store_url.includes('br.com.matopibalog.app'));
  // Com min=rec=latest=1.0.0, o app 1.0.0 nao recebe nenhuma acao.
  assert.equal(computeSeverity('1.0.0', policy), SEVERITY.NONE);
  process.env = saved;
});

test('buildPolicy respeita env quando definida', () => {
  const saved = { ...process.env };
  process.env.APP_ANDROID_MIN_VERSION = '1.2.0';
  process.env.APP_ANDROID_RECOMMENDED_VERSION = '1.5.0';
  process.env.APP_ANDROID_LATEST_VERSION = '1.8.0';
  process.env.APP_ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=x';
  const policy = buildPolicy('android');
  assert.equal(policy.minimum_supported_version, '1.2.0');
  assert.equal(policy.recommended_version, '1.5.0');
  assert.equal(policy.latest_version, '1.8.0');
  assert.equal(policy.store_url, 'https://play.google.com/store/apps/details?id=x');
  process.env = saved;
});

function subirApp() {
  const app = express();
  app.use('/app', require('../routes/appVersion'));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('GET /app/version-policy e publico e devolve a politica + severidade', async () => {
  const saved = { ...process.env };
  process.env.APP_ANDROID_MIN_VERSION = '1.2.0';
  process.env.APP_ANDROID_RECOMMENDED_VERSION = '1.5.0';
  process.env.APP_ANDROID_LATEST_VERSION = '1.8.0';
  const { server, port } = await subirApp();
  try {
    const r = await fetch(
      `http://127.0.0.1:${port}/app/version-policy?platform=android&current_version=1.1.0`,
    );
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.platform, 'android');
    assert.equal(body.minimum_supported_version, '1.2.0');
    assert.equal(body.update_severity, 'required');
    assert.equal(body.current_version, '1.1.0');
    assert.ok(typeof body.store_url === 'string');
  } finally {
    server.close();
    process.env = saved;
  }
});

test('GET /app/version-policy sem current_version nao calcula severidade', async () => {
  const { server, port } = await subirApp();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/app/version-policy`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.update_severity, null);
    assert.equal(body.current_version, null);
  } finally {
    server.close();
  }
});

test('GET /app/version-policy rejeita platform invalida', async () => {
  const { server, port } = await subirApp();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/app/version-policy?platform=windows`);
    assert.equal(r.status, 400);
  } finally {
    server.close();
  }
});

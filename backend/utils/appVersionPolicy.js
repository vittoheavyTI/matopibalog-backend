// App Version Policy (MOBILE-M1-008 / D-053) — fonte de autoridade central da
// politica de versao do app, servida ao cliente Flutter no startup/resume.
//
// Sem banco: a politica vive em variaveis de ambiente com defaults SEGUROS
// (min = recommended = latest = versao atual) — assim o gate nasce INERTE e nunca
// bloqueia por engano. O owner endurece a politica ajustando as envs no Railway,
// sem deploy de codigo e sem migration.
//
// A comparacao de versao NUNCA e lexicografica ("1.10.0" > "1.9.0"): compara
// segmento a segmento numericamente. O mesmo contrato e espelhado no app
// (app_android/lib/utils/version_compare.dart) e coberto por testes nos dois lados.

const DEFAULT_VERSION = '1.0.0';
const DEFAULT_STORE_URL =
  'https://play.google.com/store/apps/details?id=br.com.matopibalog.app';

// Severidades canonicas (contrato com o app).
const SEVERITY = Object.freeze({
  NONE: 'none',
  OPTIONAL: 'optional',
  RECOMMENDED: 'recommended',
  REQUIRED: 'required',
  UNKNOWN: 'unknown',
});

// Extrai os segmentos numericos de uma versao, descartando build metadata (+N) e
// pre-release (-rc1). Retorna null quando nao ha nenhum segmento numerico valido.
function parseVersion(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Remove build metadata e pre-release: "1.2.3+45" / "1.2.3-rc1" -> "1.2.3".
  const core = raw.split('+')[0].split('-')[0].trim();
  if (!core) return null;
  const parts = core.split('.');
  const nums = [];
  for (const part of parts) {
    // Aceita apenas segmentos puramente numericos; qualquer outro invalida.
    if (!/^\d+$/.test(part)) return null;
    nums.push(parseInt(part, 10));
  }
  return nums.length ? nums : null;
}

// compareVersions('1.10.0','1.9.0') === 1. Retorna -1 | 0 | 1, ou null quando
// qualquer lado nao e parseavel (o chamador decide o fallback seguro).
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va === null || vb === null) return null;
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i += 1) {
    const na = i < va.length ? va[i] : 0;
    const nb = i < vb.length ? vb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Calcula a severidade de atualizacao para uma versao atual do cliente diante da
// politica. Ordem de decisao: required (abaixo do minimo) > recommended > optional.
function computeSeverity(currentVersion, policy) {
  if (!currentVersion) return SEVERITY.UNKNOWN;
  const cmpMin = compareVersions(currentVersion, policy.minimum_supported_version);
  if (cmpMin === null) return SEVERITY.UNKNOWN;
  if (cmpMin < 0) return SEVERITY.REQUIRED;
  const cmpRec = compareVersions(currentVersion, policy.recommended_version);
  if (cmpRec !== null && cmpRec < 0) return SEVERITY.RECOMMENDED;
  const cmpLatest = compareVersions(currentVersion, policy.latest_version);
  if (cmpLatest !== null && cmpLatest < 0) return SEVERITY.OPTIONAL;
  return SEVERITY.NONE;
}

// Monta a politica a partir do ambiente (defaults seguros). Hoje so 'android'
// tem canal oficial; iOS reutiliza os mesmos defaults ate existir loja iOS.
function buildPolicy(platform) {
  const p = platform === 'ios' ? 'IOS' : 'ANDROID';
  const env = process.env;
  return {
    platform: p === 'IOS' ? 'ios' : 'android',
    latest_version: env[`APP_${p}_LATEST_VERSION`] || DEFAULT_VERSION,
    recommended_version:
      env[`APP_${p}_RECOMMENDED_VERSION`] || DEFAULT_VERSION,
    minimum_supported_version:
      env[`APP_${p}_MIN_VERSION`] || DEFAULT_VERSION,
    store_url: env[`APP_${p}_STORE_URL`] || DEFAULT_STORE_URL,
    release_notes: env[`APP_${p}_RELEASE_NOTES`] || '',
  };
}

module.exports = {
  SEVERITY,
  DEFAULT_VERSION,
  DEFAULT_STORE_URL,
  parseVersion,
  compareVersions,
  computeSeverity,
  buildPolicy,
};

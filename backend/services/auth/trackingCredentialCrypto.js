// backend/services/auth/trackingCredentialCrypto.js — cripto da credencial de
// rastreamento (SEC-1 / Opção C). Isolado e testável.
//
// Responsabilidades pequenas:
//   * gerar token OPACO de tracking (CSPRNG, 256 bits, sem dados legíveis);
//   * HMAC-SHA-256(pepper, 'tracking:'||token) — DOMAIN-SEPARATED do refresh (evita
//     que um hash de refresh e um de tracking colidam de domínio). Só o HASH vai ao banco.
//
// REGRAS: nunca logar/serializar o token ou o pepper; o token aberto NUNCA vai ao
// Supabase (só o hash); erros nunca contêm o valor do pepper/token.

const crypto = require('crypto');

const TRACKING_BYTES = 32;        // 256 bits de entropia
const TRACKING_PREFIX = 'mtk1';   // Matopiba Tracking Key v1 (formato versionável)
const HMAC_DOMAIN = 'tracking:';  // separador de domínio (não é segredo)

/** Token opaco de tracking: `mtk1.<base64url(32 bytes CSPRNG)>`. Sem uid/frete/dados legíveis. */
function gerarTrackingToken() {
  const raw = crypto.randomBytes(TRACKING_BYTES).toString('base64url');
  return `${TRACKING_PREFIX}.${raw}`;
}

/** true se o texto TEM a cara de um token de tracking (prefixo). Não valida entropia/assinatura. */
function pareceTrackingToken(valor) {
  return typeof valor === 'string' && valor.startsWith(`${TRACKING_PREFIX}.`) && valor.length > TRACKING_PREFIX.length + 1;
}

/** HMAC-SHA-256(pepper, 'tracking:'||token) em hex. Determinístico p/ o MESMO pepper. Só isto vai ao banco. */
function hashTrackingToken(token, pepper) {
  if (!token || typeof token !== 'string') throw new Error('tracking token ausente/inválido');
  if (!pepper || typeof pepper !== 'string') throw new Error('pepper ausente'); // NÃO expõe o valor
  return crypto.createHmac('sha256', pepper).update(HMAC_DOMAIN + token).digest('hex');
}

module.exports = {
  TRACKING_PREFIX, TRACKING_BYTES,
  gerarTrackingToken, pareceTrackingToken, hashTrackingToken,
};

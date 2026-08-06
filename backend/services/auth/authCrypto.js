// backend/services/auth/authCrypto.js — módulo criptográfico isolado (SEC-1).
//
// Responsabilidades pequenas e testáveis:
//   * gerar refresh token OPACO (CSPRNG, alta entropia, sem dados legíveis);
//   * HMAC-SHA-256 do refresh com o PEPPER do servidor (só o HASH vai à RPC/banco);
//   * gerar jti;
//   * assinar/verificar o ACCESS JWT curto (algoritmo/iss/aud explícitos).
//
// REGRAS: nunca logar/serializar segredo ou token; erros nunca contêm o valor do
// pepper/secret/token; o token aberto NUNCA é enviado ao Supabase (só o hash).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_ALGO = 'HS256';
const REFRESH_BYTES = 32;      // 256 bits de entropia
const REFRESH_PREFIX = 'r1';   // formato versionável (permite evoluir sem ambiguidade)

/** Refresh token opaco: `r1.<base64url(32 bytes CSPRNG)>`. Sem uid/sid/dados legíveis. */
function gerarRefreshToken() {
  const raw = crypto.randomBytes(REFRESH_BYTES).toString('base64url');
  return `${REFRESH_PREFIX}.${raw}`;
}

/** HMAC-SHA-256(pepper, token) em hex. Determinístico p/ o MESMO pepper. Só isto vai ao banco. */
function hashRefreshToken(token, pepper) {
  if (!token || typeof token !== 'string') throw new Error('refresh token ausente/ inválido');
  if (!pepper || typeof pepper !== 'string') throw new Error('pepper ausente'); // NÃO expõe o valor
  return crypto.createHmac('sha256', pepper).update(token).digest('hex');
}

function gerarJti() { return crypto.randomUUID(); }

/**
 * Assina o access token de sessão. Claims: sub/uid, sid, token_use=access, jti, iss,
 * aud, iat, exp. role/is_super_admin apenas AUXILIARES (autoridade real é o banco).
 * NUNCA inclui refresh/hash/senha/documento/dados pessoais.
 */
function assinarAccessToken({ uid, sid, role = null, isSuperAdmin = false }, cfg) {
  if (!uid) throw new Error('uid obrigatório');
  if (!sid) throw new Error('sid obrigatório');
  const secret = cfg.getJwtSecret();
  if (!secret) throw new Error('secret de assinatura ausente');
  const payload = { sub: String(uid), uid: String(uid), sid: String(sid), token_use: 'access', role: role ?? null, is_super_admin: !!isSuperAdmin };
  return jwt.sign(payload, secret, {
    algorithm: ACCESS_ALGO,
    expiresIn: cfg.accessTtlSeconds,
    issuer: cfg.issuer,
    audience: cfg.audience,
    jwtid: gerarJti(),
  });
}

/**
 * Verifica assinatura + algoritmo + issuer + audience + exp do access token.
 * Lança (JsonWebTokenError/TokenExpiredError) se inválido. NÃO classifica token_use/
 * sid — isso é papel do middleware (classificação legacy×session×inválido).
 */
function verificarAccessTokenAssinatura(token, cfg) {
  const secret = cfg.getJwtSecret();
  if (!secret) throw new Error('secret de verificação ausente');
  return jwt.verify(token, secret, {
    algorithms: [ACCESS_ALGO],   // rejeita 'none' e algoritmos divergentes
    issuer: cfg.issuer,
    audience: cfg.audience,
    clockTolerance: 5,           // pequena tolerância de relógio, controlada
  });
}

/** Decodifica sem verificar (só para classificação rápida/observabilidade — nunca autoriza). */
function decodificarSemVerificar(token) {
  try { return jwt.decode(token, { complete: true }); } catch { return null; }
}

module.exports = {
  ACCESS_ALGO, REFRESH_PREFIX, REFRESH_BYTES,
  gerarRefreshToken, hashRefreshToken, gerarJti,
  assinarAccessToken, verificarAccessTokenAssinatura, decodificarSemVerificar,
};

const jwt = require('jsonwebtoken');
const { ipKeyGenerator } = require('express-rate-limit');

// Chave do rate limit GERAL (apiLimiter). Antes era só por IP: vários usuários
// atrás do mesmo NAT/IP (empresa) + o polling da SPA dividiam o MESMO balde de
// 200/15min → estouravam 429 durante uso normal. Agora a chave é por USUÁRIO
// autenticado (uid do JWT, em cookie `token` OU header `Authorization: Bearer`),
// com FALLBACK por IP para requisições anônimas (login/public). O login continua
// com o seu próprio limiter estrito por IP — esta mudança NÃO o afeta.
//
// Puro/best-effort: qualquer falha ao ler/verificar o token cai no IP. jwt.verify
// (não decode) evita que um token forjado espalhe requisições por chaves falsas.
function chaveRateLimit(req) {
  try {
    let token = null;
    const auth = req.headers && req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
    if (!token && req.cookies && req.cookies.token) token = req.cookies.token;
    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.uid) return `user:${decoded.uid}`;
    }
  } catch (_) {
    // token ausente/inválido/expirado → chave por IP
  }
  // ipKeyGenerator normaliza IPv6 (exigência do express-rate-limit v7+).
  return ipKeyGenerator(req.ip);
}

module.exports = { chaveRateLimit };

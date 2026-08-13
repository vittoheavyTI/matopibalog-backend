// backend/middlewares/authSession.js — middleware de auth SEC-1 (compatível/estrito).
//
// CLASSIFICAÇÃO IRREVERSÍVEL do token, ANTES da autorização:
//   LEGACY  — sem token_use e sem sid; aceito só quando o modo permite legado.
//   SESSION — token_use=access E sid presente; exige verificação + sessão válida.
//   INVALID — claims de sessão PARCIAIS/incoerentes (sid sem token_use, token_use
//             sem sid, token_use != access) ou assinatura/sessão inválidas.
//
// REGRA ABSOLUTA: um token que APARENTA ser de sessão (tem sid/token_use) NUNCA cai
// para a validação legada. Se falhar como sessão, é INVÁLIDO — sem downgrade.
//
// FAIL-CLOSED: indisponibilidade do lookup de sessão → 503 (nunca "válido" nem legado).
// Consome authConfig (authMode/flags) e o sessionService (validação de sessão).

const jwt = require('jsonwebtoken');
const crypto = require('../services/auth/authCrypto');

/** Classificação por claims (payload NÃO-verificado — só para roteamento). */
function classificarPorClaims(payload) {
  const p = payload || {};
  const temSid = typeof p.sid === 'string' && p.sid.length > 0;
  const temTokenUse = Object.prototype.hasOwnProperty.call(p, 'token_use');
  const temAccess = p.token_use === 'access';
  // Nenhuma claim nova → candidato a legado.
  if (!temSid && !temTokenUse) return { kind: 'legacy' };
  // Session bem-formado.
  if (temSid && temAccess) return { kind: 'session' };
  // Qualquer combinação parcial/incoerente (sid sem access, token_use sem sid, use!=access).
  return { kind: 'invalid', reason: 'claims de sessão parciais/incoerentes' };
}

function lerToken(req) {
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

function verificarLegacy(token, cfg) {
  // Legado não tem iss/aud; ainda assim fixamos o algoritmo (evita alg confusion).
  return jwt.verify(token, cfg.getJwtSecret(), { algorithms: ['HS256'] });
}

function legadoAlemDoCutoff(cfg) {
  if (!cfg.legacyCutoff) return false;
  const t = Date.parse(cfg.legacyCutoff);
  return !Number.isNaN(t) && Date.now() > t;
}

/**
 * Factory do middleware. deps: { cfg (authConfig), sessionService }.
 * Retorna um middleware Express assíncrono que popula req.user (fonte confiável) e
 * req.authKind ('legacy'|'session').
 */
function criarVerifyTokenSec1({ cfg, sessionService }) {
  if (!cfg) throw new Error('cfg obrigatório');
  return async function verifyTokenSec1(req, res, next) {
    const token = lerToken(req);
    if (!token) return res.status(401).json({ message: 'Token não fornecido.' });

    const decoded = crypto.decodificarSemVerificar(token);
    const { kind } = classificarPorClaims(decoded && decoded.payload);

    // ── SESSION ────────────────────────────────────────────────────────────
    if (kind === 'session') {
      // Sessões desligadas: token de sessão não é validável → INVÁLIDO, sem downgrade,
      // sem consultar tabelas 062 (preserva o modo legado puro).
      if (!cfg.sessionsEnabled || !sessionService) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
      }
      let verificado;
      try {
        verificado = crypto.verificarAccessTokenAssinatura(token, cfg);
      } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado.' }); // NÃO tenta legado
      }
      try {
        req.user = await sessionService.validarSessaoParaAcesso({ sid: verificado.sid, uid: verificado.uid || verificado.sub });
        req.authKind = 'session';
        return next();
      } catch (e) {
        const status = (e && e.httpStatus) || 401;
        const corpo = (e && typeof e.toPublic === 'function') ? e.toPublic() : { error: 'Token inválido ou expirado.' };
        return res.status(status).json(corpo);
      }
    }

    // ── LEGACY ─────────────────────────────────────────────────────────────
    if (kind === 'legacy') {
      if (!cfg.allowLegacy || legadoAlemDoCutoff(cfg)) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' }); // modo estrito / pós-cutoff
      }
      try {
        req.user = verificarLegacy(token, cfg);
        req.authKind = 'legacy';
        return next();
      } catch {
        // Mantém o 403 do comportamento legado atual (o cliente trata como sessão expirada).
        return res.status(403).json({ error: 'Token inválido ou expirado.' });
      }
    }

    // ── INVALID ────────────────────────────────────────────────────────────
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  };
}

module.exports = { criarVerifyTokenSec1, classificarPorClaims };

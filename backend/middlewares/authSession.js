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
const { SessionDependencyUnavailable, SessionInvalid } = require('../services/auth/authErrors');

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

function getSupabase(injected) {
  if (injected !== undefined) return injected;
  if (process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_URL) {
    try {
      return require('../config/supabase');
    } catch {
      return null;
    }
  }
  return null;
}

function rotaIsentaSenhaTemporaria(req) {
  const method = req.method ? req.method.toUpperCase() : '';
  const rawPath = (req.originalUrl || req.url || req.path || '').split('?')[0].replace(/\/+$/, '');
  const urlPath = rawPath || '/';

  // Isenções mínimas explícitas para permitir resolução da condição de troca de senha:
  // 1. GET /auth/me
  if (method === 'GET' && (urlPath === '/auth/me' || urlPath === '/me')) return true;
  // 2. POST /auth/trocar-senha
  if (method === 'POST' && (urlPath === '/auth/trocar-senha' || urlPath === '/trocar-senha')) return true;
  // 3. POST /auth/logout
  if (method === 'POST' && (urlPath === '/auth/logout' || urlPath === '/logout')) return true;
  // 4. POST /auth/logout-all
  if (method === 'POST' && (urlPath === '/auth/logout-all' || urlPath === '/logout-all')) return true;
  // 5. GET /auth/sessions
  if (method === 'GET' && (urlPath === '/auth/sessions' || urlPath === '/sessions')) return true;
  // 6. DELETE /auth/sessions/:id
  if (method === 'DELETE' && (/^\/auth\/sessions\/[^/]+$/.test(urlPath) || /^\/sessions\/[^/]+$/.test(urlPath))) return true;
  // 7. Termos necessários para sequência de onboarding
  if (method === 'GET' && (urlPath === '/termos/pendentes' || urlPath === '/pendentes')) return true;
  if (method === 'POST' && (/^\/termos\/[^/]+\/aceitar$/.test(urlPath) || /^\/[^/]+\/aceitar$/.test(urlPath))) return true;

  return false;
}

function aplicarGateSenhaTemporaria(req, res, next) {
  if (req.user && req.user.senha_temporaria === true && !rotaIsentaSenhaTemporaria(req)) {
    return res.status(403).json({
      error: 'PasswordChangeRequired',
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Troca de senha obrigatória pendente.',
    });
  }
  return next();
}

/**
 * Factory do middleware. deps: { cfg (authConfig), sessionService }.
 * Retorna um middleware Express assíncrono que popula req.user (fonte confiável) e
 * req.authKind ('legacy'|'session').
 */
function criarVerifyTokenSec1({ cfg, sessionService, supabase: supabaseParam }) {
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
        return aplicarGateSenhaTemporaria(req, res, next);
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
      } catch {
        // Mantém o 403 do comportamento legado atual (o cliente trata como sessão expirada).
        return res.status(403).json({ error: 'Token inválido ou expirado.' });
      }

      // R1A/C1: Para tokens legados no modo compatível, a autoridade de
      // usuarios.senha_temporaria DEVE ser resolvida fail-closed do banco de dados
      // antes de autorizar qualquer acesso comum de negócio.
      const uid = req.user && (req.user.uid || req.user.id || req.user.sub);
      if (!uid || typeof uid !== 'string' || uid.trim() === '') {
        const err = new SessionInvalid('uid ausente ou incoerente no token legado');
        return res.status(err.httpStatus).json(err.toPublic());
      }

      const client = getSupabase(supabaseParam);
      if (!client) {
        const err = new SessionDependencyUnavailable('cliente de autoridade indisponível para validação de legado');
        return res.status(err.httpStatus).json(err.toPublic());
      }

      let uDb;
      let dbError;
      try {
        const resposta = await client
          .from('usuarios')
          .select('senha_temporaria')
          .eq('id', uid)
          .maybeSingle();
        uDb = resposta && resposta.data;
        dbError = resposta && resposta.error;
      } catch (errQuery) {
        const err = new SessionDependencyUnavailable(errQuery && errQuery.message);
        return res.status(err.httpStatus).json(err.toPublic());
      }

      if (dbError) {
        const err = new SessionDependencyUnavailable(dbError.message || 'erro na consulta de autoridade');
        return res.status(err.httpStatus).json(err.toPublic());
      }

      if (!uDb) {
        const err = new SessionInvalid('usuario não encontrado na base de dados');
        return res.status(err.httpStatus).json(err.toPublic());
      }

      req.user.senha_temporaria = uDb.senha_temporaria === true;
      return aplicarGateSenhaTemporaria(req, res, next);
    }

    // ── INVALID ────────────────────────────────────────────────────────────
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  };
}

module.exports = { criarVerifyTokenSec1, classificarPorClaims, rotaIsentaSenhaTemporaria, aplicarGateSenhaTemporaria };

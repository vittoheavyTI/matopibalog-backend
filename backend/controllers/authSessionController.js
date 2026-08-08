// backend/controllers/authSessionController.js — endpoints de sessão (SEC-1).
//
// Contratos SEPARADOS web × mobile:
//   WEB    → refresh transportado por COOKIE HttpOnly (nunca no JSON). Access no body.
//   MOBILE → refresh no BODY (o app guarda em secure storage). Rejeita origem web.
// Mapeamento HTTP via erros de domínio (e.httpStatus). Nunca vaza token/hash/secret.
//
// Independe de estado global: recebe { sessionService, cfg } por injeção (factory).
// O bloqueio de Origin no endpoint móvel REDUZ exposição acidental ao JS do
// navegador — NÃO é o mecanismo de autenticação (que é a sessão/credencial).

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TOKEN_RE = /^r1\.[A-Za-z0-9_-]{32,256}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

function respErro(res, e) {
  noStore(res);
  if (e && typeof e.httpStatus === 'number' && typeof e.toPublic === 'function') {
    return res.status(e.httpStatus).json(e.toPublic());
  }
  // Erro inesperado: 500 sanitizado (sem SQL/stack/segredo).
  return res.status(500).json({ error: 'InternalError', message: 'Erro interno.' });
}

function origensWeb(cfg) {
  return new Set(cfg.webOrigins || []);
}
function ehOrigemWeb(req, cfg) {
  const o = req.headers && req.headers.origin;
  return !!o && origensWeb(cfg).has(o);
}
function origemPermitidaWeb(req, cfg) {
  const permitidas = origensWeb(cfg);
  const origin = req.headers && req.headers.origin;
  if (origin) return permitidas.has(origin);
  const referer = req.headers && req.headers.referer;
  if (!referer) return false;
  try { return permitidas.has(new URL(referer).origin); } catch { return false; }
}

function refreshValido(token) {
  return typeof token === 'string' && token.length <= 300 && REFRESH_TOKEN_RE.test(token);
}

function criarAuthSessionController({ sessionService, cfg }) {
  if (!sessionService) throw new Error('sessionService obrigatório');
  if (!cfg) throw new Error('cfg obrigatório');

  function setRefreshCookie(res, delivery) {
    res.cookie(REFRESH_COOKIE, delivery.reveal(), {
      httpOnly: true, secure: true, sameSite: cfg.refreshCookieSameSite || 'none', path: '/auth',
      expires: new Date(delivery.expiresAt),
    });
  }
  function clearRefreshCookie(res) {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: true, sameSite: cfg.refreshCookieSameSite || 'none', path: '/auth' });
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none' });
  }

  // POST /auth/refresh (WEB): refresh via cookie; responde SÓ o access (sem refresh no body).
  async function refreshWeb(req, res) {
    noStore(res);
    if (!origemPermitidaWeb(req, cfg)) {
      return res.status(403).json({ error: 'CsrfRejected', message: 'Origem não autorizada.' });
    }
    const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
    if (!refreshValido(refreshToken)) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'RefreshInvalid', message: 'Sessão ausente. Faça login novamente.' });
    }
    if (!refreshToken) return res.status(401).json({ error: 'RefreshInvalid', message: 'Sessão ausente. Faça login novamente.' });
    try {
      const { accessToken, refreshDelivery } = await sessionService.rotacionarRefresh({ refreshToken, request_id: req.requestId || null, origin: req.headers && req.headers.origin });
      setRefreshCookie(res, refreshDelivery);   // novo refresh só no cookie
      return res.status(200).json({ token: accessToken }); // NUNCA refresh no JSON web
    } catch (e) {
      if (e && (e.code === 'RefreshReuseDetected' || e.code === 'RefreshInvalid' || e.code === 'RefreshExpired' || e.code === 'RefreshRevoked' || e.code === 'SessionInvalid')) clearRefreshCookie(res);
      return respErro(res, e);
    }
  }

  // POST /auth/mobile/refresh (APP): refresh no body; rejeita origem web (reduz exposição).
  async function refreshMobile(req, res) {
    noStore(res);
    if (ehOrigemWeb(req, cfg)) return res.status(400).json({ error: 'ContratoInvalido', message: 'Endpoint móvel não aceita origem de navegador.' });
    const refreshToken = req.body && req.body.refresh_token;
    if (!refreshValido(refreshToken)) return res.status(400).json({ error: 'PayloadInvalido', message: 'refresh_token ausente ou inválido.' });
    try {
      const { accessToken, refreshDelivery } = await sessionService.rotacionarRefresh({ refreshToken, request_id: req.requestId || null, origin: req.headers && req.headers.origin });
      return res.status(200).json({ token: accessToken, refresh_token: refreshDelivery.reveal(), expires_at: refreshDelivery.expiresAt });
    } catch (e) { return respErro(res, e); }
  }

  // POST /auth/logout — revoga a sessão atual (se houver sid) e limpa cookie. Idempotente.
  async function logout(req, res) {
    noStore(res);
    try {
      if (req.user && req.user.sid) await sessionService.revogarSessao(req.user.sid, 'logout');
    } catch (e) {
      clearRefreshCookie(res);
      return respErro(res, e);
    }
    clearRefreshCookie(res);
    return res.status(200).json({ message: 'Logout realizado com sucesso' });
  }

  // POST /auth/logout-all — revoga TODAS as sessões do próprio usuário.
  async function logoutAll(req, res) {
    noStore(res);
    if (!req.user || !req.user.uid) return res.status(401).json({ message: 'Não autenticado.' });
    try {
      await sessionService.revogarTodasDoUsuario(req.user.uid, 'logout_global');
      clearRefreshCookie(res);
      return res.status(200).json({ message: 'Todas as sessões foram encerradas.' });
    } catch (e) { return respErro(res, e); }
  }

  // GET /auth/sessions — lista as próprias sessões (sanitizado).
  async function listSessions(req, res) {
    noStore(res);
    if (!req.user || !req.user.uid) return res.status(401).json({ message: 'Não autenticado.' });
    try {
      const sessoes = await sessionService.listarSessoesDoUsuario(req.user.uid);
      return res.status(200).json({ sessoes });
    } catch (e) { return respErro(res, e); }
  }

  // DELETE /auth/sessions/:id — revoga UMA sessão do PRÓPRIO usuário (nunca alheia).
  async function revokeSession(req, res) {
    noStore(res);
    if (!req.user || !req.user.uid) return res.status(401).json({ message: 'Não autenticado.' });
    const sid = req.params && req.params.id;
    if (!sid || !UUID_RE.test(sid)) return res.status(400).json({ message: 'id da sessão inválido.' });
    try {
      const r = await sessionService.revogarUmaDoUsuario(req.user.uid, sid, 'revogacao_usuario');
      if (r && r.motivo === 'not_found') return res.status(404).json({ message: 'Sessão não encontrada.' });
      return res.status(200).json({ message: 'Sessão encerrada.' }); // idempotente
    } catch (e) { return respErro(res, e); }
  }

  return { refreshWeb, refreshMobile, logout, logoutAll, listSessions, revokeSession, REFRESH_COOKIE };
}

module.exports = { criarAuthSessionController, REFRESH_COOKIE };

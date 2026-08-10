// backend/middlewares/trackingCredential.js — guard das rotas de TELEMETRIA (SEC-1).
//
// OBJETIVO (§9): permitir que as rotas mínimas de telemetria aceitem EITHER
//   (a) uma sessão SEC-1 normal (fluxo atual, inalterado), OU
//   (b) a credencial de rastreamento escopada (quando a flag está ON),
// SEM tornar a credencial válida globalmente e SEM tocar verifyToken.
//
// A credencial vem no header dedicado `X-Tracking-Credential` (NUNCA em Authorization,
// para não interagir com verifyToken). Se ausente / flag OFF → cai no fluxo de sessão,
// IDÊNTICO ao atual (verifyToken → verificarEmpresa → verificarPlano).
//
// No ramo de tracking, após estabelecer a identidade pela credencial, aplicamos o
// MESMO verificarPlano do ramo de sessão — para NÃO ampliar privilégio.

const { getTrackingRuntime } = require('../services/auth/trackingCredentialRuntime');
const { verifyToken } = require('./auth');
const { verificarEmpresa } = require('./tenant');
const { verificarPlano } = require('./verificarPlano');

const HEADER = 'x-tracking-credential';
const HEADER_DEVICE = 'x-tracking-device';

function lerTrackingToken(req) {
  const h = req.headers && req.headers[HEADER];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return null;
}

function lerDeviceId(req) {
  const h = req.headers && req.headers[HEADER_DEVICE];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 128);
  return null;
}

// Log seguro: categoria/resultado/motivo — NUNCA token/hash/Authorization.
function logTracking(resultado, motivo) {
  try {
    console.error('[trackingCredential] telemetria', { resultado, motivo: String(motivo || '').slice(0, 80) });
  } catch { /* noop */ }
}

function responderErroTracking(res, e) {
  const status = (e && e.httpStatus) || 401;
  const corpo = (e && typeof e.toPublic === 'function') ? e.toPublic() : { error: 'credential_invalid', message: 'Credencial inválida.' };
  logTracking(corpo.error || 'erro', e && e.code);
  return res.status(status).json(corpo);
}

/**
 * Factory do guard. `deps` (todas com default de produção; injetáveis em teste):
 *   getRuntime()   → { cfg, trackingService }
 *   verifyToken/verificarEmpresa/verificarPlano → cadeia de sessão
 * Retorna um middleware Express.
 */
function criarGuardTelemetria(deps = {}) {
  const getRuntime = deps.getRuntime || getTrackingRuntime;
  const _verifyToken = deps.verifyToken || verifyToken;
  const _verificarEmpresa = deps.verificarEmpresa || verificarEmpresa;
  const _verificarPlano = deps.verificarPlano || verificarPlano;

  return function guardTelemetria(req, res, next) {
    const { cfg, trackingService } = getRuntime();
    const token = lerTrackingToken(req);

    // Ramo TRACKING: só quando a flag está ON, há serviço e o header veio.
    if (token && cfg && cfg.trackingScopedCredentialEnabled && trackingService) {
      const deviceId = lerDeviceId(req);
      trackingService.validar({ token, deviceId })
        .then((identidade) => {
          req.user = { uid: identidade.uid, role: identidade.role, is_super_admin: false };
          req.empresa_id = identidade.empresa_id;
          req.authKind = 'tracking';
          req.trackingCredentialId = identidade.credential_id;
          // MULTI-VIAGEM: a telemetria cobre TODAS as viagens ativas do motorista
          // (mesmo modelo da sessão). O escopo é motorista+empresa (não uma viagem).
          // MESMO gate comercial da sessão — não amplia privilégio.
          return _verificarPlano(req, res, next);
        })
        .catch((e) => responderErroTracking(res, e));
      return;
    }

    // Ramo SESSÃO: idêntico ao fluxo atual. Se um X-Tracking-Credential vier com a flag
    // OFF, é ignorado aqui e a ausência de Authorization simplesmente falha no verifyToken.
    return _verifyToken(req, res, () => _verificarEmpresa(req, res, () => _verificarPlano(req, res, next)));
  };
}

/** Mini-guard para rotas TRACKING-ONLY (ex.: renovar credencial). Exige authKind tracking. */
function exigirTracking(req, res, next) {
  if (req.authKind === 'tracking') return next();
  return res.status(403).json({ error: 'tracking_only', message: 'Endpoint exclusivo da credencial de rastreamento.' });
}

module.exports = { criarGuardTelemetria, exigirTracking, lerTrackingToken, lerDeviceId, HEADER, HEADER_DEVICE };

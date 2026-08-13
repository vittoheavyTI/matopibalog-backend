// backend/controllers/trackingCredentialController.js — emissão e renovação da
// credencial operacional de rastreamento (SEC-1 / Opção C).
//
//   POST /fretes/localizacao/credencial                  → emitir  (AUTH: sessão SEC-1 c/ sid)
//   POST /fretes/localizacao/sessao/renovar-credencial   → renovar (AUTH: a própria credencial)
//
// EMISSÃO: só motorista autenticado por SESSÃO SEC-1 REAL (sid obrigatório — M-3), com
// device (M-1) e viagem apta. Flag OFF (sem serviço) → 404 tracking_disabled (o app cai
// no fluxo compatível SÓ nesse caso). RENOVAÇÃO: tracking-only, ROTACIONA o segredo.

const { getTrackingRuntime } = require('../services/auth/trackingCredentialRuntime');
const { lerTrackingToken, lerDeviceId } = require('../middlewares/trackingCredential');
// Observabilidade DIAGNÓSTICA da emissão (credential storm hardening). Módulo PURO: o app envia
// o motivo da tentativa no header X-Tracking-Reason; é usado APENAS para log de correlação —
// NUNCA para autorização, escopo ou decisão de segurança, e NÃO é persistido.
const { montarLogEmissao } = require('../services/auth/trackingEmissaoDiag');

function respErro(res, error, statusPadrao, codePadrao) {
  const status = error?.httpStatus || statusPadrao;
  const corpo = (error && typeof error.toPublic === 'function')
    ? error.toPublic()
    : { error: codePadrao, message: 'Erro no rastreamento.' };
  return res.status(status).json(corpo);
}

// POST /fretes/localizacao/credencial
exports.emitir = async (req, res) => {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService) {
      return res.status(404).json({ error: 'tracking_disabled', message: 'Rastreamento escopado indisponível.' });
    }
    if (req.user?.role !== 'motorista' || !req.user?.uid) {
      return res.status(403).json({ error: 'tracking_tenant_mismatch', message: 'Apenas o motorista autenticado pode emitir a credencial.' });
    }
    if (!req.empresa_id) {
      return res.status(409).json({ error: 'tracking_tenant_mismatch', message: 'Motorista sem empresa vinculada.' });
    }
    // M-3: emissão SOMENTE a partir de sessão SEC-1 real (sid). Token legado sem sid é recusado.
    if (!req.user?.sid) {
      return res.status(403).json({ error: 'tracking_session_revoked', message: 'Rastreamento escopado exige sessão autenticada (faça login novamente).' });
    }
    // M-1: device obrigatório para o binding.
    const deviceId = lerDeviceId(req);
    if (!deviceId) {
      return res.status(400).json({ error: 'tracking_device_mismatch', message: 'Identificação do dispositivo ausente.' });
    }

    // O serviço resolve, server-side, o SNAPSHOT das viagens ativas (escopo imutável) e
    // grava o vínculo. Sem viagem ativa → tracking_trip_inactive (409).
    const { delivery, expiresAt, maxExpiresAt, fretes_escopo } = await trackingService.emitir({
      empresa_id: req.empresa_id,
      motorista_id: req.user.uid,
      session_id: req.user.sid,
      device_id: deviceId,
    });

    // Log de correlação SANITIZADO no Railway: permite ligar cada 201 a reason + sessão + device
    // + scope_count SÓ pelos logs server-side (sem ADB). NUNCA loga credential/token/hash da
    // credential — o token aberto sai apenas no corpo da resposta abaixo.
    console.log('[trackingCredential:emitir] 201', montarLogEmissao({
      req,
      sid: req.user.sid,
      deviceId,
      scopeCount: fretes_escopo.length,
    }));

    // O token aberto é entregue UMA vez, só no corpo desta resposta (nunca logado).
    return res.status(201).json({
      credential: delivery.reveal(),
      expires_at: expiresAt,
      max_expires_at: maxExpiresAt,
      fretes_escopo: fretes_escopo.length,
    });
  } catch (error) {
    console.error('[trackingCredential:emitir] falha', { user: req.user?.uid, code: error?.code || 'erro' });
    return respErro(res, error, 500, 'tracking_unavailable');
  }
};

// POST /fretes/localizacao/sessao/renovar-credencial  (guard já exigiu authKind tracking)
exports.renovar = async (req, res) => {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService) {
      return res.status(404).json({ error: 'tracking_disabled', message: 'Rastreamento escopado indisponível.' });
    }
    const token = lerTrackingToken(req);
    if (!token) {
      return res.status(401).json({ error: 'tracking_credential_invalid', message: 'Credencial de rastreamento ausente.' });
    }
    const deviceId = lerDeviceId(req);
    // Rotaciona: retorna o NOVO token (o antigo deixa de valer).
    const { delivery, expiresAt, maxExpiresAt } = await trackingService.renovar({ token, deviceId });
    return res.status(200).json({
      ok: true,
      credential: delivery.reveal(),
      expires_at: expiresAt,
      max_expires_at: maxExpiresAt,
    });
  } catch (error) {
    console.error('[trackingCredential:renovar] falha', { code: error?.code || 'erro' });
    return respErro(res, error, 401, 'tracking_credential_invalid');
  }
};

// backend/controllers/trackingCredentialController.js — emissão e renovação da
// credencial operacional de rastreamento (SEC-1 / Opção C).
//
//   POST /fretes/localizacao/credencial            → emitir  (AUTH: sessão SEC-1, motorista)
//   POST /fretes/localizacao/sessao/renovar-credencial → renovar (AUTH: a própria credencial)
//
// EMISSÃO: só para motorista autenticado COM viagem apta. Quando a flag está OFF (sem
// serviço), responde 404 tracking_disabled — o app cai no fluxo compatível (access token).
// RENOVAÇÃO: tracking-only (o guard já validou a credencial e setou req.authKind).

const { getTrackingRuntime } = require('../services/auth/trackingCredentialRuntime');
const { lerTrackingToken } = require('../middlewares/trackingCredential');
const { listarFretesAtivosDoMotorista } = require('./freteLocalizacaoController');

// Header opcional de device (correlação/observabilidade; nunca segredo).
function lerDeviceId(req) {
  const d = req.headers && (req.headers['x-device-id'] || req.headers['X-Device-Id']);
  if (typeof d === 'string' && d.trim()) return d.trim().slice(0, 128);
  return null;
}

// POST /fretes/localizacao/credencial
exports.emitir = async (req, res) => {
  try {
    const { trackingService } = getTrackingRuntime();
    if (!trackingService) {
      // Flag OFF: recurso indisponível → app usa o fluxo atual (Bearer access token).
      return res.status(404).json({ error: 'tracking_disabled', message: 'Rastreamento escopado indisponível.' });
    }
    if (req.user?.role !== 'motorista' || !req.user?.uid) {
      return res.status(403).json({ error: 'tracking_scope_forbidden', message: 'Apenas o motorista autenticado pode emitir a credencial de rastreamento.' });
    }
    if (!req.empresa_id) {
      return res.status(409).json({ error: 'sem_empresa', message: 'Motorista sem empresa vinculada.' });
    }

    const fretes = await listarFretesAtivosDoMotorista(req.empresa_id, req.user.uid);
    if (!fretes.length) {
      return res.status(409).json({ error: 'sem_viagem_apta', message: 'Não há viagem em andamento para iniciar o rastreamento.' });
    }

    const { delivery, expiresAt } = await trackingService.emitir({
      empresa_id: req.empresa_id,
      motorista_id: req.user.uid,
      session_id: req.user.sid || null,
      frete_id: fretes[0].id,
      device_id: lerDeviceId(req),
    });

    // O token aberto é entregue UMA vez, só no corpo desta resposta (nunca logado).
    return res.status(201).json({
      credential: delivery.reveal(),
      expires_at: expiresAt,
      fretes_ativos: fretes.length,
    });
  } catch (error) {
    const status = error?.httpStatus || 500;
    const corpo = (error && typeof error.toPublic === 'function')
      ? error.toPublic()
      : { error: 'erro_emissao', message: 'Erro ao emitir credencial de rastreamento.' };
    console.error('[trackingCredential:emitir] falha', { user: req.user?.uid, code: error?.code || 'erro' });
    return res.status(status).json(corpo);
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
      return res.status(401).json({ error: 'credential_invalid', message: 'Credencial de rastreamento ausente.' });
    }
    const { expiresAt } = await trackingService.renovar({ token });
    return res.status(200).json({ ok: true, expires_at: expiresAt });
  } catch (error) {
    const status = error?.httpStatus || 401;
    const corpo = (error && typeof error.toPublic === 'function')
      ? error.toPublic()
      : { error: 'credential_invalid', message: 'Não foi possível renovar a credencial.' };
    console.error('[trackingCredential:renovar] falha', { code: error?.code || 'erro' });
    return res.status(status).json(corpo);
  }
};

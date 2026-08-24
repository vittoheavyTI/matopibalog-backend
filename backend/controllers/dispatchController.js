'use strict';

// Endpoints do MOTORISTA para o Dispatch V1 (§49). Identidade sempre do token
// (req.user.uid) -- nunca de driver_id no corpo/query. Ownership da oferta é revalidada
// dentro das RPCs (offer.driver_id === p_driver_id), então mesmo um driver_id forjado no
// nível da aplicação não teria efeito além de um 403 determinístico.

const supabase = require('../config/supabase');
const dispatchService = require('../services/campaign/dispatchService');
const { buildCorrelationContext } = require('../services/verifiability/correlationContext');

function responderErro(res, error) {
  if (error && typeof error.status === 'number' && error.code) {
    return res.status(error.status).json({ message: error.message, code: error.code, details: error.details || undefined });
  }
  console.error('[dispatchController] erro:', error?.message || error);
  return res.status(500).json({ message: 'Erro ao processar despacho.' });
}

function correlation(req) {
  return req.correlation || buildCorrelationContext({ headers: req.headers });
}

function driverId(req) {
  return req.user?.uid || req.user?.id || null;
}

// GET /dispatch/my-offers?status=PENDING
const minhasOfertas = async (req, res) => {
  try {
    const itens = await dispatchService.listMyOffers(supabase, {
      empresaId: req.empresa_id,
      driverId: driverId(req),
      status: req.query?.status || null,
    });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /dispatch/offers/:offerId/accept
const aceitarOferta = async (req, res) => {
  try {
    const item = await dispatchService.acceptOffer(supabase, {
      empresaId: req.empresa_id,
      offerId: req.params.offerId,
      driverId: driverId(req),
      user: req.user,
      operationalScope: req.operationalScope,
      correlation: correlation(req),
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

// POST /dispatch/offers/:offerId/decline
const recusarOferta = async (req, res) => {
  try {
    const item = await dispatchService.declineOffer(supabase, {
      empresaId: req.empresa_id,
      offerId: req.params.offerId,
      driverId: driverId(req),
      reason: req.body?.reason || null,
      correlation: correlation(req),
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

module.exports = { minhasOfertas, aceitarOferta, recusarOferta };

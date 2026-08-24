'use strict';

// Route Intelligence V1 — estimativa de rota read-only, provider-agnostic.
//   GET  /route-intelligence/capabilities — estado seguro (mode/provider_available)
//   POST /route-intelligence/estimate     — cálculo read-only (sem persistência)
//
// Autenticado + tenant. Sem escrita de negócio. Sem provider real em produção.

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { resolverEscopoOperacional, canAccessUnit } = require('../services/operationalScopeService');

const { resolveMode, providerAvailable, LIMITS } = require('../services/routeIntelligence/config');
const { estimateRoute } = require('../services/routeIntelligence/routeEstimateService');

router.use(verifyToken, verificarEmpresa);

// GET /route-intelligence/capabilities — nunca expõe URL/secret do provider.
router.get('/capabilities', requirePermission('freight.view'), (req, res) => {
  const mode = resolveMode();
  return res.json({
    enabled: true, // manual sempre disponível
    provider_mode: mode,
    provider_available: providerAvailable(mode),
    manual_supported: true,
    supports: { distance: true, duration: true, tolls: 'provider_or_manual', fuel: 'input_dependent', truck_restrictions: 'unavailable_v1' },
    read_only: true,
  });
});

const estimateSchema = z.object({
  frete_id: z.string().uuid().optional().nullable(),
  origin: z.string().max(LIMITS.MAX_TEXT).optional(),
  destination: z.string().max(LIMITS.MAX_TEXT).optional(),
  manual: z.object({
    distance_km: z.number().positive().max(LIMITS.MAX_DISTANCE_KM).optional(),
    duration_minutes: z.number().positive().max(1000000).optional(),
    tolls_amount: z.number().min(0).max(1000000).optional(),
  }).strict().optional(),
  params: z.object({
    consumption_km_per_liter: z.number().positive().max(LIMITS.MAX_CONSUMPTION).optional(),
    fuel_price_per_liter: z.number().positive().max(LIMITS.MAX_FUEL_PRICE).optional(),
    other_known_cost: z.number().min(0).max(100000000).optional(),
  }).strict().optional(),
}).strict();

// POST /route-intelligence/estimate
router.post('/estimate', requirePermission('freight.view'), async (req, res) => {
  const parsed = estimateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const primeiro = parsed.error?.issues?.[0];
    return res.status(400).json({ message: primeiro?.message || 'Requisição inválida.' });
  }
  const input = { ...parsed.data };

  // Contexto de frete (§81): servidor deriva origem/destino do frete autorizado
  // (tenant + escopo). Nunca confia em frete de outro tenant (sem IDOR).
  if (input.frete_id) {
    try {
      const { data: frete } = await supabase
        .from('fretes')
        .select('id, empresa_id, origem, destino, unidade_operacional_id')
        .eq('id', input.frete_id)
        .eq('empresa_id', req.empresa_id)
        .maybeSingle();
      if (!frete) return res.status(404).json({ message: 'Frete não encontrado.' });
      if (!req.user?.is_super_admin) {
        const scope = await resolverEscopoOperacional(req, { empresaId: req.empresa_id });
        if (!canAccessUnit(scope, frete.unidade_operacional_id || null)) {
          return res.status(403).json({ message: 'Frete fora do seu escopo operacional.' });
        }
      }
      input.origin = input.origin || frete.origem;
      input.destination = input.destination || frete.destino;
    } catch (err) {
      console.error('[route-intelligence] frete context falhou', { correlation_id: req.correlation?.correlation_id, status: 500 });
      return res.status(500).json({ message: 'Não foi possível carregar o frete.' });
    }
  }

  try {
    const result = await estimateRoute(input);
    if (!result.ok) return res.status(400).json({ message: result.message || 'Não foi possível estimar a rota.' });
    return res.json(result);
  } catch (err) {
    console.error('[route-intelligence] estimate falhou', { correlation_id: req.correlation?.correlation_id, status: 500 });
    return res.status(500).json({ message: 'Não foi possível estimar a rota agora.' });
  }
});

module.exports = router;

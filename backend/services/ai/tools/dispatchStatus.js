'use strict';

// Tool: operation.dispatch.status — status read-only do Dispatch V1 de uma campanha.
// REUSA campaignProgressService (readiness/trips_detail, mesma autoridade do endpoint
// web) + dispatchService.getCampaignDispatchSummary (contagem de rodadas). NUNCA acessa
// o banco direto para regra de negócio; só resolve qual campanha pelo serviço canônico
// com tenant/escopo do servidor. READ-ONLY: não designa, não oferta, não aceita, não
// cancela. Sem PII (nenhum driver_id/nome exposto), sem valores financeiros.

const { getCampaignProgress } = require('../../campaign/campaignProgressService');
const { getCampaignDispatchSummary } = require('../../campaign/dispatchService');
const { listCampaigns } = require('../../campaign/campaignService');

const MAX_LIST = 15;

module.exports = {
  name: 'operation.dispatch.status',
  description: 'Status read-only do despacho (Dispatch V1) de uma campanha de escoamento: quantas viagens ainda precisam de designação, quantas rodadas de oferta estão abertas/atribuídas/expiradas/canceladas, e quantas foram designadas diretamente. Sem código/id, lista as campanhas para escolher. Somente leitura; não designa, não oferta, não aceita e não cancela nada.',
  requiredPermission: 'campaign.view',
  requiredEntitlement: 'operation_campaign',
  inputSchema: {
    type: 'object',
    properties: {
      campaign_id: { type: 'string' },
      campaign_reference_code: { type: 'string' },
    },
    additionalProperties: false,
  },
  async handler(ctx, args = {}) {
    const scope = ctx.operationalScope || null;
    let campaigns;
    try {
      campaigns = await listCampaigns(ctx.supabase, { empresaId: ctx.empresaId, operationalScope: scope });
    } catch {
      return { ok: false, data: null, evidence: [], warnings: ['Não foi possível consultar as campanhas.'], truncated: false };
    }

    const wantedId = String(args.campaign_id || '').trim();
    const wantedRef = String(args.campaign_reference_code || '').trim().toLowerCase();

    let target = null;
    if (wantedId) target = campaigns.find((c) => c.id === wantedId) || null;
    else if (wantedRef) target = campaigns.find((c) => String(c.reference_code || '').toLowerCase() === wantedRef) || null;

    if (!target) {
      const lista = campaigns.slice(0, MAX_LIST).map((c) => ({
        id: c.id, reference_code: c.reference_code, name: c.name, status: c.status,
      }));
      return {
        ok: true,
        data: { needs_selection: (wantedId || wantedRef) ? false : true, campaigns: lista, total: campaigns.length },
        evidence: [{ tool: 'operation.dispatch.status', entity_type: 'campaign_list', label: `${campaigns.length} campanha(s)`, snapshot_at: new Date().toISOString() }],
        warnings: (wantedId || wantedRef) ? ['Campanha não encontrada no seu escopo.'] : [],
        truncated: campaigns.length > MAX_LIST,
      };
    }

    let progress;
    let dispatchSummary;
    try {
      progress = await getCampaignProgress(ctx.supabase, { empresaId: ctx.empresaId, campaignId: target.id, operationalScope: scope });
      dispatchSummary = await getCampaignDispatchSummary(ctx.supabase, { empresaId: ctx.empresaId, campaignId: target.id });
    } catch {
      return { ok: false, data: null, evidence: [], warnings: ['Não foi possível projetar o status de despacho da campanha.'], truncated: false };
    }

    const trips = progress.trips_detail || [];
    const readinessCounts = { ready_direct: 0, ready_offer: 0, blocked: 0, already_assigned: 0, executing: 0, completed: 0 };
    for (const t of trips) {
      if (t.readiness === 'READY_FOR_DIRECT_ASSIGNMENT') readinessCounts.ready_direct += 1;
      else if (t.readiness === 'READY_FOR_OFFER_DISPATCH') readinessCounts.ready_offer += 1;
      else if (t.readiness === 'BLOCKED') readinessCounts.blocked += 1;
      else if (t.readiness === 'ALREADY_ASSIGNED') readinessCounts.already_assigned += 1;
      else if (t.readiness === 'ALREADY_EXECUTING') readinessCounts.already_assigned += 1;
      else if (t.readiness === 'COMPLETED') readinessCounts.completed += 1;
    }

    return {
      ok: true,
      data: {
        campaign: { id: progress.campaign.id, reference_code: progress.campaign.reference_code, name: progress.campaign.name, status: progress.campaign.status },
        readiness: readinessCounts,
        dispatch_rounds: dispatchSummary,
        real_dispatch_implemented: false,
      },
      evidence: [{
        tool: 'operation.dispatch.status',
        entity_type: 'campaign',
        label: `${progress.campaign.reference_code}: ${readinessCounts.ready_direct + readinessCounts.ready_offer} viagem(ns) prontas para designação, ${dispatchSummary.open} rodada(s) de oferta aberta(s)`,
        snapshot_at: new Date().toISOString(),
      }],
      warnings: [],
      truncated: false,
    };
  },
};

'use strict';

// Tool: operation.campaign.progress — progresso operacional read-only da Campaign.
// REUSA campaignProgressService (mesma autoridade/derivação do endpoint web e da
// Torre de Controle, §12/§96 — nunca acessa o banco direto para regra de negócio;
// só resolve qual campanha pelo serviço canônico com tenant/escopo do servidor).
// READ-ONLY. Sem PII, sem URL assinada, sem valores financeiros, sem ação de
// negócio (não materializa, não designa, não despacha).

const { getCampaignProgress } = require('../../campaign/campaignProgressService');
const { listCampaigns } = require('../../campaign/campaignService');

const MAX_LIST = 15;

module.exports = {
  name: 'operation.campaign.progress',
  description: 'Progresso operacional de uma campanha de escoamento: viagens planejadas/materializadas/em execução/concluídas/canceladas/restantes, quantidade (t), saúde (no prazo/atenção/crítico/concluída), exceções, necessidade de replanejamento e prontidão para designação. Sem código/id, lista as campanhas para escolher. Somente leitura; não materializa nem despacha.',
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

    // Sem alvo resolvido: devolve a lista (curta) para o modelo escolher.
    if (!target) {
      const lista = campaigns.slice(0, MAX_LIST).map((c) => ({
        id: c.id,
        reference_code: c.reference_code,
        name: c.name,
        status: c.status,
      }));
      return {
        ok: true,
        data: { needs_selection: (wantedId || wantedRef) ? false : true, campaigns: lista, total: campaigns.length },
        evidence: [{ tool: 'operation.campaign.progress', entity_type: 'campaign_list', label: `${campaigns.length} campanha(s)`, snapshot_at: new Date().toISOString() }],
        warnings: (wantedId || wantedRef) ? ['Campanha não encontrada no seu escopo.'] : [],
        truncated: campaigns.length > MAX_LIST,
      };
    }

    let progress;
    try {
      progress = await getCampaignProgress(ctx.supabase, { empresaId: ctx.empresaId, campaignId: target.id, operationalScope: scope });
    } catch {
      return { ok: false, data: null, evidence: [], warnings: ['Não foi possível projetar o progresso da campanha.'], truncated: false };
    }

    // Projeção segura: contagens, quantidade, saúde, replan, readiness. Sem PII.
    return {
      ok: true,
      data: {
        campaign: {
          id: progress.campaign.id,
          reference_code: progress.campaign.reference_code,
          name: progress.campaign.name,
          status: progress.campaign.status,
        },
        approved_plan: progress.approved_plan ? { version_number: progress.approved_plan.version_number } : null,
        trips: progress.progress.trips,
        quantity: {
          unit: progress.progress.quantity.unit,
          target: progress.progress.quantity.target,
          completed: progress.progress.quantity.completed,
          cancelled: progress.progress.quantity.cancelled,
          remaining: progress.progress.quantity.remaining,
          quantity_source: progress.progress.quantity.coverage.quantity_source,
        },
        health: { state: progress.health.state, reason_code: progress.health.reason_code, reason_text: progress.health.reason_text },
        replan: { status: progress.replan.status, reason_code: progress.replan.reason_code, remaining_quantity: progress.replan.remaining_quantity },
        readiness: progress.readiness,
        exceptions_count: progress.exceptions.length,
      },
      evidence: [{
        tool: 'operation.campaign.progress',
        entity_type: 'campaign',
        label: `${progress.campaign.reference_code}: ${progress.progress.trips.completed}/${progress.progress.trips.planned_total} viagem(ns) concluída(s)`,
        snapshot_at: progress.updated_at,
      }],
      warnings: [],
      truncated: false,
    };
  },
};

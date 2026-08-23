'use strict';

// Tool: fleet.current.summary — resumo operacional da frota do usuário.
// REUSA o serviço canônico fleet.getOverview (tenant + escopo aplicados lá).
// Projeta apenas contagens/labels (sem placas, sem PII). READ-ONLY.

const fleet = require('../../fleet/fleetService');

module.exports = {
  name: 'fleet.current.summary',
  description: 'Resumo da frota do usuário: totais de ativos, composições, manutenções abertas, documentos vencendo e pontos de atenção. Somente leitura.',
  requiredPermission: 'fleet.view',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const overview = await fleet.getOverview(ctx.supabase, {
      empresaId: ctx.empresaId,
      operationalScope: ctx.operationalScope || null,
    });
    return {
      ok: true,
      data: {
        summary: overview.summary,
        attention: overview.attention,
      },
      evidence: [{
        tool: 'fleet.current.summary',
        entity_type: 'fleet',
        label: `Frota com ${overview.summary?.assets_total ?? 0} ativo(s)`,
        snapshot_at: new Date().toISOString(),
      }],
      warnings: [],
      truncated: false,
    };
  },
};

'use strict';

// Tool: operation.command_center.summary — resumo da Torre de Controle.
// REUSA o serviço canônico commandCenterService (mesma classificação do endpoint,
// §72 — não duplica regras). READ-ONLY. Projeta contagens + categorias de atenção
// + top-N itens de atenção com campos seguros (sem PII sensível, sem valores
// financeiros salvo visibilidade, sem URL assinada).

const { carregarCommandCenter } = require('../../commandCenterService');

const TOP_N = 5;

module.exports = {
  name: 'operation.command_center.summary',
  description: 'Resumo da Torre de Controle operacional: contagens por prioridade (crítico/atenção), categorias de atenção (ocorrências, comprovante, localização, dados incompletos) e uma lista curta dos fretes que mais precisam de atenção. Somente leitura.',
  requiredPermission: 'reports.operational.view',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const financialVisibility = ctx.isSuperAdmin === true
      || Boolean(ctx.effectivePermissions && ctx.effectivePermissions['finance.operational.view'] === true);

    const cc = await carregarCommandCenter(ctx.supabase, {
      empresaAlvo: ctx.empresaId,
      operationalScope: ctx.operationalScope || null,
      filtros: {},
      financialVisibility,
    });

    // Top-N de atenção (crítico primeiro; já vem ordenado do engine). Campos seguros.
    const topAtencao = cc.itens
      .filter((i) => i.nivel === 'critico' || i.nivel === 'atencao')
      .slice(0, TOP_N)
      .map((i) => ({
        frete_id: i.frete_id,
        nivel: i.nivel,
        attention_code: i.attention_code,
        situacao: i.situacao,
        motivo: i.motivo,
        placa: i.placa || null,
        motorista_nome: i.motorista_nome || null,
      }));

    return {
      ok: true,
      data: {
        resumo: cc.resumo,
        attention_summary: cc.attention_summary,
        top_atencao: topAtencao,
      },
      evidence: [{
        tool: 'operation.command_center.summary',
        entity_type: 'command_center',
        label: `${cc.resumo?.criticos ?? 0} crítico(s) e ${cc.resumo?.atencao ?? 0} em atenção`,
        snapshot_at: new Date().toISOString(),
      }],
      warnings: cc.limite_aplicado ? ['Muitos fretes; resumo pode estar limitado à janela recente.'] : [],
      truncated: cc.limite_aplicado === true,
    };
  },
};

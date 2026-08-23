'use strict';

// Tool: operation.freights.attention — resumo dos fretes que precisam de atenção.
// Aplica tenant (empresa_id do servidor) + escopo operacional canônico
// (aplicarEscopoOperacionalQuery). Projeta apenas contagens por status (sem PII,
// sem valores financeiros). READ-ONLY.

const { aplicarEscopoOperacionalQuery } = require('../../operationalScopeService');
const { LIMITS } = require('../config');

// Status que representam frete ativo (precisa de acompanhamento). 'finalizado' e
// 'cancelado' são terminais e não contam como atenção.
const STATUS_TERMINAIS = new Set(['finalizado', 'cancelado']);

module.exports = {
  name: 'operation.freights.attention',
  description: 'Resumo dos fretes do usuário por status, destacando os que ainda estão ativos (não finalizados/cancelados). Somente leitura; não retorna dados pessoais nem valores.',
  requiredPermission: 'freight.view',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    let query = ctx.supabase
      .from('fretes')
      .select('id, status, unidade_operacional_id')
      .eq('empresa_id', ctx.empresaId)
      .limit(LIMITS.MAX_TOOL_ROWS * 20); // teto amplo só para contagem
    query = aplicarEscopoOperacionalQuery(query, ctx.operationalScope || null);

    const { data, error } = await query;
    if (error) return { ok: false, data: null, evidence: [], warnings: ['Não foi possível consultar os fretes.'], truncated: false };

    const rows = data || [];
    const porStatus = {};
    let ativos = 0;
    for (const f of rows) {
      const s = f.status || 'desconhecido';
      porStatus[s] = (porStatus[s] || 0) + 1;
      if (!STATUS_TERMINAIS.has(s)) ativos += 1;
    }
    const truncated = rows.length >= LIMITS.MAX_TOOL_ROWS * 20;

    return {
      ok: true,
      data: {
        total: rows.length,
        ativos,
        por_status: porStatus,
      },
      evidence: [{
        tool: 'operation.freights.attention',
        entity_type: 'freight',
        label: `Baseado em ${rows.length} frete(s)`,
        snapshot_at: new Date().toISOString(),
      }],
      warnings: truncated ? ['Muitos fretes; contagem pode estar limitada.'] : [],
      truncated,
    };
  },
};

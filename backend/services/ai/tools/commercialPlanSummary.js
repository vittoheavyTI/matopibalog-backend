'use strict';

// Tool: commercial.current_plan.summary — plano atual + capacidade/uso do usuário.
// REUSA planoLimiteService (autoridade canônica de contagem de motoristas). NÃO
// expõe regras internas de preço, faturas ou billing. READ-ONLY.

const { avaliarLimiteMotoristas } = require('../../planoLimiteService');

module.exports = {
  name: 'commercial.current_plan.summary',
  description: 'Plano atual do cliente, capacidade contratada de motoristas e uso atual. Não inclui cobrança, faturas nem regras internas de preço. Somente leitura.',
  requiredPermission: 'company.settings.view',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const lim = await avaliarLimiteMotoristas(ctx.supabase, ctx.empresaId);
    return {
      ok: true,
      data: {
        plano: lim.planoAtual || null,
        capacidade_motoristas: lim.limite, // null = ilimitado
        ilimitado: lim.ilimitado === true,
        motoristas_em_uso: lim.totalAtual, // null quando ilimitado (não conta)
      },
      evidence: [{
        tool: 'commercial.current_plan.summary',
        entity_type: 'plan',
        label: lim.planoAtual ? `Plano ${lim.planoAtual}` : 'Plano atual',
        snapshot_at: new Date().toISOString(),
      }],
      warnings: [],
      truncated: false,
    };
  },
};

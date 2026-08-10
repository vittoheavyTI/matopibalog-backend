// Deps de billing respaldadas por Supabase (macrofrente 3A-2).
//
// Fornece as funções de carga/persistência que o orquestrador (I/O) consome.
// Centraliza o acesso ao banco em UM lugar (worker e endpoints reutilizam) para
// não espalhar chamadas de billing por controllers (§5/§24).

const { carregarSituacaoComercial } = require('../situacaoComercialService');

function criarDepsSupabase(supabase) {
  return {
    carregarSituacao: async (empresaId) => carregarSituacaoComercial(supabase, empresaId),

    carregarEmpresaBilling: async (empresaId) => {
      const { data } = await supabase
        .from('empresas')
        .select('id, asaas_customer_id, asaas_subscription_id, implantacao_cobrada, next_due_date, trial_ends_at, billing_valor_mensal, assinatura_cancelada')
        .eq('id', empresaId)
        .maybeSingle();
      return data || {};
    },

    carregarSnapshot: async (empresaId) => {
      const { data } = await supabase
        .from('propostas_comerciais')
        .select('snapshot, valor_mensal, valor_implantacao, trial_dias')
        .eq('empresa_id', empresaId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return {};
      return data.snapshot || { valor_mensal: data.valor_mensal, valor_implantacao: data.valor_implantacao, trial_dias: data.trial_dias };
    },

    carregarAddOns: async (empresaId) => {
      // Carrega add-ons ATIVOS (para criar componente) E os que têm componente
      // (para convergência de remoção quando ficaram inativos). O orquestrador
      // decide criar/remover por convergência.
      const [ativos, comComponente] = await Promise.all([
        supabase.from('empresa_funcionalidades').select('id, funcionalidade_id, status, preco_mensal_centavos, billing_component_id').eq('empresa_id', empresaId).eq('status', 'ativa'),
        supabase.from('empresa_funcionalidades').select('id, funcionalidade_id, status, preco_mensal_centavos, billing_component_id').eq('empresa_id', empresaId).not('billing_component_id', 'is', null),
      ]);
      const mapa = new Map();
      for (const a of (ativos.data || [])) mapa.set(a.id, a);
      for (const a of (comComponente.data || [])) if (!mapa.has(a.id)) mapa.set(a.id, a);
      return Array.from(mapa.values());
    },

    // Persiste o patch de billing. Trata __addon separadamente (grava o componente
    // no empresa_funcionalidades). CAS de mapeamento: só grava customer/subscription
    // se ainda nulo (idempotência multi-processo persistente).
    persist: async (empresaId, patch) => {
      if (patch.__addon) {
        await supabase
          .from('empresa_funcionalidades')
          .update({ billing_component_id: patch.__addon.billing_component_id, atualizado_em: new Date().toISOString() })
          .eq('id', patch.__addon.addon_id);
        return;
      }
      if (patch.__addon_removido) {
        // Convergência de remoção: limpa o vínculo do componente cancelado.
        await supabase
          .from('empresa_funcionalidades')
          .update({ billing_component_id: null, atualizado_em: new Date().toISOString() })
          .eq('id', patch.__addon_removido.addon_id);
        return;
      }
      const update = { ...patch, billing_updated_at: new Date().toISOString() };
      let q = supabase.from('empresas').update(update).eq('id', empresaId);
      // Conditional-update como CAS: se estamos gravando o customer, exigir que
      // ainda esteja nulo — o perdedor da corrida não sobrescreve.
      if (patch.asaas_customer_id) q = q.is('asaas_customer_id', null);
      if (patch.asaas_subscription_id) q = q.is('asaas_subscription_id', null);
      await q;
    },
  };
}

module.exports = { criarDepsSupabase };

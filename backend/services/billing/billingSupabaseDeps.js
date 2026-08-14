// Deps de billing respaldadas por Supabase (macrofrente 3A-2).
//
// Fornece as funções de carga/persistência que o orquestrador (I/O) consome.
// Centraliza o acesso ao banco em UM lugar (worker e endpoints reutilizam) para
// não espalhar chamadas de billing por controllers (§5/§24).

const { carregarSituacaoComercial } = require('../situacaoComercialService');

const CAMPOS_ADDON_BILLING = [
  'id',
  'funcionalidade_id',
  'status',
  'origem',
  'preco_mensal_centavos',
  'quantidade',
  'vigencia_inicio',
  'vigencia_fim',
  'aprovado_por',
  'contrato_id',
  'aditivo_id',
  'billing_component_id',
].join(', ');

function idsUnicos(lista) {
  return Array.from(new Set((lista || []).filter(Boolean).map(String)));
}

async function carregarContratosPorIds(supabase, ids) {
  const contratoIds = idsUnicos(ids);
  if (contratoIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('contratos_comerciais')
    .select('id, status, empresa_id, aceito_em')
    .in('id', contratoIds);
  if (error) return new Map();
  return new Map((data || []).map((c) => [String(c.id), c]));
}

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
        supabase.from('empresa_funcionalidades').select(CAMPOS_ADDON_BILLING).eq('empresa_id', empresaId).eq('status', 'ativa'),
        supabase.from('empresa_funcionalidades').select(CAMPOS_ADDON_BILLING).eq('empresa_id', empresaId).not('billing_component_id', 'is', null),
      ]);
      const mapa = new Map();
      for (const a of (ativos.data || [])) mapa.set(a.id, a);
      for (const a of (comComponente.data || [])) if (!mapa.has(a.id)) mapa.set(a.id, a);
      const addons = Array.from(mapa.values());
      const contratos = await carregarContratosPorIds(
        supabase,
        addons.flatMap((a) => [a.contrato_id, a.aditivo_id]),
      );
      return addons.map((a) => {
        const contratoRaw = a.contrato_id ? contratos.get(String(a.contrato_id)) : null;
        const aditivoRaw = a.aditivo_id ? contratos.get(String(a.aditivo_id)) : null;
        const contrato = contratoRaw && String(contratoRaw.empresa_id) === String(empresaId) ? contratoRaw : null;
        const aditivo = aditivoRaw && String(aditivoRaw.empresa_id) === String(empresaId) ? aditivoRaw : null;
        return {
          ...a,
          contrato_billing_status: contrato?.status || null,
          aditivo_billing_status: aditivo?.status || null,
        };
      });
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

module.exports = { criarDepsSupabase, CAMPOS_ADDON_BILLING, carregarContratosPorIds };

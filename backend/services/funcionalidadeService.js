// I/O do catálogo de funcionalidades. A lógica de projeção/entitlement é pura
// (entitlementDomainService). Aqui só carrega do banco e delega. Deploy-safe:
// antes da migration 060 as tabelas não existem → devolve vazio (os cards caem
// no comportamento atual de `recursos`, sem quebrar).

const { projetarFuncionalidadesDoCard } = require('./entitlementDomainService');

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' ||
    /does not exist|could not find|schema cache/i.test(error.message || '')
  );
}

// Mapa planoId → lista de funcionalidades projetadas para o card público.
// Só considera funcionalidades ativas; a projeção pura aplica visibilidade,
// estado técnico e rótulos (nunca mostra não-implementado como disponível).
async function carregarMatrizPublicaPorPlano(supabase) {
  try {
    const [{ data: funcs, error: e1 }, { data: pfs, error: e2 }] = await Promise.all([
      supabase.from('funcionalidades').select('id, codigo, nome, status_ciclo_vida, ativo, visivel_publicamente, ordem_exibicao').eq('ativo', true),
      supabase.from('plano_funcionalidades').select('plano_id, funcionalidade_id, disponibilidade, exibir_no_card, destaque, texto_publico, ordem_exibicao'),
    ]);
    if (e1 || e2) {
      if (tabelaAusente(e1) || tabelaAusente(e2)) return {};
      return {};
    }
    const funcionalidades = funcs || [];
    const porPlano = {};
    for (const pf of pfs || []) {
      (porPlano[pf.plano_id] = porPlano[pf.plano_id] || []).push(pf);
    }
    const resultado = {};
    for (const [planoId, planoFuncs] of Object.entries(porPlano)) {
      resultado[planoId] = projetarFuncionalidadesDoCard({ funcionalidades, planoFuncs });
    }
    return resultado;
  } catch (_) {
    return {}; // best-effort: nunca derruba o endpoint público
  }
}

module.exports = { carregarMatrizPublicaPorPlano, tabelaAusente };

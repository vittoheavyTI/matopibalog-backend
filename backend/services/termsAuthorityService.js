// backend/services/termsAuthorityService.js
//
// Serviço centralizado de autoridade de termos obrigatórios (R1B-A).
// Determina de forma autoritativa e fail-closed se um usuário interno possui termos
// ativos obrigatórios pendentes de aceite.
//
// Invariantes:
// - Super-admin é isento de termos obrigatórios (sempre retorna { temPendentes: false, count: 0 }).
// - Carrega apenas 'id' de termos e 'termo_id' de termos_aceites (sem payload textual desnecessário).
// - Fail-closed: qualquer exceção, erro de query do Supabase ou cliente indisponível lança erro.

function getSupabase(injected) {
  if (injected !== undefined) return injected;
  if (process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_URL) {
    try {
      return require('../config/supabase');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Verifica se um usuário possui termos obrigatórios pendentes.
 *
 * @param {Object} params
 * @param {string} params.usuarioId
 * @param {string} params.role
 * @param {boolean} [params.isSuperAdmin=false]
 * @param {Object} [params.supabaseClient]
 * @returns {Promise<{ temPendentes: boolean, count: number }>}
 */
async function verificarTermosObrigatoriosPendentes({
  usuarioId,
  role,
  isSuperAdmin = false,
  supabaseClient,
}) {
  if (isSuperAdmin === true) {
    return { temPendentes: false, count: 0 };
  }

  if (!usuarioId || typeof usuarioId !== 'string' || usuarioId.trim() === '') {
    throw new Error('usuarioId inválido ou ausente para verificação de termos');
  }
  if (!role || typeof role !== 'string' || role.trim() === '') {
    throw new Error('role inválido ou ausente para verificação de termos');
  }

  const client = getSupabase(supabaseClient);
  if (!client) {
    throw new Error('Cliente de autoridade indisponível para verificação de termos');
  }

  // 1) Termos ativos cujo obrigatorio_para contém a role do usuário.
  // Seleciona APENAS 'id' (não trafega conteúdo/resumo).
  const { data: ativos, error: errAtivos } = await client
    .from('termos')
    .select('id')
    .eq('ativo', true)
    .contains('obrigatorio_para', [role]);

  if (errAtivos) {
    throw new Error(errAtivos.message || 'Erro ao consultar termos ativos');
  }

  if (!ativos || ativos.length === 0) {
    return { temPendentes: false, count: 0 };
  }

  const idsAtivos = ativos.map((t) => t.id);

  // 2) Aceites já registrados por este usuário para os termos ativos relevantes.
  const { data: aceites, error: errAceites } = await client
    .from('termos_aceites')
    .select('termo_id')
    .eq('usuario_id', usuarioId)
    .in('termo_id', idsAtivos);

  if (errAceites) {
    throw new Error(errAceites.message || 'Erro ao consultar aceites de termos');
  }

  const aceitosSet = new Set((aceites || []).map((a) => a.termo_id));
  const pendentesCount = idsAtivos.filter((id) => !aceitosSet.has(id)).length;

  return {
    temPendentes: pendentesCount > 0,
    count: pendentesCount,
  };
}

module.exports = {
  verificarTermosObrigatoriosPendentes,
};

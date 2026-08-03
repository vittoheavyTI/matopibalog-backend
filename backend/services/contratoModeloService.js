const { STATUS_MODELO, snapshotDoModelo } = require('./contratoModeloDomainService');

// I/O dos modelos de contrato. A leitura do modelo vigente é usada pela geração
// de contrato (contratacaoComercialService) e é FAIL-OPEN: se a tabela ainda não
// existir (migration 057 pendente) ou der erro, devolve null → o contrato usa o
// texto técnico padrão, sem quebrar o cadastro (decisão de produto: fallback).

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the table|schema cache/i.test(error.message || '')
  );
}

// Modelo PUBLICADO (vigente) de um plano, ou null. Nunca lança.
async function obterModeloVigenteDoPlano({ supabase, planoId }) {
  if (!planoId) return { modelo: null, migration_pendente: false };
  try {
    const { data, error } = await supabase
      .from('contrato_modelos')
      .select('id, plano_id, versao, titulo, conteudo, conteudo_hash, status, publicado_em')
      .eq('plano_id', planoId)
      .eq('status', STATUS_MODELO.PUBLICADO)
      .maybeSingle();
    if (error) {
      if (tabelaAusente(error)) return { modelo: null, migration_pendente: true };
      return { modelo: null, migration_pendente: false };
    }
    return { modelo: data || null, migration_pendente: false };
  } catch {
    return { modelo: null, migration_pendente: false };
  }
}

// Snapshot congelável do modelo vigente do plano (ou null p/ fallback). Nunca lança.
async function snapshotVigenteParaContrato({ supabase, planoId }) {
  const { modelo, migration_pendente } = await obterModeloVigenteDoPlano({ supabase, planoId });
  return { snapshot: snapshotDoModelo(modelo), migration_pendente };
}

module.exports = {
  tabelaAusente,
  obterModeloVigenteDoPlano,
  snapshotVigenteParaContrato,
};

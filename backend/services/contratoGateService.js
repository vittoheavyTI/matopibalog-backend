// backend/services/contratoGateService.js
// Gate de contrato obrigatório. Só um contrato/aditivo marcado como
// `obrigatorio = true` E ainda pendente de assinatura bloqueia as ESCRITAS
// operacionais do tenant. Contratos não-obrigatórios (minutas, opcionais,
// testes não marcados) nunca bloqueiam. Fail-open em erro/coluna ausente
// (mesma filosofia fail-safe do restante do billing): na dúvida, NÃO bloqueia.
//
// As funções puras (pendenciaObrigatoria/resumoContratos) são testáveis sem I/O.

// Status de contrato que representam "assinatura ainda pendente".
const STATUS_PENDENTES = new Set([
  'aguardando_assinatura',
  'pronto_assinatura',
  'aguardando_assinatura_cliente',
  'aguardando_assinatura_matopiba',
]);

// Status que representam contrato concluído (não bloqueia).
const STATUS_CONCLUIDOS = new Set([
  'plenamente_assinado',
  'assinado',
  'aceito_manualmente',
]);

// True se existe ao menos um contrato OBRIGATÓRIO e PENDENTE.
function pendenciaObrigatoria(contratos = []) {
  return (contratos || []).some((c) => c && c.obrigatorio === true && STATUS_PENDENTES.has(c.status));
}

// Resumo compacto para UI (sidebar/faturas): há pendência obrigatória? algum
// contrato concluído? algum pendente (obrigatório ou não)?
function resumoContratos(contratos = []) {
  const lista = contratos || [];
  return {
    pendencia_obrigatoria: pendenciaObrigatoria(lista),
    tem_contrato: lista.length > 0,
    algum_concluido: lista.some((c) => c && STATUS_CONCLUIDOS.has(c.status)),
    algum_pendente: lista.some((c) => c && STATUS_PENDENTES.has(c.status)),
  };
}

// I/O: lê os contratos do tenant (só os campos do gate). Não lança: devolve
// { contratos, error } para o chamador decidir (que sempre falha-aberto).
async function buscarContratosDaEmpresa(supabase, empresaId) {
  try {
    const { data, error } = await supabase
      .from('contratos_comerciais')
      .select('id, status, obrigatorio')
      .eq('empresa_id', empresaId);
    if (error) return { contratos: [], error };
    return { contratos: data || [], error: null };
  } catch (error) {
    return { contratos: [], error };
  }
}

// Decisão do gate para o middleware. Fail-open: erro/coluna ausente → false.
async function empresaTemContratoObrigatorioPendente(supabase, empresaId) {
  if (!empresaId) return false;
  const { contratos, error } = await buscarContratosDaEmpresa(supabase, empresaId);
  if (error) return false;
  return pendenciaObrigatoria(contratos);
}

module.exports = {
  STATUS_PENDENTES,
  STATUS_CONCLUIDOS,
  pendenciaObrigatoria,
  resumoContratos,
  buscarContratosDaEmpresa,
  empresaTemContratoObrigatorioPendente,
};

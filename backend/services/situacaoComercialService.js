// Camada de I/O + composição para a situação comercial canônica.
//
// O CÁLCULO vive em situacaoComercialDomainService (puro). Aqui apenas:
//   - montarSituacaoComercial(): PURO — mapeia linhas do banco → entrada do
//     domínio → saída enriquecida (echo de plano/valores, flags de conveniência).
//   - carregarSituacaoComercial(): I/O — busca empresa, contratos, proposta e
//     faturas iniciais e delega. Fail-safe: nunca lança para o chamador.
//
// Deploy-safe: usa select('*') na empresa e tolera coluna/tabela ausente (antes
// da migration 058 a conta cai no caminho LEGADO, comportamento atual preservado).

const { avaliarSituacaoComercial, SITUACAO, CONTRATO_CONCLUIDO } = require('./situacaoComercialDomainService');
const { STATUS_PENDENTES, buscarContratosDaEmpresa } = require('./contratoGateService');
const { ORIGENS_EXPLICITAS } = require('./aquisicaoComercialService');

const SITUACOES_TRIAL_ATIVO = new Set([SITUACAO.TRIAL_ATIVO, SITUACAO.TRIAL_EXPIRANDO]);
const SITUACOES_TRIAL_EXPIRADO = new Set([
  SITUACAO.TRIAL_EXPIRADO_AGUARDANDO_DECISAO,
  SITUACAO.TRIAL_ENCERRADO_SEM_CONTRATACAO,
  SITUACAO.CONVERSAO_AGUARDANDO_PAGAMENTO,
]);

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    /does not exist|could not find|schema cache/i.test(error.message || '')
  );
}

// Escolhe o contrato que governa o estado: obrigatório pendente > obrigatório
// concluído > qualquer obrigatório > nenhum. Só contratos obrigatórios entram no
// domínio (não-obrigatórios nunca bloqueiam nem liberam trial).
function contratoGovernante(contratos = []) {
  const obrig = (contratos || []).filter((c) => c && c.obrigatorio === true && c.status !== 'cancelado');
  if (obrig.length === 0) return null;
  const pendente = obrig.find((c) => STATUS_PENDENTES.has(c.status));
  if (pendente) return { status: pendente.status, obrigatorio: true };
  const concluido = obrig.find((c) => CONTRATO_CONCLUIDO.has(c.status));
  if (concluido) return { status: concluido.status, obrigatorio: true };
  return { status: obrig[0].status, obrigatorio: true };
}

function contratosDaProposta(proposta) {
  const c = proposta && proposta.contratos_comerciais;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

// PURA. Recebe linhas já carregadas e devolve a situação comercial completa.
function montarSituacaoComercial({ empresa, contratos, proposta, faturas, agora, diasAvisoTrial } = {}) {
  const emp = empresa || {};
  const propostaContratos = contratosDaProposta(proposta);
  const aquisicaoExplicita = ORIGENS_EXPLICITAS.has(proposta?.origem);
  const contrato = contratoGovernante(aquisicaoExplicita && propostaContratos.length > 0 ? propostaContratos : contratos);
  const snapshot = proposta ? (proposta.snapshot || proposta) : null;
  const faturasIniciais = (faturas || []).map((f) => ({ origem: f.origem, status: f.status, valor: f.valor }));

  const dominio = avaliarSituacaoComercial({
    empresa: emp,
    contrato,
    snapshot,
    faturasIniciais,
    agora,
    diasAvisoTrial,
    aquisicao_explicita: aquisicaoExplicita,
  });

  return {
    ...dominio,
    commercial_flow_version: emp.commercial_flow_version || null,
    status_operacional: emp.status || null,
    contrato_obrigatorio: Boolean(contrato && contrato.obrigatorio),
    contrato_status: contrato ? contrato.status : null,
    aquisicao_explicita: aquisicaoExplicita,
    proposta_origem: proposta?.origem || null,
    plano_id: snapshot ? (snapshot.plano_id || null) : (emp.plano_id || null),
    quantidade_contratada: snapshot ? (snapshot.quantidade_contratada ?? null) : (emp.quantidade_contratada ?? null),
    plano_nome: snapshot ? (snapshot.plano_nome || null) : null,
    mensalidade: Number(snapshot?.valor_mensal || 0),
    implantacao: Number(snapshot?.valor_implantacao || 0),
    implantacao_gratis: Number(snapshot?.valor_implantacao || 0) <= 0,
    snapshot: snapshot || null,
    trial_ativo: SITUACOES_TRIAL_ATIVO.has(dominio.situacao),
    trial_expirado: SITUACOES_TRIAL_EXPIRADO.has(dominio.situacao),
    pode_operar: dominio.acoes.operar_escrita,
    pode_consultar: dominio.acoes.consultar,
    pode_contratar: dominio.acoes.converter,
    motivo_bloqueio: dominio.acoes.operar_escrita ? null : dominio.motivo,
  };
}

// Resposta neutra quando não há empresa (ex.: super-admin sem tenant).
function situacaoNaoAplicavel() {
  return {
    aplicavel: false,
    situacao: null,
    commercial_flow_version: null,
    acoes: { consultar: true, operar_escrita: true, assinar_contrato: false, converter: false, regularizar: false },
    pode_operar: true,
    pode_consultar: true,
  };
}

// I/O. Nunca lança: em qualquer erro devolve uma situação segura (legado) para
// não derrubar o gate nem o endpoint.
async function carregarSituacaoComercial(supabase, empresaId, opcoes = {}) {
  if (!empresaId) return situacaoNaoAplicavel();
  try {
    let empresa = opcoes.empresa || null;
    if (!empresa) {
      const { data, error } = await supabase.from('empresas').select('*').eq('id', empresaId).maybeSingle();
      if (error || !data) return { ...situacaoNaoAplicavel(), aplicavel: true };
      empresa = data;
    }

    const { contratos } = await buscarContratosDaEmpresa(supabase, empresaId);

    let proposta = null;
    try {
      const { data, error } = await supabase
        .from('propostas_comerciais')
        .select('id, origem, snapshot, valor_mensal, valor_implantacao, total_inicial, trial_dias, contratos_comerciais(id, status, obrigatorio)')
        .eq('empresa_id', empresaId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) proposta = data || null;
    } catch { /* proposta é best-effort */ }

    let faturas = [];
    try {
      const { data, error } = await supabase
        .from('faturas')
        .select('origem, status, valor')
        .eq('empresa_id', empresaId)
        .in('origem', ['implantacao', 'mensalidade']);
      if (!error && Array.isArray(data)) faturas = data;
      else if (error && !tabelaAusente(error)) faturas = [];
    } catch { /* faturas é best-effort */ }

    return { aplicavel: true, ...montarSituacaoComercial({ empresa, contratos, proposta, faturas, agora: opcoes.agora }) };
  } catch {
    return { ...situacaoNaoAplicavel(), aplicavel: true };
  }
}

module.exports = {
  contratoGovernante,
  montarSituacaoComercial,
  carregarSituacaoComercial,
  situacaoNaoAplicavel,
};

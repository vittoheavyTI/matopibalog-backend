const statusTexto = (valor) => String(valor || '').trim().toLowerCase();

const STATUS_ATIVOS = new Set(['ativo', 'pendente', 'em_viagem', 'em_andamento']);
const STATUS_RASTREAMENTO_ATIVO = new Set(['ativo', 'em_viagem', 'em_andamento']);
const STATUS_FINAIS = new Set(['finalizado']);
const STATUS_CANCELADOS = new Set(['cancelado']);
const STATUS_OCORRENCIA_ABERTA = new Set(['aberta', 'em_analise']);
const STATUS_EPOD_OK = new Set(['validado']);
const STATUS_EPOD_ATENCAO = new Set(['registrado', 'parcial', 'rejeitado']);
const LOCALIZACAO_INTERVALO_CAPTURA_MS = 5 * 60 * 1000;
const LOCALIZACAO_HEARTBEAT_MS = 15 * 60 * 1000;
const LOCALIZACAO_TOLERANCIA_MS = 2 * LOCALIZACAO_INTERVALO_CAPTURA_MS;
const LOCALIZACAO_DESATUALIZADA_MS = LOCALIZACAO_HEARTBEAT_MS + LOCALIZACAO_TOLERANCIA_MS;

const contarPorFrete = (linhas) => {
  const mapa = new Map();
  for (const linha of linhas || []) {
    const freteId = linha?.frete_id;
    if (!freteId) continue;
    if (!mapa.has(freteId)) mapa.set(freteId, []);
    mapa.get(freteId).push(linha);
  }
  return mapa;
};

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const dataValida = (valor) => {
  const d = new Date(valor || '');
  return Number.isNaN(d.getTime()) ? null : d;
};

const nomeMotorista = (frete) => {
  const mot = frete?.motoristas;
  if (Array.isArray(mot)) return mot[0]?.usuarios?.nome || null;
  return mot?.usuarios?.nome || null;
};

const dadosIncompletos = (frete) => {
  const faltantes = [];
  if (!frete?.motorista_id) faltantes.push('motorista');
  if (!String(frete?.origem || '').trim()) faltantes.push('origem');
  if (!String(frete?.destino || '').trim()) faltantes.push('destino');
  if (numero(frete?.valor_frete) === null) faltantes.push('valor do frete');
  return faltantes;
};

const resumirEpod = (epod, evidencias) => {
  if (!epod) {
    return {
      status: 'sem_epod',
      rotulo: 'Sem comprovante de entrega',
      pendente_real: false,
      sem_comprovacao: false,
      evidencias_total: 0,
      evidencias_pendentes: 0,
      evidencias_aprovadas: 0,
      evidencias_rejeitadas: 0,
    };
  }

  const lista = evidencias || [];
  const status = statusTexto(epod.status) || 'registrado';
  const evidenciasPendentes = lista.filter((e) => statusTexto(e.status) === 'pendente').length;
  return {
    status,
    rotulo: epod.status || 'registrado',
    pendente_real: STATUS_EPOD_ATENCAO.has(status) && !STATUS_EPOD_OK.has(status),
    sem_comprovacao: false,
    evidencias_total: lista.length,
    evidencias_pendentes: evidenciasPendentes,
    evidencias_aprovadas: lista.filter((e) => statusTexto(e.status) === 'aprovada').length,
    evidencias_rejeitadas: lista.filter((e) => statusTexto(e.status) === 'rejeitada').length,
    comprovado_em: epod.comprovado_em || null,
    validado_em: epod.validado_em || null,
  };
};

// attention_code: categoria estruturada (§40) para filtros e IA, além do texto.
const decidirSituacao = ({ frete, ocorrenciasAbertas, epodResumo, faltantes }) => {
  const status = statusTexto(frete.status);
  const ocorrenciaAtraso = ocorrenciasAbertas.find((o) => statusTexto(o.tipo) === 'atraso');
  const ocorrenciaCritica = ocorrenciasAbertas.find((o) => ['avaria', 'recusa', 'extravio', 'divergencia'].includes(statusTexto(o.tipo)));

  if (STATUS_CANCELADOS.has(status)) {
    return {
      nivel: 'informativo',
      codigo: 'CANCELADO',
      situacao: 'Cancelado',
      motivo: 'Viagem cancelada: exibida somente para consulta.',
    };
  }

  if (ocorrenciaAtraso) {
    return {
      nivel: 'critico',
      codigo: 'OCORRENCIA_ATRASO',
      situacao: 'Atraso registrado',
      motivo: 'Há ocorrência de atraso aberta ou em análise.',
    };
  }

  if (ocorrenciaCritica) {
    return {
      nivel: 'critico',
      codigo: 'OCORRENCIA_CRITICA',
      situacao: 'Ocorrência crítica',
      motivo: `Há ocorrência de ${ocorrenciaCritica.tipo} aberta ou em análise.`,
    };
  }

  if (ocorrenciasAbertas.length > 0) {
    return {
      nivel: 'atencao',
      codigo: 'OCORRENCIA_ABERTA',
      situacao: 'Ocorrência aberta',
      motivo: 'Há ocorrência aberta ou em análise.',
    };
  }

  if (STATUS_FINAIS.has(status) && epodResumo.status === 'sem_epod') {
    return {
      nivel: 'informativo',
      codigo: 'SEM_COMPROVANTE',
      situacao: 'Sem comprovante',
      motivo: 'Viagem finalizada sem comprovante de entrega registrado.',
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_ATENCAO.has(epodResumo.status)) {
    return {
      nivel: epodResumo.status === 'rejeitado' ? 'critico' : 'atencao',
      codigo: epodResumo.status === 'rejeitado' ? 'COMPROVANTE_RECUSADO' : 'COMPROVACAO_PENDENTE',
      situacao: epodResumo.status === 'rejeitado' ? 'Comprovante recusado' : 'Comprovação pendente',
      motivo: epodResumo.status === 'rejeitado'
        ? 'Comprovante de entrega recusado.'
        : 'Comprovante de entrega aguardando análise.',
    };
  }

  if (STATUS_ATIVOS.has(status) && faltantes.length > 0) {
    return {
      nivel: 'atencao',
      codigo: 'DADOS_INCOMPLETOS',
      situacao: 'Informações incompletas',
      motivo: `Campos pendentes: ${faltantes.join(', ')}.`,
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_OK.has(epodResumo.status)) {
    return {
      nivel: 'ok',
      codigo: 'CONCLUIDO',
      situacao: 'Concluído',
      motivo: 'Viagem finalizada com comprovante de entrega aprovado.',
    };
  }

  if (STATUS_ATIVOS.has(status)) {
    return {
      nivel: 'ok',
      codigo: status === 'pendente' ? 'PENDENTE' : 'EM_ANDAMENTO',
      situacao: status === 'pendente' ? 'Pendente' : 'Em andamento',
      motivo: status === 'pendente' ? 'Viagem aguardando ativação operacional.' : 'Viagem em andamento, sem alertas.',
    };
  }

  return {
    nivel: 'informativo',
    codigo: 'INFORMATIVO',
    situacao: frete.status || 'Status nao informado',
    motivo: 'Viagem sem alertas operacionais.',
  };
};

const ordenarItens = (a, b) => {
  const peso = { critico: 0, atencao: 1, ok: 2, informativo: 3 };
  const pa = peso[a.nivel] ?? 9;
  const pb = peso[b.nivel] ?? 9;
  if (pa !== pb) return pa - pb;
  return String(b.data || '').localeCompare(String(a.data || ''));
};

const rotulosLocalizacao = {
  atualizada: 'Localizacao atualizada',
  aguardando_atualizacao: 'Aguardando atualizacao',
  desatualizada: 'Localizacao desatualizada',
  aguardando_primeira: 'Aguardando primeira localizacao',
  interrompida: 'Localizacao interrompida',
  gps_desativado: 'GPS desativado',
  permissao_nao_concedida: 'Permissao nao concedida',
  sem_conexao: 'Sem conexao',
  rastreamento_encerrado: 'Rastreamento encerrado',
};

const montarLocalizacao = ({ frete, loc, estado }) => {
  const status = statusTexto(frete.status);
  const rastreamentoAtivo = STATUS_RASTREAMENTO_ATIVO.has(status);
  const capturedAt = loc?.captured_at || null;
  const receivedAt = loc?.received_at || null;
  const estadoValor = statusTexto(estado?.estado);
  const estadoAtualizadoEm = dataValida(estado?.atualizado_em);
  const recebidaEm = dataValida(receivedAt || capturedAt);
  const estadoFoiSuperado = estadoAtualizadoEm && recebidaEm && recebidaEm > estadoAtualizadoEm;

  let chave = estadoValor || null;
  if (!rastreamentoAtivo) {
    chave = STATUS_FINAIS.has(status) || STATUS_CANCELADOS.has(status) ? 'rastreamento_encerrado' : null;
  } else if (estadoFoiSuperado || chave === 'atualizada') {
    chave = capturedAt ? 'atualizada' : 'aguardando_primeira';
  } else if (!chave && capturedAt) {
    chave = 'atualizada';
  } else if (!chave) {
    chave = 'aguardando_primeira';
  }

  if (rastreamentoAtivo && capturedAt && chave === 'atualizada') {
    const base = recebidaEm || dataValida(capturedAt);
    if (base && Date.now() - base.getTime() > LOCALIZACAO_DESATUALIZADA_MS) {
      chave = 'desatualizada';
    } else if (base && Date.now() - base.getTime() > LOCALIZACAO_HEARTBEAT_MS) {
      chave = 'aguardando_atualizacao';
    }
  }

  const atencao = rastreamentoAtivo && [
    'desatualizada',
    'interrompida',
    'gps_desativado',
    'permissao_nao_concedida',
    'sem_conexao',
  ].includes(chave);

  return {
    ultima_enviada_em: capturedAt,
    recebida_em: receivedAt,
    captured_at: capturedAt,
    received_at: receivedAt,
    accuracy_m: numero(loc?.accuracy_m),
    ativa: rastreamentoAtivo && Boolean(capturedAt) && chave === 'atualizada',
    estado: chave,
    rotulo: chave ? rotulosLocalizacao[chave] || chave : null,
    detalhe: estado?.detalhe || null,
    atualizado_em: estado?.atualizado_em || null,
    nivel_alerta: atencao ? 'atencao' : 'informativo',
  };
};

function montarTorreControle({ fretes, ocorrencias, epods, evidencias, localizacoes, localizacaoEstados, financialVisibility = true }) {
  const ocorrPorFrete = contarPorFrete(ocorrencias);
  const epodPorFrete = new Map((epods || []).map((e) => [e.frete_id, e]));
  const evidPorFrete = contarPorFrete(evidencias);
  const locPorFrete = new Map((localizacoes || []).map((l) => [l.frete_id, l]));
  const estadoLocPorFrete = new Map((localizacaoEstados || []).map((l) => [l.frete_id, l]));

  const itens = (fretes || []).map((frete) => {
    const todasOcorrencias = ocorrPorFrete.get(frete.id) || [];
    const ocorrenciasAbertas = todasOcorrencias.filter((o) => STATUS_OCORRENCIA_ABERTA.has(statusTexto(o.status)));
    const faltantes = dadosIncompletos(frete);
    const epod = resumirEpod(epodPorFrete.get(frete.id), evidPorFrete.get(frete.id) || []);
    const status = statusTexto(frete.status);
    epod.sem_comprovacao = STATUS_FINAIS.has(status) && epod.status === 'sem_epod' && !STATUS_CANCELADOS.has(status);
    const decisao = decidirSituacao({ frete, ocorrenciasAbertas, epodResumo: epod, faltantes });
    const localizacao = montarLocalizacao({
      frete,
      loc: locPorFrete.get(frete.id),
      estado: estadoLocPorFrete.get(frete.id),
    });
    const decisaoComLocalizacao = localizacao.nivel_alerta === 'atencao' && decisao.nivel === 'ok'
      ? {
          nivel: 'atencao',
          codigo: 'LOCALIZACAO_ATENCAO',
          situacao: localizacao.rotulo,
          motivo: localizacao.detalhe || 'A viagem esta em andamento, mas o compartilhamento de localizacao precisa de atencao.',
        }
      : decisao;

    // Privacidade financeira (§26/§27): valor do frete só quando autorizado. Sem
    // permissão, o campo é OMITIDO (não retornado 0/mascarado no cliente) e o campo
    // "valor do frete" também sai da lista de pendências (não sinaliza financeiro).
    const faltantesExpostos = financialVisibility ? faltantes : faltantes.filter((f) => f !== 'valor do frete');

    return {
      frete_id: frete.id,
      empresa_id: frete.empresa_id,
      motorista_id: frete.motorista_id || null,
      motorista_nome: nomeMotorista(frete),
      data: frete.data || null,
      origem: frete.origem || null,
      destino: frete.destino || null,
      placa: frete.placa || null,
      status: frete.status || null,
      ...(financialVisibility ? { valor_frete: numero(frete.valor_frete) } : {}),
      financial_visibility: financialVisibility === true,
      nivel: decisaoComLocalizacao.nivel,
      attention_code: decisaoComLocalizacao.codigo || 'INFORMATIVO',
      situacao: decisaoComLocalizacao.situacao,
      motivo: decisaoComLocalizacao.motivo,
      dados_incompletos: faltantesExpostos,
      ocorrencias: {
        total: todasOcorrencias.length,
        abertas: ocorrenciasAbertas.length,
        atraso_aberto: ocorrenciasAbertas.some((o) => statusTexto(o.tipo) === 'atraso'),
        tipos_abertos: ocorrenciasAbertas.map((o) => o.tipo).filter(Boolean),
      },
      epod,
      localizacao,
    };
  }).sort(ordenarItens);

  const resumo = resumirItensTorre(itens);

  return { resumo, itens };
}

function resumirItensTorre(itens = []) {
  return {
    fretes_total: itens.length,
    criticos: itens.filter((i) => i.nivel === 'critico').length,
    atencao: itens.filter((i) => i.nivel === 'atencao').length,
    ok: itens.filter((i) => i.nivel === 'ok').length,
    informativos: itens.filter((i) => i.nivel === 'informativo').length,
    em_andamento: itens.filter((i) => STATUS_ATIVOS.has(statusTexto(i.status))).length,
    finalizados: itens.filter((i) => STATUS_FINAIS.has(statusTexto(i.status))).length,
    cancelados: itens.filter((i) => STATUS_CANCELADOS.has(statusTexto(i.status))).length,
    ocorrencias_abertas: itens.reduce((acc, i) => acc + i.ocorrencias.abertas, 0),
    epods_pendentes: itens.filter((i) => !STATUS_CANCELADOS.has(statusTexto(i.status)) && i.epod.pendente_real).length,
    sem_comprovacao: itens.filter((i) => i.epod.sem_comprovacao).length,
    dados_incompletos: itens.filter((i) => i.dados_incompletos.length > 0).length,
  };
}

module.exports = {
  montarTorreControle,
  montarLocalizacao,
  resumirItensTorre,
  statusTexto,
  LOCALIZACAO_INTERVALO_CAPTURA_MS,
  LOCALIZACAO_HEARTBEAT_MS,
  LOCALIZACAO_TOLERANCIA_MS,
  LOCALIZACAO_DESATUALIZADA_MS,
};

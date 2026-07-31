const statusTexto = (valor) => String(valor || '').trim().toLowerCase();

const STATUS_ATIVOS = new Set(['ativo', 'pendente']);
const STATUS_FINAIS = new Set(['finalizado']);
const STATUS_CANCELADOS = new Set(['cancelado']);
const STATUS_OCORRENCIA_ABERTA = new Set(['aberta', 'em_analise']);
const STATUS_EPOD_OK = new Set(['validado']);
const STATUS_EPOD_ATENCAO = new Set(['registrado', 'parcial', 'rejeitado']);

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

const decidirSituacao = ({ frete, ocorrenciasAbertas, epodResumo, faltantes }) => {
  const status = statusTexto(frete.status);
  const ocorrenciaAtraso = ocorrenciasAbertas.find((o) => statusTexto(o.tipo) === 'atraso');
  const ocorrenciaCritica = ocorrenciasAbertas.find((o) => ['avaria', 'recusa', 'extravio', 'divergencia'].includes(statusTexto(o.tipo)));

  if (STATUS_CANCELADOS.has(status)) {
    return {
      nivel: 'informativo',
      situacao: 'Cancelado',
      motivo: 'Viagem cancelada: exibida somente para consulta.',
    };
  }

  if (ocorrenciaAtraso) {
    return {
      nivel: 'critico',
      situacao: 'Atraso registrado',
      motivo: 'Há ocorrência de atraso aberta ou em análise.',
    };
  }

  if (ocorrenciaCritica) {
    return {
      nivel: 'critico',
      situacao: 'Ocorrência crítica',
      motivo: `Há ocorrência de ${ocorrenciaCritica.tipo} aberta ou em análise.`,
    };
  }

  if (ocorrenciasAbertas.length > 0) {
    return {
      nivel: 'atencao',
      situacao: 'Ocorrência aberta',
      motivo: 'Há ocorrência aberta ou em análise.',
    };
  }

  if (STATUS_FINAIS.has(status) && epodResumo.status === 'sem_epod') {
    return {
      nivel: 'informativo',
      situacao: 'Sem comprovante',
      motivo: 'Viagem finalizada sem comprovante de entrega registrado.',
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_ATENCAO.has(epodResumo.status)) {
    return {
      nivel: epodResumo.status === 'rejeitado' ? 'critico' : 'atencao',
      situacao: epodResumo.status === 'rejeitado' ? 'Comprovante recusado' : 'Comprovação pendente',
      motivo: epodResumo.status === 'rejeitado'
        ? 'Comprovante de entrega recusado.'
        : 'Comprovante de entrega aguardando análise.',
    };
  }

  if (STATUS_ATIVOS.has(status) && faltantes.length > 0) {
    return {
      nivel: 'atencao',
      situacao: 'Informações incompletas',
      motivo: `Campos pendentes: ${faltantes.join(', ')}.`,
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_OK.has(epodResumo.status)) {
    return {
      nivel: 'ok',
      situacao: 'Concluído',
      motivo: 'Viagem finalizada com comprovante de entrega aprovado.',
    };
  }

  if (STATUS_ATIVOS.has(status)) {
    return {
      nivel: 'ok',
      situacao: status === 'pendente' ? 'Pendente' : 'Em andamento',
      motivo: status === 'pendente' ? 'Viagem aguardando ativação operacional.' : 'Viagem em andamento, sem alertas.',
    };
  }

  return {
    nivel: 'informativo',
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

function montarTorreControle({ fretes, ocorrencias, epods, evidencias }) {
  const ocorrPorFrete = contarPorFrete(ocorrencias);
  const epodPorFrete = new Map((epods || []).map((e) => [e.frete_id, e]));
  const evidPorFrete = contarPorFrete(evidencias);

  const itens = (fretes || []).map((frete) => {
    const todasOcorrencias = ocorrPorFrete.get(frete.id) || [];
    const ocorrenciasAbertas = todasOcorrencias.filter((o) => STATUS_OCORRENCIA_ABERTA.has(statusTexto(o.status)));
    const faltantes = dadosIncompletos(frete);
    const epod = resumirEpod(epodPorFrete.get(frete.id), evidPorFrete.get(frete.id) || []);
    const status = statusTexto(frete.status);
    epod.sem_comprovacao = STATUS_FINAIS.has(status) && epod.status === 'sem_epod' && !STATUS_CANCELADOS.has(status);
    const decisao = decidirSituacao({ frete, ocorrenciasAbertas, epodResumo: epod, faltantes });

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
      valor_frete: numero(frete.valor_frete),
      nivel: decisao.nivel,
      situacao: decisao.situacao,
      motivo: decisao.motivo,
      dados_incompletos: faltantes,
      ocorrencias: {
        total: todasOcorrencias.length,
        abertas: ocorrenciasAbertas.length,
        atraso_aberto: ocorrenciasAbertas.some((o) => statusTexto(o.tipo) === 'atraso'),
        tipos_abertos: ocorrenciasAbertas.map((o) => o.tipo).filter(Boolean),
      },
      epod,
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
  resumirItensTorre,
  statusTexto,
};

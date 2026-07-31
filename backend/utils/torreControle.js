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
      rotulo: 'Sem comprovacao',
      evidencias_total: 0,
      evidencias_pendentes: 0,
      evidencias_aprovadas: 0,
      evidencias_rejeitadas: 0,
    };
  }

  const lista = evidencias || [];
  return {
    status: statusTexto(epod.status) || 'registrado',
    rotulo: epod.status || 'registrado',
    evidencias_total: lista.length,
    evidencias_pendentes: lista.filter((e) => statusTexto(e.status) === 'pendente').length,
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
      motivo: 'Frete cancelado mantido apenas como informativo operacional.',
    };
  }

  if (ocorrenciaAtraso) {
    return {
      nivel: 'critico',
      situacao: 'Atraso registrado',
      motivo: 'Ha ocorrencia de atraso aberta ou em analise.',
    };
  }

  if (ocorrenciaCritica) {
    return {
      nivel: 'critico',
      situacao: 'Ocorrencia critica',
      motivo: `Ha ocorrencia de ${ocorrenciaCritica.tipo} aberta ou em analise.`,
    };
  }

  if (ocorrenciasAbertas.length > 0) {
    return {
      nivel: 'atencao',
      situacao: 'Ocorrencia aberta',
      motivo: 'Ha ocorrencia aberta ou em analise.',
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_ATENCAO.has(epodResumo.status)) {
    return {
      nivel: epodResumo.status === 'rejeitado' ? 'critico' : 'atencao',
      situacao: epodResumo.status === 'rejeitado' ? 'ePOD rejeitado' : 'ePOD pendente',
      motivo: epodResumo.status === 'rejeitado'
        ? 'Comprovacao de entrega rejeitada.'
        : 'Frete finalizado sem ePOD validado.',
    };
  }

  if (STATUS_ATIVOS.has(status) && faltantes.length > 0) {
    return {
      nivel: 'atencao',
      situacao: 'Dados incompletos',
      motivo: `Campos pendentes: ${faltantes.join(', ')}.`,
    };
  }

  if (STATUS_FINAIS.has(status) && STATUS_EPOD_OK.has(epodResumo.status)) {
    return {
      nivel: 'ok',
      situacao: 'Concluido',
      motivo: 'Frete finalizado com ePOD validado.',
    };
  }

  if (STATUS_ATIVOS.has(status)) {
    return {
      nivel: 'ok',
      situacao: status === 'pendente' ? 'Pendente' : 'Em andamento',
      motivo: status === 'pendente' ? 'Frete aguardando ativacao operacional.' : 'Frete ativo sem alerta aberto.',
    };
  }

  return {
    nivel: 'informativo',
    situacao: frete.status || 'Status nao informado',
    motivo: 'Status sem regra de alerta especifica.',
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

  const resumo = {
    fretes_total: itens.length,
    criticos: itens.filter((i) => i.nivel === 'critico').length,
    atencao: itens.filter((i) => i.nivel === 'atencao').length,
    ok: itens.filter((i) => i.nivel === 'ok').length,
    informativos: itens.filter((i) => i.nivel === 'informativo').length,
    em_andamento: itens.filter((i) => STATUS_ATIVOS.has(statusTexto(i.status))).length,
    finalizados: itens.filter((i) => STATUS_FINAIS.has(statusTexto(i.status))).length,
    cancelados: itens.filter((i) => STATUS_CANCELADOS.has(statusTexto(i.status))).length,
    ocorrencias_abertas: itens.reduce((acc, i) => acc + i.ocorrencias.abertas, 0),
    epods_pendentes: itens.filter((i) => STATUS_FINAIS.has(statusTexto(i.status)) && i.epod.status !== 'validado').length,
    dados_incompletos: itens.filter((i) => i.dados_incompletos.length > 0).length,
  };

  return { resumo, itens };
}

module.exports = {
  montarTorreControle,
  statusTexto,
};

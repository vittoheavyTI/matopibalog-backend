// Domínio PURO da lista administrativa (cross-tenant) de contratos comerciais.
//
// Macrofrente 3A-1 — Núcleo Comercial e Contratual (seção 18: "Lista de Clientes
// com Contrato"). Até aqui o painel só tinha o DETALHE por empresa
// (/painel-admin/empresas/:id/contratacao). Faltava a visão agregada do
// super-admin: todos os contratos de todos os clientes, com filtros.
//
// Este módulo NÃO fala com banco: recebe as linhas já carregadas (contrato +
// joins de empresa e proposta) e devolve a lista canônica + resumo. Por ser puro,
// é exaustivamente testável e a regra de "assinado?"/filtros vive em UM lugar só.
//
// Reusa STATUS_CONCLUIDOS do gate de contrato — a definição de "assinado" é a
// MESMA usada pela autoridade comercial; não reinventamos vocabulário (seção 5).

const { STATUS_CONCLUIDOS } = require('./contratoGateService');

// Contrato considerado ASSINADO/concluído: mesma regra do gate comercial.
function estaAssinado(status) {
  return STATUS_CONCLUIDOS.has(status);
}

// Hash curto para exibição na tabela (o hash completo continua disponível no item).
function hashCurto(hash) {
  if (!hash || typeof hash !== 'string') return null;
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}

function toISO(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizarTexto(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// Mapeia UMA linha crua (contrato + joins) para o item da lista.
// A linha esperada:
//   { id, empresa_id, status, obrigatorio, template_version, content_hash,
//     signed_file_hash, provider, signature_method, criado_em, atualizado_em,
//     aceito_em, document_fechado_em,
//     empresas: { nome, tipo } | null,
//     propostas_comerciais: { snapshot, valor_mensal, valor_implantacao } | null,
//     contrato_signatarios: [{ papel, status, assinado_em }] }
function mapearContratoParaLista(row = {}) {
  const empresa = row.empresas || {};
  const proposta = row.propostas_comerciais || {};
  const snapshot = proposta.snapshot || {};
  const signatarios = Array.isArray(row.contrato_signatarios) ? row.contrato_signatarios : [];
  const clienteSig = signatarios.find((s) => s && s.papel === 'cliente') || null;
  const matopibaSig = signatarios.find((s) => s && s.papel === 'matopiba') || null;

  const valorMensal = proposta.valor_mensal != null
    ? Number(proposta.valor_mensal)
    : (snapshot.valor_mensal != null ? Number(snapshot.valor_mensal) : null);
  const valorImplantacao = proposta.valor_implantacao != null
    ? Number(proposta.valor_implantacao)
    : (snapshot.valor_implantacao != null ? Number(snapshot.valor_implantacao) : null);

  return {
    contrato_id: row.id || null,
    empresa_id: row.empresa_id || null,
    cliente: empresa.nome || snapshot.empresa_nome || null,
    empresa_tipo: empresa.tipo || null,
    plano_nome: snapshot.plano_nome || null,
    valor_mensal: Number.isFinite(valorMensal) ? valorMensal : null,
    valor_implantacao: Number.isFinite(valorImplantacao) ? valorImplantacao : null,
    status: row.status || null,
    obrigatorio: row.obrigatorio === true,
    assinado: estaAssinado(row.status),
    versao: row.template_version || null,
    hash: row.content_hash || null,
    hash_curto: hashCurto(row.content_hash),
    signed_file_hash: row.signed_file_hash || null,
    metodo_assinatura: row.signature_method || row.provider || 'manual',
    criado_em: toISO(row.criado_em),
    disponibilizado_em: toISO(row.document_fechado_em),
    assinado_em: toISO(row.aceito_em || (clienteSig && clienteSig.assinado_em) || null),
    assinatura_cliente_em: toISO(clienteSig && clienteSig.assinado_em),
    assinatura_matopiba_em: toISO(matopibaSig && matopibaSig.assinado_em),
  };
}

// Aplica os filtros do painel. Tudo opcional; ausência de filtro = não filtra.
//   filtros.status  : 'todos' | 'assinado' | 'pendente' | <status canônico exato>
//   filtros.plano   : substring do nome do plano (case-insensitive)
//   filtros.cliente : substring do nome do cliente OU empresa_id
//   filtros.de/ate  : intervalo (ISO/date) sobre criado_em (inclusivo)
function filtrarLista(lista, filtros = {}) {
  let out = Array.isArray(lista) ? lista.slice() : [];

  const status = normalizarTexto(filtros.status);
  if (status && status !== 'todos') {
    if (status === 'assinado' || status === 'assinados') {
      out = out.filter((c) => c.assinado);
    } else if (status === 'pendente' || status === 'pendentes') {
      out = out.filter((c) => !c.assinado && c.status !== 'cancelado');
    } else {
      out = out.filter((c) => normalizarTexto(c.status) === status);
    }
  }

  const plano = normalizarTexto(filtros.plano);
  if (plano) out = out.filter((c) => normalizarTexto(c.plano_nome).includes(plano));

  const cliente = normalizarTexto(filtros.cliente);
  if (cliente) {
    out = out.filter((c) => normalizarTexto(c.cliente).includes(cliente)
      || normalizarTexto(c.empresa_id).includes(cliente));
  }

  const de = filtros.de ? new Date(filtros.de) : null;
  if (de && !Number.isNaN(de.getTime())) {
    out = out.filter((c) => c.criado_em && new Date(c.criado_em).getTime() >= de.getTime());
  }
  const ate = filtros.ate ? new Date(filtros.ate) : null;
  if (ate && !Number.isNaN(ate.getTime())) {
    out = out.filter((c) => c.criado_em && new Date(c.criado_em).getTime() <= ate.getTime());
  }

  return out;
}

function resumirPorStatus(lista) {
  const resumo = { total: lista.length, assinados: 0, pendentes: 0, cancelados: 0, obrigatorios_pendentes: 0 };
  for (const c of lista) {
    if (c.assinado) {
      resumo.assinados += 1;
    } else if (c.status === 'cancelado') {
      resumo.cancelados += 1;
    } else {
      resumo.pendentes += 1;
      if (c.obrigatorio) resumo.obrigatorios_pendentes += 1;
    }
  }
  return resumo;
}

// Ponto de entrada: recebe as linhas cruas + filtros, devolve lista ordenada
// (mais recentes primeiro), resumo por status e total sem filtro.
function montarListaContratos({ rows = [], filtros = {} } = {}) {
  const mapeados = (Array.isArray(rows) ? rows : []).map(mapearContratoParaLista);
  mapeados.sort((a, b) => {
    const ta = a.criado_em ? new Date(a.criado_em).getTime() : -Infinity;
    const tb = b.criado_em ? new Date(b.criado_em).getTime() : -Infinity;
    return tb - ta;
  });
  const filtrada = filtrarLista(mapeados, filtros);
  return {
    contratos: filtrada,
    resumo: resumirPorStatus(filtrada),
    total_sem_filtro: mapeados.length,
  };
}

module.exports = {
  estaAssinado,
  hashCurto,
  mapearContratoParaLista,
  filtrarLista,
  resumirPorStatus,
  montarListaContratos,
};

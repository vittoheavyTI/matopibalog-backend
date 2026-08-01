const crypto = require('crypto');

const TEMPLATE_VERSION = 'comercial-v1-tecnico';

const STATUS_PROPOSTA = Object.freeze({
  RASCUNHO: 'rascunho',
  ENVIADA: 'enviada',
  ACEITA: 'aceita',
  CANCELADA: 'cancelada',
  EXPIRADA: 'expirada',
});

const STATUS_CONTRATO = Object.freeze({
  RASCUNHO: 'rascunho',
  AGUARDANDO_ASSINATURA: 'aguardando_assinatura',
  ASSINADO: 'assinado',
  ACEITO_MANUALMENTE: 'aceito_manualmente',
  CANCELADO: 'cancelado',
});

function paraCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return { ok: true, centavos: 0 };
  if (typeof valor === 'string' && !/^\d+([.,]\d{1,2})?$/.test(valor.trim())) {
    return { ok: false, motivo: 'valor_invalido' };
  }
  const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
  if (!Number.isFinite(n) || n < 0) return { ok: false, motivo: 'valor_invalido' };
  const partes = String(valor).replace(',', '.').split('.');
  if (partes[1] && partes[1].length > 2) return { ok: false, motivo: 'valor_invalido' };
  return { ok: true, centavos: Math.round(n * 100) };
}

function deCentavos(centavos) {
  return Number((centavos / 100).toFixed(2));
}

function planoEhNegociacao(plano) {
  return plano?.requer_negociacao === true;
}

function normalizarImplantacao({ plano, overrideValor, overrideMotivo, overridePor } = {}) {
  const base = overrideValor !== undefined && overrideValor !== null
    ? overrideValor
    : (plano?.valor_implantacao ?? 0);
  const parsed = paraCentavos(base);
  if (!parsed.ok) return { ok: false, motivo: 'implantacao_valor_invalido' };

  const houveOverride = overrideValor !== undefined && overrideValor !== null;
  if (houveOverride && String(overrideMotivo || '').trim().length < 8) {
    return { ok: false, motivo: 'implantacao_override_sem_motivo' };
  }

  return {
    ok: true,
    valor: deCentavos(parsed.centavos),
    centavos: parsed.centavos,
    gratis: parsed.centavos === 0,
    rotulo: parsed.centavos === 0 ? 'Implantacao gratis' : `Implantacao R$ ${deCentavos(parsed.centavos).toFixed(2)}`,
    override: houveOverride,
    override_motivo: houveOverride ? String(overrideMotivo).trim() : null,
    override_por: houveOverride ? (overridePor || null) : null,
  };
}

function montarSnapshotProposta({
  plano,
  quantidadeContratada,
  trialDias,
  origem = 'cadastro_publico',
  overrideImplantacaoValor,
  overrideImplantacaoMotivo,
  overridePor,
} = {}) {
  if (!plano || !plano.id) return { ok: false, motivo: 'plano_ausente' };
  if (planoEhNegociacao(plano)) return { ok: false, motivo: 'plano_sob_proposta' };

  const mensalidade = paraCentavos(plano.preco_mensal);
  if (!mensalidade.ok || mensalidade.centavos <= 0) return { ok: false, motivo: 'mensalidade_invalida' };

  const implantacao = normalizarImplantacao({
    plano,
    overrideValor: overrideImplantacaoValor,
    overrideMotivo: overrideImplantacaoMotivo,
    overridePor,
  });
  if (!implantacao.ok) return implantacao;

  const qtd = quantidadeContratada != null ? Number(quantidadeContratada) : Number(plano.capacidade_inclusa || plano.limite_motoristas || 1);
  if (!Number.isInteger(qtd) || qtd < 1) return { ok: false, motivo: 'quantidade_invalida' };

  const trial = trialDias != null ? Number(trialDias) : Number(plano.dias_trial || 0);
  if (!Number.isInteger(trial) || trial < 0) return { ok: false, motivo: 'trial_invalido' };

  const totalInicialCentavos = implantacao.centavos;

  return {
    ok: true,
    proposta: {
      template_version: TEMPLATE_VERSION,
      origem,
      plano_id: plano.id,
      plano_nome: plano.nome || null,
      quantidade_contratada: qtd,
      capacidade_inclusa: plano.capacidade_inclusa != null ? Number(plano.capacidade_inclusa) : null,
      preco_motorista_extra: plano.preco_motorista_extra != null ? Number(plano.preco_motorista_extra) : null,
      valor_mensal: deCentavos(mensalidade.centavos),
      valor_implantacao: implantacao.valor,
      implantacao_gratis: implantacao.gratis,
      implantacao_rotulo: implantacao.rotulo,
      implantacao_override: implantacao.override,
      implantacao_override_motivo: implantacao.override_motivo,
      implantacao_override_por: implantacao.override_por,
      total_inicial: deCentavos(totalInicialCentavos),
      trial_dias: trial,
      recorrencia: 'mensal',
      cobranca_implantacao: implantacao.gratis ? 'nao_criar_fatura_zero' : 'cobranca_avulsa_separada',
    },
  };
}

function hashConteudo(conteudo) {
  return crypto.createHash('sha256').update(String(conteudo), 'utf8').digest('hex');
}

function montarTextoContratoTecnico({ empresa = {}, responsavel = {}, proposta }) {
  const p = proposta || {};
  return [
    `Contrato tecnico Matopiba Log - ${TEMPLATE_VERSION}`,
    '',
    'Este arquivo registra os dados comerciais aceitos. O texto juridico definitivo deve ser fornecido ou revisado pelo proprietario e advogado.',
    '',
    `Empresa: ${empresa.nome || 'Nao informado'}`,
    `Responsavel: ${responsavel.nome || 'Nao informado'}`,
    `Plano: ${p.plano_nome || 'Nao informado'}`,
    `Quantidade contratada: ${p.quantidade_contratada || 0}`,
    `Mensalidade: R$ ${Number(p.valor_mensal || 0).toFixed(2)}`,
    `Implantacao: ${p.implantacao_gratis ? 'Implantacao gratis' : `R$ ${Number(p.valor_implantacao || 0).toFixed(2)}`}`,
    `Total inicial: R$ ${Number(p.total_inicial || 0).toFixed(2)}`,
    `Trial: ${Number(p.trial_dias || 0)} dias`,
    '',
    'A cobranca de implantacao, quando positiva e autorizada, e avulsa e separada da mensalidade.',
  ].join('\n');
}

function montarContratoTecnico({ empresa, responsavel, proposta }) {
  const conteudo = montarTextoContratoTecnico({ empresa, responsavel, proposta });
  return {
    template_version: TEMPLATE_VERSION,
    conteudo,
    content_hash: hashConteudo(conteudo),
    provider: 'manual',
    status: STATUS_CONTRATO.RASCUNHO,
  };
}

function deveCriarFaturaImplantacao(proposta) {
  const valor = Number(proposta?.valor_implantacao || 0);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { criar: false, motivo: 'implantacao_gratis_ou_zero' };
  }
  return { criar: true, motivo: 'implantacao_positiva_autorizada', valor };
}

module.exports = {
  TEMPLATE_VERSION,
  STATUS_PROPOSTA,
  STATUS_CONTRATO,
  paraCentavos,
  normalizarImplantacao,
  montarSnapshotProposta,
  montarTextoContratoTecnico,
  montarContratoTecnico,
  hashConteudo,
  deveCriarFaturaImplantacao,
};

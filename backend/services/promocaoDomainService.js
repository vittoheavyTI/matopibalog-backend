// backend/services/promocaoDomainService.js
// MEGA-FRENTE Billing Comercial Avançado — FASE 5: regras PURAS do motor de
// PROMOÇÕES / TICKETS. Sem I/O: não toca banco, não fala com o Asaas, não cria
// fatura — mesmo estilo testável dos outros *DomainService. A rota (super-admin
// e cadastro/checkout) faz as leituras/escritas e consome estas decisões.
//
// O QUE ESTE MÓDULO DECIDE
//   * avaliarResgate  → um código/campanha pode ser aplicado a esta empresa AGORA?
//                       (janela, ativo, limites, uso único, plano-alvo; o manual
//                       do super-admin fura janela/ativo, mas NÃO os limites);
//   * aplicarPromocao → qual o preço FINAL (mensalidade/implantação/trial) depois
//                       do desconto — em CENTAVOS INTEIROS (reaproveita paraCentavos);
//   * montarResgate   → a linha de auditoria (preço original/final, desconto,
//                       quem aplicou, empresa, motivo) para promocao_resgates.
//
// DECISÕES DE PRODUTO (do prompt — não reinterpretar)
//   * super-admin pode aplicar MANUALMENTE mesmo após o fim da campanha;
//   * uso único por empresa (quando a campanha marca), limite de usos total e por
//     código, plano-alvo opcional (NULL = todos);
//   * desconto de mensalidade (% ou fixo), desconto/isenção de implantação, trial
//     estendido e preço promocional por período.

const { paraCentavos } = require('./planoPrecoService');

const TIPOS = Object.freeze([
  'desconto_percentual_mensalidade',
  'desconto_fixo_mensalidade',
  'desconto_percentual_implantacao',
  'desconto_fixo_implantacao',
  'isencao_implantacao',
  'trial_estendido',
  'preco_promocional',
]);

const ALVO = Object.freeze({ MENSALIDADE: 'mensalidade', IMPLANTACAO: 'implantacao', TRIAL: 'trial' });

const MOTIVOS = Object.freeze({
  OK: 'ok',
  PROMOCAO_AUSENTE: 'promocao_ausente',
  INATIVA: 'promocao_inativa',
  NAO_INICIADA: 'promocao_nao_iniciada',
  EXPIRADA: 'promocao_expirada',
  CODIGO_AUSENTE: 'codigo_ausente',
  CODIGO_INATIVO: 'codigo_inativo',
  CODIGO_ESGOTADO: 'codigo_esgotado',
  ESGOTADA: 'promocao_esgotada',
  JA_UTILIZADA_EMPRESA: 'ja_utilizada_pela_empresa',
  PLANO_NAO_ELEGIVEL: 'plano_nao_elegivel',
  TIPO_INVALIDO: 'tipo_invalido',
  CONFIG_INVALIDA: 'config_invalida',
  BASE_INVALIDA: 'base_invalida',
});

function falha(motivo, message) {
  return { ok: false, motivo, message };
}

// Normaliza código para comparação (MAIÚSCULAS, sem espaços de borda). O índice
// único do banco é em upper(codigo) — a app tem de bater com isso.
function normalizarCodigo(codigo) {
  if (codigo === undefined || codigo === null) return '';
  return String(codigo).trim().toUpperCase();
}

function paraData(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'string' || typeof valor === 'number') {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Decide se a promoção pode ser aplicada à empresa AGORA.
// Retorna { ok, motivo, message }.
//
// Parâmetros:
//   promocao         → linha de `promocoes`
//   codigoRegistro   → linha de `promocao_codigos` | null (manual pode ser sem código)
//   empresa          → { id }
//   planoEscolhidoId → plano que a empresa vai contratar (para o alvo)
//   resgatesDaEmpresa→ resgates já feitos por esta empresa NESTA promoção
//   agora            → Date
//   manual           → true quando é aplicação manual do super-admin
function avaliarResgate({
  promocao,
  codigoRegistro = null,
  empresa,
  planoEscolhidoId = null,
  resgatesDaEmpresa = [],
  agora = new Date(),
  manual = false,
} = {}) {
  if (!promocao || !promocao.id) return falha(MOTIVOS.PROMOCAO_AUSENTE, 'Promoção não encontrada.');
  if (!empresa || !empresa.id) return falha(MOTIVOS.PROMOCAO_AUSENTE, 'Empresa não identificada.');

  // Janela e ativo: o manual do super-admin fura os dois (aplicar após a campanha
  // é justamente o caso de uso). O automático (cadastro/checkout) respeita ambos.
  if (!manual) {
    if (promocao.ativo === false) return falha(MOTIVOS.INATIVA, 'Esta promoção não está ativa.');
    const agoraD = paraData(agora) || new Date();
    const inicio = paraData(promocao.data_inicio);
    const fim = paraData(promocao.data_fim);
    if (inicio && agoraD < inicio) return falha(MOTIVOS.NAO_INICIADA, 'Esta promoção ainda não começou.');
    if (fim && agoraD > fim) return falha(MOTIVOS.EXPIRADA, 'Esta promoção expirou.');

    // No fluxo automático por código, o código precisa existir e estar válido.
    if (codigoRegistro !== null) {
      if (!codigoRegistro || !codigoRegistro.id) return falha(MOTIVOS.CODIGO_AUSENTE, 'Código promocional inválido.');
      if (codigoRegistro.ativo === false) return falha(MOTIVOS.CODIGO_INATIVO, 'Código promocional desativado.');
    }
  }

  // Limite por código (vale também no manual, se um código foi usado).
  if (codigoRegistro && codigoRegistro.limite_usos != null) {
    const usos = Number(codigoRegistro.usos) || 0;
    if (usos >= Number(codigoRegistro.limite_usos)) {
      return falha(MOTIVOS.CODIGO_ESGOTADO, 'Este código já atingiu o limite de usos.');
    }
  }

  // Limite total da campanha.
  if (promocao.limite_usos_total != null) {
    const usosTotal = Number(promocao.usos_total) || 0;
    if (usosTotal >= Number(promocao.limite_usos_total)) {
      return falha(MOTIVOS.ESGOTADA, 'Esta promoção já atingiu o limite de usos.');
    }
  }

  // Uso único por empresa.
  if (promocao.uso_unico_por_empresa === true && Array.isArray(resgatesDaEmpresa) && resgatesDaEmpresa.length > 0) {
    return falha(MOTIVOS.JA_UTILIZADA_EMPRESA, 'Esta promoção já foi utilizada por esta empresa.');
  }

  // Plano-alvo (NULL = todos).
  if (promocao.plano_alvo_id != null && planoEscolhidoId !== promocao.plano_alvo_id) {
    return falha(MOTIVOS.PLANO_NAO_ELEGIVEL, 'Esta promoção não vale para o plano selecionado.');
  }

  return { ok: true, motivo: MOTIVOS.OK, message: null };
}

// Aplica desconto percentual em centavos, arredondando o DESCONTO ao centavo
// (nunca o preço). preco_centavos - desconto = final. Garante final >= 0.
function aplicarPercentual(precoCentavos, percentual) {
  const pct = Number(percentual);
  const descontoCentavos = Math.round((precoCentavos * pct) / 100);
  const finalCentavos = Math.max(0, precoCentavos - descontoCentavos);
  return { finalCentavos, descontoCentavos: precoCentavos - finalCentavos };
}

// Calcula o efeito da promoção sobre os preços base. Tudo em centavos inteiros.
// Retorna { ok, alvo, mensalidade_final, implantacao_final, trial_dias_final,
//           desconto_mensalidade, desconto_implantacao } (valores em reais).
//
// Bases: precoMensalidade e valorImplantacao em reais; trialDiasBase inteiro.
// Campos não afetados voltam iguais à base (ou null se a base não foi informada).
function aplicarPromocao({ promocao, precoMensalidade = null, valorImplantacao = null, trialDiasBase = null } = {}) {
  const p = promocao || {};
  if (!TIPOS.includes(p.tipo)) return falha(MOTIVOS.TIPO_INVALIDO, 'Tipo de promoção inválido.');

  // Bases em centavos (quando informadas).
  let mensCent = null;
  if (precoMensalidade != null) {
    const c = paraCentavos(precoMensalidade);
    if (!c.ok || c.centavos < 0) return falha(MOTIVOS.BASE_INVALIDA, 'Preço de mensalidade base inválido.');
    mensCent = c.centavos;
  }
  let implCent = null;
  if (valorImplantacao != null) {
    const c = paraCentavos(valorImplantacao);
    if (!c.ok || c.centavos < 0) return falha(MOTIVOS.BASE_INVALIDA, 'Valor de implantação base inválido.');
    implCent = c.centavos;
  }

  const out = {
    ok: true,
    alvo: null,
    mensalidade_final: mensCent != null ? mensCent / 100 : null,
    implantacao_final: implCent != null ? implCent / 100 : null,
    trial_dias_final: trialDiasBase != null ? Number(trialDiasBase) : null,
    desconto_mensalidade: 0,
    desconto_implantacao: 0,
  };

  switch (p.tipo) {
    case 'desconto_percentual_mensalidade': {
      if (p.percentual == null) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem percentual configurado.');
      if (mensCent == null) return falha(MOTIVOS.BASE_INVALIDA, 'Mensalidade base necessária para este desconto.');
      const r = aplicarPercentual(mensCent, p.percentual);
      out.alvo = ALVO.MENSALIDADE;
      out.mensalidade_final = r.finalCentavos / 100;
      out.desconto_mensalidade = r.descontoCentavos / 100;
      break;
    }
    case 'desconto_fixo_mensalidade': {
      const c = paraCentavos(p.valor);
      if (!c.ok || c.centavos <= 0) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem valor de desconto válido.');
      if (mensCent == null) return falha(MOTIVOS.BASE_INVALIDA, 'Mensalidade base necessária para este desconto.');
      const finalCent = Math.max(0, mensCent - c.centavos);
      out.alvo = ALVO.MENSALIDADE;
      out.mensalidade_final = finalCent / 100;
      out.desconto_mensalidade = (mensCent - finalCent) / 100;
      break;
    }
    case 'preco_promocional': {
      const c = paraCentavos(p.valor);
      if (!c.ok || c.centavos < 0) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem preço promocional válido.');
      out.alvo = ALVO.MENSALIDADE;
      out.mensalidade_final = c.centavos / 100;
      out.desconto_mensalidade = mensCent != null ? Math.max(0, mensCent - c.centavos) / 100 : 0;
      break;
    }
    case 'desconto_percentual_implantacao': {
      if (p.percentual == null) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem percentual configurado.');
      if (implCent == null) return falha(MOTIVOS.BASE_INVALIDA, 'Valor de implantação base necessário.');
      const r = aplicarPercentual(implCent, p.percentual);
      out.alvo = ALVO.IMPLANTACAO;
      out.implantacao_final = r.finalCentavos / 100;
      out.desconto_implantacao = r.descontoCentavos / 100;
      break;
    }
    case 'desconto_fixo_implantacao': {
      const c = paraCentavos(p.valor);
      if (!c.ok || c.centavos <= 0) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem valor de desconto válido.');
      if (implCent == null) return falha(MOTIVOS.BASE_INVALIDA, 'Valor de implantação base necessário.');
      const finalCent = Math.max(0, implCent - c.centavos);
      out.alvo = ALVO.IMPLANTACAO;
      out.implantacao_final = finalCent / 100;
      out.desconto_implantacao = (implCent - finalCent) / 100;
      break;
    }
    case 'isencao_implantacao': {
      if (implCent == null) return falha(MOTIVOS.BASE_INVALIDA, 'Valor de implantação base necessário.');
      out.alvo = ALVO.IMPLANTACAO;
      out.implantacao_final = 0;
      out.desconto_implantacao = implCent / 100;
      break;
    }
    case 'trial_estendido': {
      const dias = Number(p.dias_trial_extra);
      if (!Number.isInteger(dias) || dias <= 0) return falha(MOTIVOS.CONFIG_INVALIDA, 'Promoção sem dias de trial extra válidos.');
      out.alvo = ALVO.TRIAL;
      out.trial_dias_final = (trialDiasBase != null ? Number(trialDiasBase) : 0) + dias;
      break;
    }
    default:
      return falha(MOTIVOS.TIPO_INVALIDO, 'Tipo de promoção inválido.');
  }

  return out;
}

// Monta a linha de auditoria para promocao_resgates. `efeito` é a saída de
// aplicarPromocao. Congela preço original/final e desconto conforme o alvo.
function montarResgate({ promocao, codigoRegistro = null, empresa, aplicadoPor = null, manual = false, efeito, motivo = null, faturaId = null, precoOriginal = null }) {
  const alvo = efeito && efeito.alvo ? efeito.alvo : null;
  let preco_original = precoOriginal;
  let preco_final = null;
  let desconto_valor = null;
  if (efeito) {
    if (alvo === ALVO.MENSALIDADE) {
      preco_final = efeito.mensalidade_final;
      desconto_valor = efeito.desconto_mensalidade;
    } else if (alvo === ALVO.IMPLANTACAO) {
      preco_final = efeito.implantacao_final;
      desconto_valor = efeito.desconto_implantacao;
    }
  }
  return {
    promocao_id: promocao && promocao.id ? promocao.id : null,
    codigo_id: codigoRegistro && codigoRegistro.id ? codigoRegistro.id : null,
    empresa_id: empresa && empresa.id ? empresa.id : null,
    aplicado_por: aplicadoPor || null,
    manual: manual === true,
    alvo,
    preco_original: preco_original != null ? Number(preco_original) : null,
    preco_final: preco_final != null ? Number(preco_final) : null,
    desconto_valor: desconto_valor != null ? Number(desconto_valor) : null,
    motivo: motivo != null ? String(motivo) : null,
    fatura_id: faturaId || null,
  };
}

module.exports = {
  TIPOS,
  ALVO,
  MOTIVOS,
  normalizarCodigo,
  avaliarResgate,
  aplicarPromocao,
  montarResgate,
};

const { calcularValorToneladaKm, normalizarModalidade } = require('../utils/calculoFrete');
const { validarLimitesFrete } = require('../utils/limitesFrete');

const CAMPOS_FINANCEIROS_FRETE = Object.freeze([
  'modalidade_calculo',
  'toneladas',
  'valor_tonelada_km',
  'valor_frete',
  'km_inicial',
  'km_final',
]);

const STATUS_OPERACIONAIS_CORRECAO = Object.freeze(['ativo', 'pendente']);
const STATUS_TRAVADOS_CORRECAO = Object.freeze(['finalizado', 'cancelado']);

const presente = (v) => v !== undefined && v !== null && v !== '';
const numeroOuNull = (v) => (presente(v) ? Number(v) : null);

const snapshotFinanceiroFrete = (frete) => ({
  modalidade_calculo: frete?.modalidade_calculo ?? null,
  toneladas: frete?.toneladas ?? null,
  valor_tonelada_km: frete?.valor_tonelada_km ?? null,
  valor_frete: frete?.valor_frete ?? null,
  km_inicial: frete?.km_inicial ?? null,
  km_final: frete?.km_final ?? null,
  status: frete?.status ?? null,
});

function validarStatusCorrecaoFinanceira(status) {
  if (STATUS_OPERACIONAIS_CORRECAO.includes(status)) return { ok: true };
  if (STATUS_TRAVADOS_CORRECAO.includes(status)) {
    return {
      ok: false,
      error: 'frete_financial_correction_status_locked',
      message: 'Fretes finalizados ou cancelados ficam em modo historico/read-only para correcao financeira.',
    };
  }
  return {
    ok: false,
    error: 'frete_financial_correction_status_unknown',
    message: 'Status do frete nao e elegivel para correcao financeira neste fluxo.',
  };
}

function prepararCorrecaoFinanceira({ freteAtual, campos }) {
  const status = validarStatusCorrecaoFinanceira(freteAtual?.status);
  if (!status.ok) return status;

  const chaves = Object.keys(campos || {});
  if (chaves.length === 0) {
    return { ok: false, error: 'frete_financial_correction_empty', message: 'Informe ao menos um campo financeiro para corrigir.' };
  }

  const naoPermitidos = chaves.filter((c) => !CAMPOS_FINANCEIROS_FRETE.includes(c));
  if (naoPermitidos.length > 0) {
    return {
      ok: false,
      error: 'frete_financial_correction_field_not_allowed',
      field: naoPermitidos[0],
      message: 'Campo nao permitido para correcao financeira.',
    };
  }

  const efetivo = {
    modalidade_calculo: freteAtual.modalidade_calculo ?? 'valor_fixo',
    toneladas: freteAtual.toneladas,
    valor_tonelada_km: freteAtual.valor_tonelada_km,
    valor_frete: freteAtual.valor_frete,
    km_inicial: freteAtual.km_inicial,
    km_final: freteAtual.km_final,
  };

  const patch = {};
  if ('modalidade_calculo' in campos) {
    const modalidade = normalizarModalidade(campos.modalidade_calculo);
    if (!modalidade) {
      return { ok: false, error: 'frete_financial_correction_invalid_modality', field: 'modalidade_calculo', message: 'Modalidade de calculo invalida.' };
    }
    efetivo.modalidade_calculo = modalidade;
    patch.modalidade_calculo = modalidade;
  }

  for (const campo of ['toneladas', 'valor_tonelada_km', 'valor_frete', 'km_inicial', 'km_final']) {
    if (campo in campos) {
      const n = numeroOuNull(campos[campo]);
      if (n !== null && !Number.isFinite(n)) {
        return { ok: false, error: 'frete_financial_correction_invalid_number', field: campo, message: 'Valor numerico invalido.' };
      }
      efetivo[campo] = n;
      patch[campo] = n;
    }
  }

  if (efetivo.modalidade_calculo === 'tonelada_km') {
    if ('valor_frete' in campos) {
      return {
        ok: false,
        error: 'frete_financial_correction_value_is_derived',
        field: 'valor_frete',
        message: 'Em fretes por tonelada/km, valor_frete e derivado dos insumos e nao deve ser digitado manualmente.',
      };
    }
    const calc = calcularValorToneladaKm({
      toneladas: efetivo.toneladas,
      valorToneladaKm: efetivo.valor_tonelada_km,
      kmInicial: efetivo.km_inicial,
      kmFinal: efetivo.km_final,
    });
    patch.valor_frete = calc !== null ? calc : 0;
    efetivo.valor_frete = patch.valor_frete;
  } else {
    patch.toneladas = null;
    patch.valor_tonelada_km = null;
    efetivo.toneladas = null;
    efetivo.valor_tonelada_km = null;
  }

  const limite = validarLimitesFrete({
    modalidade: efetivo.modalidade_calculo,
    valorFrete: efetivo.valor_frete,
    toneladas: efetivo.toneladas,
    valorToneladaKm: efetivo.valor_tonelada_km,
    kmInicial: efetivo.km_inicial,
    kmFinal: efetivo.km_final,
  });
  if (!limite.ok) {
    return {
      ok: false,
      error: 'frete_operational_limit',
      field: limite.campo,
      current_value: limite.valorAtual,
      max_value: limite.limiteValor,
      limit: limite.limite,
      message: limite.message,
    };
  }

  return {
    ok: true,
    patch,
    before_snapshot: snapshotFinanceiroFrete(freteAtual),
    after_preview: snapshotFinanceiroFrete({ ...freteAtual, ...patch }),
  };
}

function contemCampoFinanceiro(payload = {}) {
  return CAMPOS_FINANCEIROS_FRETE.some((campo) => Object.prototype.hasOwnProperty.call(payload, campo));
}

module.exports = {
  CAMPOS_FINANCEIROS_FRETE,
  STATUS_OPERACIONAIS_CORRECAO,
  STATUS_TRAVADOS_CORRECAO,
  snapshotFinanceiroFrete,
  validarStatusCorrecaoFinanceira,
  prepararCorrecaoFinanceira,
  contemCampoFinanceiro,
};

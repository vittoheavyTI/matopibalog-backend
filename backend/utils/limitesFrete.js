// Limites de sanidade operacional do frete. Nao sao regra comercial final:
// impedem erro de digitacao ou dado legado absurdo de contaminar dashboards,
// relatorios e agregados financeiros.

const VALOR_TONELADA_KM_MAX = 10; // R$ por tonelada/km.
const TONELADAS_MAX = 100; // toneladas por frete.
const VALOR_FRETE_MAX = 1000000; // R$ por frete, fixo ou derivado.

// Mensagem legada mantida exportada para compatibilidade.
const MSG_LIMITE = 'Valor fora dos limites operacionais. Confira toneladas, KM e valor por tonelada-km.';

const presente = (v) => v !== null && v !== undefined && v !== '';

const fmt = (valor, casas = 2) => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  });
};

const falha = ({ campo, message, valorAtual, limite }) => ({
  ok: false,
  campo,
  valorAtual,
  limite,
  message,
});

const validarLimitesFrete = ({ modalidade, valorFrete, toneladas, valorToneladaKm, kmInicial, kmFinal } = {}) => {
  if (presente(toneladas)) {
    const t = Number(toneladas);
    if (!Number.isFinite(t) || t <= 0) {
      return falha({
        campo: 'toneladas',
        valorAtual: toneladas,
        limite: `maior que 0 e ate ${TONELADAS_MAX} t`,
        message: `As toneladas informadas estao invalidas. Valor atual: ${fmt(toneladas, 3)}. Revise o campo Toneladas antes de continuar.`,
      });
    }
    if (t > TONELADAS_MAX) {
      return falha({
        campo: 'toneladas',
        valorAtual: t,
        limite: `ate ${TONELADAS_MAX} t`,
        message: `As toneladas informadas estao fora do limite permitido. Valor atual: ${fmt(t, 3)} t; limite: ${TONELADAS_MAX} t. Revise o campo Toneladas antes de continuar.`,
      });
    }
  }

  if (presente(valorToneladaKm)) {
    const v = Number(valorToneladaKm);
    if (!Number.isFinite(v) || v <= 0) {
      return falha({
        campo: 'valor_tonelada_km',
        valorAtual: valorToneladaKm,
        limite: `maior que 0 e ate R$ ${fmt(VALOR_TONELADA_KM_MAX)}`,
        message: `O valor por tonelada/km informado esta invalido. Valor atual: ${fmt(valorToneladaKm, 4)}. Revise o campo Valor por tonelada/km antes de continuar.`,
      });
    }
    if (v > VALOR_TONELADA_KM_MAX) {
      return falha({
        campo: 'valor_tonelada_km',
        valorAtual: v,
        limite: `ate R$ ${fmt(VALOR_TONELADA_KM_MAX)}`,
        message: `O valor por tonelada/km informado esta fora do limite permitido. Valor atual: R$ ${fmt(v, 4)}; limite: R$ ${fmt(VALOR_TONELADA_KM_MAX)}. Revise o campo Valor por tonelada/km antes de continuar.`,
      });
    }
  }

  if (presente(kmInicial) && presente(kmFinal)) {
    const ki = Number(kmInicial);
    const kf = Number(kmFinal);
    if (!Number.isFinite(ki) || !Number.isFinite(kf)) {
      return falha({
        campo: 'km',
        valorAtual: { kmInicial, kmFinal },
        limite: 'KM inicial e KM final validos',
        message: 'A distancia informada esta invalida. Revise os campos KM inicial e KM final antes de continuar.',
      });
    }
    if (kf <= ki) {
      return falha({
        campo: 'km',
        valorAtual: { kmInicial: ki, kmFinal: kf },
        limite: 'KM final maior que KM inicial',
        message: `A distancia informada esta fora do limite permitido. KM inicial: ${fmt(ki, 1)}; KM final: ${fmt(kf, 1)}. Revise o campo KM final antes de continuar.`,
      });
    }
  }

  if (presente(valorFrete)) {
    const vf = Number(valorFrete);
    if (!Number.isFinite(vf)) {
      return falha({
        campo: 'valor_frete',
        valorAtual: valorFrete,
        limite: `ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: 'O valor do frete informado esta invalido. Revise o campo Valor do frete antes de continuar.',
      });
    }
    if (vf < 0) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: `O valor do frete informado esta invalido. Valor atual: R$ ${fmt(vf)}. Revise o campo Valor do frete antes de continuar.`,
      });
    }
    if (modalidade !== 'tonelada_km' && vf <= 0) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: 'O valor do frete deve ser maior que zero. Revise o campo Valor do frete antes de continuar.',
      });
    }
    if (vf > VALOR_FRETE_MAX) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: `O valor do frete calculado esta fora do limite permitido. Valor atual: R$ ${fmt(vf)}; limite: R$ ${fmt(VALOR_FRETE_MAX)}. Revise os dados do frete antes de continuar.`,
      });
    }
  }

  return { ok: true };
};

module.exports = {
  VALOR_TONELADA_KM_MAX,
  TONELADAS_MAX,
  VALOR_FRETE_MAX,
  MSG_LIMITE,
  validarLimitesFrete,
};

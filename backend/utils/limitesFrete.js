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

const orientarPainel = 'Corrija este campo pelo painel antes de finalizar pelo app.';
const orientarKm = 'Corrija o KM final no app; se o KM inicial estiver errado, ajuste o frete pelo painel.';

const validarLimitesFrete = ({ modalidade, valorFrete, toneladas, valorToneladaKm, kmInicial, kmFinal } = {}) => {
  if (presente(toneladas)) {
    const t = Number(toneladas);
    if (!Number.isFinite(t) || t <= 0) {
      return falha({
        campo: 'toneladas',
        valorAtual: toneladas,
        limite: `maior que 0 e ate ${TONELADAS_MAX} t`,
        message: `Campo invalido: Toneladas. Valor atual: ${fmt(toneladas, 3)}. Limite aceitavel: maior que 0 e ate ${TONELADAS_MAX} t. ${orientarPainel}`,
      });
    }
    if (t > TONELADAS_MAX) {
      return falha({
        campo: 'toneladas',
        valorAtual: t,
        limite: `ate ${TONELADAS_MAX} t`,
        message: `Campo invalido: Toneladas. Valor atual: ${fmt(t, 3)} t. Limite aceitavel: ate ${TONELADAS_MAX} t. ${orientarPainel}`,
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
        message: `Campo invalido: Valor por tonelada/km. Valor atual: R$ ${fmt(valorToneladaKm, 4)}. Limite aceitavel: maior que 0 e ate R$ ${fmt(VALOR_TONELADA_KM_MAX)}. ${orientarPainel}`,
      });
    }
    if (v > VALOR_TONELADA_KM_MAX) {
      return falha({
        campo: 'valor_tonelada_km',
        valorAtual: v,
        limite: `ate R$ ${fmt(VALOR_TONELADA_KM_MAX)}`,
        message: `Campo invalido: Valor por tonelada/km. Valor atual: R$ ${fmt(v, 4)}. Limite aceitavel: ate R$ ${fmt(VALOR_TONELADA_KM_MAX)}. ${orientarPainel}`,
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
        message: `Campo invalido: KM. Valor atual: KM inicial ${fmt(kmInicial, 1)} e KM final ${fmt(kmFinal, 1)}. Limite aceitavel: KM inicial e KM final validos. ${orientarKm}`,
      });
    }
    if (kf <= ki) {
      return falha({
        campo: 'km',
        valorAtual: { kmInicial: ki, kmFinal: kf },
        limite: 'KM final maior que KM inicial',
        message: `Campo invalido: KM. Valor atual: KM inicial ${fmt(ki, 1)} e KM final ${fmt(kf, 1)}. Limite aceitavel: KM final maior que KM inicial. ${orientarKm}`,
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
        message: `Campo invalido: Valor do frete. Valor atual: ${fmt(valorFrete)}. Limite aceitavel: ate R$ ${fmt(VALOR_FRETE_MAX)}. ${orientarPainel}`,
      });
    }
    if (vf < 0) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: `Campo invalido: Valor do frete. Valor atual: R$ ${fmt(vf)}. Limite aceitavel: maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}. ${orientarPainel}`,
      });
    }
    if (modalidade !== 'tonelada_km' && vf <= 0) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: `Campo invalido: Valor do frete. Valor atual: R$ ${fmt(vf)}. Limite aceitavel: maior que zero e ate R$ ${fmt(VALOR_FRETE_MAX)}. ${orientarPainel}`,
      });
    }
    if (vf > VALOR_FRETE_MAX) {
      return falha({
        campo: 'valor_frete',
        valorAtual: vf,
        limite: `ate R$ ${fmt(VALOR_FRETE_MAX)}`,
        message: `Campo invalido: Valor do frete calculado. Valor atual: R$ ${fmt(vf)}. Limite aceitavel: ate R$ ${fmt(VALOR_FRETE_MAX)}. Revise toneladas, KM e valor por tonelada/km; toneladas e valor por tonelada/km devem ser corrigidos pelo painel, e o KM final pelo app.`,
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

// Limites de SANIDADE OPERACIONAL do frete — NÃO são regra comercial final.
// Objetivo: impedir que um erro de digitação (ex.: R$150/t·km no lugar de R$0,15)
// ou dado de teste gere valores absurdos (milhões) que contaminam dashboard,
// relatórios e agregados financeiros. São tetos GENEROSOS, propositalmente muito
// acima do caso real de referência (o teste do projeto usa 0,20 R$/t·km), só para
// barrar o impossível — não para definir preço.
//
// Função pura (sem I/O) → testável sem banco, no mesmo padrão de calculoFrete.js.
// A fonte da verdade do CÁLCULO continua em calculoFrete.js; aqui só validamos
// magnitude. O controller chama validarLimitesFrete antes de qualquer insert/update
// e, ao reprovar, responde 422 sem gravar nada.

// Tetos de sanidade (revisáveis por decisão de produto — ver PR de origem).
const VALOR_TONELADA_KM_MAX = 10;       // R$ por tonelada·km (realista ~0,10–0,50)
const TONELADAS_MAX = 100;              // toneladas por frete
const VALOR_FRETE_MAX = 1000000;        // R$ por frete (fixo ou derivado)

// Mensagem única ao usuário: clara, sem expor detalhe interno.
const MSG_LIMITE = 'Valor fora dos limites operacionais. Confira toneladas, KM e valor por tonelada-km.';

// "Presente" = veio um valor de fato (null/undefined/'' contam como ausente, para
// não reprovar campos opcionais ainda não preenchidos — ex.: km_final na criação).
const presente = (v) => v !== null && v !== undefined && v !== '';

// Valida os limites de sanidade de um frete. Recebe os valores JÁ resolvidos pelo
// controller (efetivos após merge, no update). Retorna { ok: true } quando tudo
// está dentro dos limites, ou { ok: false, message } na primeira violação.
//
// Regras (só aplicadas aos campos presentes):
//  - toneladas: > 0 e <= TONELADAS_MAX;
//  - valor_tonelada_km: > 0 e <= VALOR_TONELADA_KM_MAX;
//  - km_inicial/km_final (quando ambos presentes): km_final > km_inicial;
//  - valor_frete: nunca negativo; <= VALOR_FRETE_MAX. Na modalidade 'valor_fixo'
//    exige > 0; na 'tonelada_km' o 0 provisório (antes da finalização) é aceito.
const validarLimitesFrete = ({ modalidade, valorFrete, toneladas, valorToneladaKm, kmInicial, kmFinal } = {}) => {
  if (presente(toneladas)) {
    const t = Number(toneladas);
    if (!Number.isFinite(t) || t <= 0 || t > TONELADAS_MAX) return { ok: false, message: MSG_LIMITE };
  }

  if (presente(valorToneladaKm)) {
    const v = Number(valorToneladaKm);
    if (!Number.isFinite(v) || v <= 0 || v > VALOR_TONELADA_KM_MAX) return { ok: false, message: MSG_LIMITE };
  }

  if (presente(kmInicial) && presente(kmFinal)) {
    const ki = Number(kmInicial);
    const kf = Number(kmFinal);
    if (!Number.isFinite(ki) || !Number.isFinite(kf) || kf <= ki) return { ok: false, message: MSG_LIMITE };
  }

  if (presente(valorFrete)) {
    const vf = Number(valorFrete);
    if (!Number.isFinite(vf)) return { ok: false, message: MSG_LIMITE };
    if (vf < 0) return { ok: false, message: MSG_LIMITE };
    // valor_fixo exige valor positivo; tonelada_km aceita 0 provisório até finalizar.
    if (modalidade !== 'tonelada_km' && vf <= 0) return { ok: false, message: MSG_LIMITE };
    if (vf > VALOR_FRETE_MAX) return { ok: false, message: MSG_LIMITE };
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

// Regra única de cálculo de frete por modalidade (produto). Fonte da verdade
// para o controller de fretes e para os testes — evita divergência entre pontos
// de cálculo. Função pura (sem I/O) → testável sem banco.
//
// Modalidades:
//  - 'valor_fixo': o valor_frete é digitado manualmente (comportamento histórico).
//  - 'tonelada_km': o valor é derivado de
//       toneladas * (km_final - km_inicial) * valor_tonelada_km.
//    Só é calculável quando km_final é conhecido (finalização).

const MODALIDADES = ['valor_fixo', 'tonelada_km'];
const MODALIDADE_PADRAO = 'valor_fixo';

// Normaliza a modalidade recebida (aceita undefined/null → padrão). Retorna null
// quando o valor é uma string fora do domínio (chamador decide como reportar).
const normalizarModalidade = (modalidade) => {
  if (modalidade === undefined || modalidade === null || modalidade === '') {
    return MODALIDADE_PADRAO;
  }
  return MODALIDADES.includes(modalidade) ? modalidade : null;
};

// Converte para número tratando null/undefined/'' como ausente (NaN) — sem isto
// Number(null) viraria 0 e um km_inicial ausente inflaria a distância.
const numOuNaN = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

// Distância percorrida. Retorna null se algum KM estiver ausente/inválido ou se
// km_final <= km_inicial (não há distância positiva).
const calcularKmTotal = (kmInicial, kmFinal) => {
  const ini = numOuNaN(kmInicial);
  const fim = numOuNaN(kmFinal);
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) return null;
  const total = fim - ini;
  return total > 0 ? total : null;
};

// Valor do frete na modalidade tonelada/km. Retorna null quando faltar qualquer
// insumo (toneladas, valor_tonelada_km, km válidos) — o chamador mantém o
// valor_frete anterior nesse caso, sem fabricar número.
const calcularValorToneladaKm = ({ toneladas, valorToneladaKm, kmInicial, kmFinal }) => {
  const ton = Number(toneladas);
  const vtk = Number(valorToneladaKm);
  if (!Number.isFinite(ton) || ton <= 0) return null;
  if (!Number.isFinite(vtk) || vtk <= 0) return null;
  const kmTotal = calcularKmTotal(kmInicial, kmFinal);
  if (kmTotal === null) return null;
  // Arredonda a 2 casas (centavos) para casar com dinheiro.
  return Math.round(ton * kmTotal * vtk * 100) / 100;
};

module.exports = {
  MODALIDADES,
  MODALIDADE_PADRAO,
  normalizarModalidade,
  calcularKmTotal,
  calcularValorToneladaKm,
};

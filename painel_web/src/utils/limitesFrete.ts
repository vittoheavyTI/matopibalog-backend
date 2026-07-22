// Limites de sanidade operacional do frete no PAINEL — espelham as travas do backend
// (backend/utils/limitesFrete.js, PR #291). NÃO são regra comercial: só impedem/avisam
// no formulário, ANTES de chamar a API, valores absurdos por erro de escala/digitação
// (ex.: R$ 150/t·km no lugar de R$ 0,20). O backend continua sendo a autoridade e
// rejeita com 422 de qualquer forma; aqui é UX. Manter em sincronia manual com o backend.

export const VALOR_TONELADA_KM_MAX = 10;
export const TONELADAS_MAX = 100;
export const VALOR_FRETE_MAX = 1000000;

type Insumos = {
  toneladas?: string | number | null;
  valorToneladaKm?: string | number | null;
  kmInicial?: string | number | null;
  kmFinal?: string | number | null;
};

const num = (v: unknown): number => Number(v);
// "Preenchido" = usuário digitou algo. Vazio/null não dispara erro — o formulário
// pode estar incompleto e não queremos alarme prematuro.
const preenchido = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

const fmtBRL = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Valor previsto tonelada/km = toneladas × (km_final − km_inicial) × valor_tonelada_km.
// Retorna null quando faltar insumo válido ou km_final <= km_inicial (sem distância
// positiva). Espelha backend/utils/calculoFrete.js.
export function calcularValorPrevistoTonKm({ toneladas, valorToneladaKm, kmInicial, kmFinal }: Insumos): number | null {
  const ton = num(toneladas);
  const vtk = num(valorToneladaKm);
  const ki = num(kmInicial);
  const kf = num(kmFinal);
  if (!(ton > 0) || !(vtk > 0)) return null;
  if (!Number.isFinite(ki) || !Number.isFinite(kf) || kf <= ki) return null;
  return Math.round(ton * (kf - ki) * vtk * 100) / 100;
}

// Primeira violação de sanidade da modalidade tonelada/km (ou null quando ok). Só
// reprova campos PREENCHIDOS. Ordem: escala do valor por t·km → toneladas → ordem de
// KM → valor total previsto. As mensagens são específicas para orientar a correção.
export function erroSanidadeTonKm({ toneladas, valorToneladaKm, kmInicial, kmFinal }: Insumos): string | null {
  if (preenchido(valorToneladaKm) && num(valorToneladaKm) > VALOR_TONELADA_KM_MAX) {
    return `O valor por tonelada/km não pode passar de ${fmtBRL(VALOR_TONELADA_KM_MAX)}. Confira a escala (ex.: 0,20 = R$ 0,20 por t·km).`;
  }
  if (preenchido(toneladas) && num(toneladas) > TONELADAS_MAX) {
    return `As toneladas não podem passar de ${TONELADAS_MAX} t.`;
  }
  if (preenchido(kmInicial) && preenchido(kmFinal) && num(kmFinal) <= num(kmInicial)) {
    return 'O KM final deve ser maior que o KM inicial.';
  }
  const previsto = calcularValorPrevistoTonKm({ toneladas, valorToneladaKm, kmInicial, kmFinal });
  if (previsto !== null && previsto > VALOR_FRETE_MAX) {
    return 'Valor previsto ultrapassa o limite operacional. Confira toneladas, km e valor por tonelada/km.';
  }
  return null;
}

// Sanidade da modalidade valor fixo: só barra acima do teto (o restante do fluxo
// histórico é preservado). null quando ok ou campo ainda vazio.
export function erroSanidadeValorFixo(valorFrete?: string | number | null): string | null {
  if (preenchido(valorFrete) && num(valorFrete) > VALOR_FRETE_MAX) {
    return `O valor do frete não pode passar de ${fmtBRL(VALOR_FRETE_MAX)}.`;
  }
  return null;
}

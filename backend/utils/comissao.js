// Regra única de comissão (produto). Fonte da verdade para os controllers de
// fretes, dashboard e relatórios — evita divergência entre os pontos de cálculo.
//
//  - Motorista VINCULADO (empresa com tipo conhecido e diferente de 'autonomo',
//    ex.: 'transportadora'): comissão = valor_frete * percentual/100, usando o
//    percentual cadastrado no motorista.
//  - Motorista AUTÔNOMO (empresa.tipo === 'autonomo'): NÃO usa comissão fixa → 0.
//    O autônomo enxerga faturamento − gastos = resultado (calculado à parte).
//  - Tipo DESCONHECIDO/ausente (null | undefined | ''): por segurança → 0.
//    NUNCA assume 12% quando o tipo da empresa não pôde ser resolvido.
//
// O contrato JSON é preservado: os campos de comissão continuam existindo; apenas
// o valor vai a 0 para autônomo/desconhecido. Função pura (sem I/O) → testável
// sem banco.

const EMPRESA_TIPO_AUTONOMO = 'autonomo';

// true somente quando o tipo é conhecido (string não-vazia) e não é autônomo.
const deveComissionar = (empresaTipo) =>
  typeof empresaTipo === 'string'
  && empresaTipo.trim() !== ''
  && empresaTipo !== EMPRESA_TIPO_AUTONOMO;

const calcularComissao = (valorFrete, percentualComissao, empresaTipo) => {
  if (!deveComissionar(empresaTipo)) return 0;
  const valor = Number(valorFrete);
  const percentual = Number(percentualComissao);
  if (!Number.isFinite(valor) || !Number.isFinite(percentual)) return 0;
  return valor * (percentual / 100);
};

module.exports = { calcularComissao, deveComissionar, EMPRESA_TIPO_AUTONOMO };

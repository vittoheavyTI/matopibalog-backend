// Rentabilidade OPERACIONAL DIRETA por viagem/frete (não é lucro contábil).
// Função PURA (sem I/O) → testável sem banco, no padrão de comissao.js /
// agregacaoFinanceiraFretes.js. Reutiliza as FONTES CANÔNICAS (não cria segunda
// fórmula): status de receita (agregacaoFinanceiraFretes) e comissão (comissao).
//
// Indicador (decisão desta frente):
//   receita_realizada = valor_frete, SOMENTE se o frete está 'finalizado';
//   custo_direto = combustível (abastecimentos.valor_total) + pedágio
//                  (despesas.tipo='pedagio') + outras despesas (demais despesas)
//                  + comissão (regra canônica). Vales NÃO entram (informativo).
//   resultado_operacional = receita − custo_direto;
//   margem_percentual = resultado/receita×100 (null se receita ≤ 0 — nunca NaN/Infinity).
//
// Lançamentos considerados: os já filtrados por frete_id (o chamador agrupa) e
// EFETIVADOS (status 'aprovado'/'finalizado'). Frete NÃO finalizado (e não
// cancelado) é "em andamento": receita 0 e resultado/margem = null (nunca some no
// realizado). Frete cancelado é excluído ANTES daqui pelo chamador.

const { calcularComissao } = require('./comissao');
const { freteContaComoReceita } = require('./agregacaoFinanceiraFretes');

const STATUS_LANCAMENTO_EFETIVADO = ['aprovado', 'finalizado'];
const TIPO_DESPESA_PEDAGIO = 'pedagio';

// Arredondamento monetário (2 casas) — evita erro de ponto flutuante ao compor.
const arred2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const statusDe = (l) => (l && l.status != null ? String(l.status) : '');
const efetivado = (l) => STATUS_LANCAMENTO_EFETIVADO.includes(statusDe(l));
const pendente = (l) => statusDe(l) === 'pendente';

/**
 * Compõe a rentabilidade operacional de UM frete.
 * @param {object} frete  { id, status, valor_frete }
 * @param {object} vinculos { abastecimentos: [], despesas: [] } já filtrados por frete_id
 * @param {string} empresaTipo  tipo da empresa do motorista ('autonomo'|'transportadora'|…)
 * @param {number|string} percentualComissao  percentual cadastrado do motorista
 */
function calcularRentabilidadeFrete(frete, vinculos = {}, empresaTipo, percentualComissao) {
  const abastecimentos = Array.isArray(vinculos.abastecimentos) ? vinculos.abastecimentos : [];
  const despesas = Array.isArray(vinculos.despesas) ? vinculos.despesas : [];
  const realizada = freteContaComoReceita(frete); // só 'finalizado'

  const abastEf = abastecimentos.filter(efetivado);
  const despEf = despesas.filter(efetivado);

  const combustivel = arred2(abastEf.reduce((s, a) => s + num(a.valor_total), 0));
  const pedagio = arred2(
    despEf.filter((d) => String(d.tipo || '') === TIPO_DESPESA_PEDAGIO).reduce((s, d) => s + num(d.valor), 0),
  );
  const outras = arred2(
    despEf.filter((d) => String(d.tipo || '') !== TIPO_DESPESA_PEDAGIO).reduce((s, d) => s + num(d.valor), 0),
  );

  const receita = realizada ? arred2(num(frete.valor_frete)) : 0;
  // Comissão pela regra canônica (0 p/ autônomo/tipo desconhecido). Só sobre receita realizada.
  const comissao = realizada ? arred2(calcularComissao(receita, percentualComissao, empresaTipo)) : 0;

  const custoTotal = arred2(combustivel + pedagio + outras + comissao);
  const resultado = realizada ? arred2(receita - custoTotal) : null;
  const margem = realizada && receita > 0 ? arred2((resultado / receita) * 100) : null;

  // dados_completos / alertas por critérios OBJETIVOS (não inventar precisão).
  const alertas = [];
  if (!realizada) alertas.push('em_andamento');
  const temPendentes = abastecimentos.some(pendente) || despesas.some(pendente);
  if (temPendentes) alertas.push('lancamentos_pendentes');
  if (realizada && receita === 0) alertas.push('receita_zero');
  if (realizada && custoTotal > 0 && receita === 0) alertas.push('custo_sem_receita');

  return {
    frete_id: frete.id,
    status: statusDe(frete),
    realizada,
    receita_realizada: receita,
    custos: {
      combustivel,
      pedagio,
      outras_despesas: outras,
      comissao,
      total: custoTotal,
    },
    resultado_operacional: resultado,
    margem_percentual: margem,
    dados_completos: realizada && !temPendentes,
    alertas,
  };
}

/**
 * Agrega uma lista de rentabilidades por frete no RESUMO. Só o REALIZADO
 * (finalizado) soma em receita/custo/resultado; os "em andamento" só são
 * contados à parte. Divisão por zero → margem null.
 */
function resumirRentabilidade(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const realizados = lista.filter((i) => i.realizada);
  const receita = arred2(realizados.reduce((s, i) => s + num(i.receita_realizada), 0));
  const custo = arred2(realizados.reduce((s, i) => s + num(i.custos && i.custos.total), 0));
  const resultado = arred2(receita - custo);
  const margem = receita > 0 ? arred2((resultado / receita) * 100) : null;
  return {
    receita_realizada: receita,
    custo_direto: custo,
    resultado_operacional: resultado,
    margem_percentual: margem,
    viagens_finalizadas: realizados.length,
    viagens_em_andamento: lista.length - realizados.length,
    viagens_dados_incompletos: realizados.filter((i) => !i.dados_completos).length,
  };
}

module.exports = {
  calcularRentabilidadeFrete,
  resumirRentabilidade,
  arred2,
  STATUS_LANCAMENTO_EFETIVADO,
  TIPO_DESPESA_PEDAGIO,
};

// Regra ÚNICA (produto — decisão A) de agregação financeira de FRETES. Fonte da
// verdade para dashboard, relatórios e ficha de viagem, evitando a divergência que
// a auditoria confirmou (telas somando `!= cancelado` vs só `finalizado`).
//
// REGRA OFICIAL (decisão A):
//   * Receita / total financeiro REALIZADO = SOMENTE fretes com status 'finalizado'.
//   * Fretes 'ativo' / 'pendente' NÃO entram em receita, saldo, lucro ou total
//     realizado (podem ser exibidos à parte como "em andamento"/"previsto", nunca
//     somados no realizado).
//   * Fretes 'cancelado' NUNCA entram; e lançamentos (despesa/abastecimento/vale)
//     VINCULADOS a um frete cancelado também ficam FORA de qualquer agregado.
//     Lançamento sem frete vinculado (frete_id vazio) é preservado.
//
// Função pura (sem I/O) → testável sem banco, no mesmo padrão de comissao.js e
// calculoFrete.js. Os controllers importam daqui em vez de repetir literais de status.

const STATUS_FRETE_RECEITA_REALIZADA = 'finalizado';
const STATUS_FRETE_EXCLUIDOS = ['cancelado'];

// ── Regras de STATUS de LANÇAMENTO (despesa / abastecimento / vale) ───────────
// E1.3 (D-035 / RBV9-INV-055): fonte ÚNICA das regras de status de lançamento do
// financeiro OPERACIONAL, para dashboard, relatórios, rentabilidade e acerto não
// repetirem literais (o que causava divergência de KPI entre telas). Não muda a
// regra vigente — apenas centraliza os mesmos valores num único lugar.
//   * EFETIVADO   = 'aprovado' | 'finalizado' → entra nos agregados/realizado.
//   * NÃO COMPÕE  = 'cancelado' | 'rejeitado' → nunca entra em consolidado/ficha.
//     (Onda 1 §15: cancelado nunca compõe; rejeitado nunca conta como válido.)
// 'pendente' fica FORA do efetivado (regra específica de cada tela decide se exibe).
const STATUS_LANCAMENTO_EFETIVADO = ['aprovado', 'finalizado'];
const STATUS_LANCAMENTO_NAO_COMPOE = ['cancelado', 'rejeitado'];

const statusDe = (frete) => (frete && frete.status != null ? String(frete.status) : '');

// Predicados de lançamento (mesmo parse seguro dos fretes).
const statusLancamentoDe = (lancamento) =>
  (lancamento && lancamento.status != null ? String(lancamento.status) : '');
const lancamentoEfetivado = (lancamento) =>
  STATUS_LANCAMENTO_EFETIVADO.includes(statusLancamentoDe(lancamento));
const lancamentoNaoCompoe = (lancamento) =>
  STATUS_LANCAMENTO_NAO_COMPOE.includes(statusLancamentoDe(lancamento));

// Conta como receita realizada? Somente 'finalizado' (ativo/pendente/cancelado → false).
const freteContaComoReceita = (frete) => statusDe(frete) === STATUS_FRETE_RECEITA_REALIZADA;

// Está num status EXCLUÍDO de todo agregado? (hoje: 'cancelado').
const freteEstaCancelado = (frete) => STATUS_FRETE_EXCLUIDOS.includes(statusDe(frete));

// Lançamento deve ser EXCLUÍDO por estar vinculado a um frete cancelado?
// `setIdsFretesCancelados` = Set com os ids dos fretes cancelados no escopo.
// Lançamento solto (sem frete_id) nunca é excluído por este critério.
const lancamentoVinculadoAFreteCancelado = (lancamento, setIdsFretesCancelados) => {
  const fid = lancamento ? lancamento.frete_id : undefined;
  if (fid === null || fid === undefined || fid === '') return false;
  return setIdsFretesCancelados.has(fid);
};

// Soma da receita REALIZADA de um conjunto de fretes (só finalizados). Parse seguro
// (valor_frete pode vir string/null). É a materialização direta da regra oficial.
const somarReceitaRealizada = (fretes) =>
  (fretes || []).reduce(
    (acc, f) => acc + (freteContaComoReceita(f) ? (Number.parseFloat(f.valor_frete) || 0) : 0),
    0,
  );

module.exports = {
  STATUS_FRETE_RECEITA_REALIZADA,
  STATUS_FRETE_EXCLUIDOS,
  STATUS_LANCAMENTO_EFETIVADO,
  STATUS_LANCAMENTO_NAO_COMPOE,
  freteContaComoReceita,
  freteEstaCancelado,
  lancamentoVinculadoAFreteCancelado,
  lancamentoEfetivado,
  lancamentoNaoCompoe,
  somarReceitaRealizada,
};

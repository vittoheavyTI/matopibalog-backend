// Regra oficial (decisão A) de agregação financeira de fretes no PAINEL — espelha
// o backend (backend/utils/agregacaoFinanceiraFretes.js, PR #294).
//
//   * Receita / total financeiro REALIZADO = SOMENTE fretes com status 'finalizado'.
//   * Fretes 'ativo'/'pendente' = EM ANDAMENTO / previsto → nunca somados como receita.
//   * Fretes 'cancelado' NUNCA entram em nenhum agregado.
//
// Usado pelas telas de relatório/dashboard para não misturar realizado com em
// andamento. Funções puras, sem dependência de framework.

type FreteLike = { status?: string | null } | null | undefined;

const statusDe = (f: FreteLike): string => (f && f.status != null ? String(f.status) : '');

// Conta como RECEITA REALIZADA? Só 'finalizado'.
export const freteContaComoReceitaRealizada = (f: FreteLike): boolean =>
  statusDe(f) === 'finalizado';

// Está EM ANDAMENTO (ativo/pendente)? Valor previsto, não realizado.
export const freteEstaEmAndamento = (f: FreteLike): boolean => {
  const s = statusDe(f);
  return s === 'ativo' || s === 'pendente';
};

// Está CANCELADO? Fora de todo agregado.
export const freteEstaCancelado = (f: FreteLike): boolean => statusDe(f) === 'cancelado';

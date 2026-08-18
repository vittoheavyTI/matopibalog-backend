// Copy/formatação da página de Faturas (F5B-2).
//
// Isola a comunicação para não afirmar "sandbox / sem valor real" quando a
// cobrança for REAL (Asaas production). A fatura da homologação one-shot é
// marcada com origem='homologacao_one_shot'; para ela a mensagem é de cobrança
// real. Para as demais (legado/sandbox), preserva a copy antiga.

export const ORIGEM_PRODUCTION_ONE_SHOT = 'homologacao_one_shot';

// Formata valor em Real pt-BR (R$ 5,00 — nunca "R$ 5.00").
export function brl(v: number | string | null | undefined): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Mensagem do rodapé do card de pagamento, condicional à origem da fatura.
export function mensagemRodapePagamento(origem?: string | null): string {
  if (origem === ORIGEM_PRODUCTION_ONE_SHOT) {
    return 'Esta é uma cobrança real emitida via Asaas. O pagamento é opcional durante o período de teste e não encerra seu trial.';
  }
  return 'Durante o piloto, os pagamentos são processados em ambiente sandbox de homologação, sem valor real.';
}

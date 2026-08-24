'use strict';

// Mapeamento CONGELADO (§17/§18) de status canônico de Frete -> bucket de
// execução da Campaign. Fonte ÚNICA usada pelo campaignProgressService, pela
// Torre de Controle e pela tool de IA. Determinístico e testado.
//
// A Campaign NÃO é autoridade de execução: quem detém o estado de execução é o
// Frete canônico. Aqui apenas PROJETAMOS o status do Frete em um bucket de
// campanha. Status desconhecido NUNCA vira IN_EXECUTION silenciosamente — vira
// UNKNOWN (§18), para não fabricar progresso.

// Buckets de execução expostos pela projeção de progresso.
const EXECUTION_BUCKET = Object.freeze({
  IN_EXECUTION: 'IN_EXECUTION',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
});

// Vocabulário canônico observado no código/app (fretesController, app_android,
// commandCenterService). Mantido explícito: adicionar um novo status de frete
// exige atualizar este mapa conscientemente (e o teste que o congela).
const FREIGHT_STATUS_TO_BUCKET = Object.freeze({
  pendente: EXECUTION_BUCKET.IN_EXECUTION,
  ativo: EXECUTION_BUCKET.IN_EXECUTION,
  em_viagem: EXECUTION_BUCKET.IN_EXECUTION,
  em_andamento: EXECUTION_BUCKET.IN_EXECUTION,
  finalizado: EXECUTION_BUCKET.COMPLETED,
  cancelado: EXECUTION_BUCKET.CANCELLED,
});

// Projeta um status de Frete no bucket de execução da campanha.
// Entrada nula/vazia/desconhecida -> UNKNOWN (nunca IN_EXECUTION).
function freightStatusToBucket(status) {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return EXECUTION_BUCKET.UNKNOWN;
  return FREIGHT_STATUS_TO_BUCKET[key] || EXECUTION_BUCKET.UNKNOWN;
}

// Lista de status considerados "em execução" (útil para filtros/consultas).
const IN_EXECUTION_STATUSES = Object.freeze(
  Object.keys(FREIGHT_STATUS_TO_BUCKET).filter(
    (s) => FREIGHT_STATUS_TO_BUCKET[s] === EXECUTION_BUCKET.IN_EXECUTION,
  ),
);

module.exports = {
  EXECUTION_BUCKET,
  FREIGHT_STATUS_TO_BUCKET,
  IN_EXECUTION_STATUSES,
  freightStatusToBucket,
};

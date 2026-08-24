'use strict';

// Sinal realtime MÍNIMO de mudança de status de frete (§101). Reusa o RealtimeBus
// existente (SSE por empresa) — NÃO adiciona WebSocket (§100). Best-effort: nunca
// lança nem altera a resposta do frete. O cliente, ao receber, refaz o fetch
// (targeted refresh); a autoridade continua no backend. Idempotente por event_id.

const bus = require('../realtimeBus');

function publicarStatusFrete(frete, { type = 'freight.status' } = {}) {
  try {
    if (!frete || !frete.empresa_id || !frete.id) return;
    bus.publish({
      event_id: `freight:${frete.id}:${frete.status || ''}:${type}`,
      type,
      empresa_id: frete.empresa_id,
      entity_type: 'freight',
      entity_id: frete.id,
      freight_id: frete.id,
      version: null,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Sinal é auxiliar: qualquer falha é silenciada (polling/refresh cobrem).
  }
}

module.exports = { publicarStatusFrete };

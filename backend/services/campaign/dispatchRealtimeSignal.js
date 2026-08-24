'use strict';

// Sinal realtime MINIMO de mudanca de estado de dispatch (round/offer). Reusa o
// RealtimeBus existente (SSE por empresa) -- NAO adiciona WebSocket/push provider novo.
// Best-effort: nunca lanca nem altera a resposta da mutacao. O cliente (web manager,
// app do motorista), ao receber, refaz o fetch canonico -- o sinal nunca e a fonte de
// verdade, so aciona o refresh (mesmo padrao de freightRealtimeSignal.js).

const bus = require('../realtimeBus');

function publicarDispatchAtualizado(round, { type = 'dispatch.round_updated' } = {}) {
  try {
    if (!round || !round.empresa_id || !round.id) return;
    bus.publish({
      event_id: `dispatch:${round.id}:${round.status || ''}:${type}`,
      type,
      empresa_id: round.empresa_id,
      entity_type: 'dispatch_round',
      entity_id: round.id,
      planned_trip_id: round.planned_trip_id || null,
      campaign_id: round.campaign_id || null,
      version: null,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Sinal e auxiliar: qualquer falha e silenciada (polling/refresh cobrem).
  }
}

module.exports = { publicarDispatchAtualizado };

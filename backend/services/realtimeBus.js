// RealtimeBus — barramento de eventos em memória para push server→cliente (SSE).
//
// Onda 1 (D-017/D-027): o backend é a autoridade. As mutations chegam por HTTP,
// o backend processa e PUBLICA um evento mínimo aqui; o controller SSE assina por
// empresa e reenvia aos clientes conectados (web/app), que então REFAZEM o fetch
// canônico. O evento AVISA; a API/estado CONFIRMA (nunca transmitimos o objeto
// financeiro inteiro — ver construirEventoLancamento).
//
// LIMITAÇÃO HORIZONTAL (documentada — Ledger RBV9-INV-053 / REALTIME_HORIZONTAL_SCALE):
// é in-memory e por-processo. Se o backend escalar para N instâncias, um evento
// publicado numa instância NÃO alcança assinantes de outra. Mitigação já embutida no
// contrato: todo cliente REFAZ o fetch canônico ao (re)conectar e ao voltar de
// background/visibility — então nenhuma informação fica permanentemente errada por um
// evento perdido. Escala horizontal real (Redis/pub-sub) fica DEFERRED, atrás desta
// mesma abstração (trocar só a implementação, não os call sites).

const { EventEmitter } = require('events');

// Um emitter por processo. maxListeners alto: cada conexão SSE registra 1 listener;
// muitos usuários simultâneos são normais. O cleanup no disconnect evita leak.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // 0 = ilimitado (o teto viraria warning ruidoso sem valor)

// Canal por tenant. Isolamento é por CHAVE de canal (empresa_id) — um assinante só
// recebe o que foi publicado no seu próprio canal. Nunca cruza tenant.
const canalDe = (empresaId) => `empresa:${String(empresaId)}`;

/**
 * Publica um evento para todos os assinantes da empresa. Silencioso e não-bloqueante
 * (best-effort): uma falha de entrega NUNCA deve afetar a mutation que já foi
 * persistida. O envelope deve conter empresa_id (usado só para escolher o canal —
 * a autoridade do tenant é do backend que chamou publish).
 * @param {object} evento envelope mínimo (ver construirEventoLancamento)
 */
function publish(evento) {
  if (!evento || evento.empresa_id == null) return false;
  try {
    return emitter.emit(canalDe(evento.empresa_id), evento);
  } catch (_) {
    return false;
  }
}

/**
 * Assina os eventos de UMA empresa. Retorna uma função de cancelamento (unsubscribe)
 * idempotente — chame no disconnect do SSE para evitar listener duplicado/leak.
 * @param {string} empresaId tenant resolvido pelo backend (NUNCA do cliente)
 * @param {(evento:object)=>void} listener
 * @returns {() => void} unsubscribe
 */
function subscribe(empresaId, listener) {
  if (empresaId == null || typeof listener !== 'function') return () => {};
  const canal = canalDe(empresaId);
  emitter.on(canal, listener);
  let ativo = true;
  return function unsubscribe() {
    if (!ativo) return;
    ativo = false;
    emitter.off(canal, listener);
  };
}

/** Nº de assinantes de uma empresa (diagnóstico/testes). */
function subscriberCount(empresaId) {
  return emitter.listenerCount(canalDe(empresaId));
}

module.exports = { publish, subscribe, subscriberCount };

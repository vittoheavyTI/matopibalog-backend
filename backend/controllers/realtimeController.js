// realtimeController — stream SSE autenticado (push server→cliente) da Onda 1.
//
// Contrato: o cliente abre GET /realtime/stream (web: EventSource com cookie; app:
// requisição HTTP streaming com Bearer). O backend resolve a EMPRESA pelo token
// (verificarEmpresa — NUNCA aceita empresa_id do corpo como autoridade), assina o
// RealtimeBus e reenvia eventos MÍNIMOS. O cliente, ao receber, REFAZ o fetch
// canônico. Heartbeat mantém a conexão viva; cleanup no disconnect evita leak.
//
// Sem token em query string. Sem Supabase Realtime. Sem expor o banco ao cliente.

const bus = require('../services/realtimeBus');
const conns = require('../services/sseConnections');

const HEARTBEAT_MS = 25000; // < timeouts de proxy/idle comuns; barato

function stream(req, res) {
  const empresaId = req.empresa_id || null;
  const userId = (req.user && req.user.uid) || null;
  if (!empresaId || !userId) {
    // Sem empresa/usuário resolvidos não há canal seguro para assinar (ex.: super-admin
    // sem ?empresa_id=). Não assinamos "tudo" — isolamento de tenant é inegociável.
    return res.status(400).json({ message: 'Empresa não identificada para o stream.' });
  }

  // Proteção própria de conexão longa (o SSE não passa pelo rate limiter HTTP):
  // limita streams simultâneos por usuário e por empresa. Excedeu → 429 (não abre).
  const acq = conns.tryAcquire(userId, empresaId);
  if (!acq.ok) {
    return res.status(429).json({ message: 'Muitas conexões em tempo real abertas. Feche outras abas/dispositivos e tente novamente.' });
  }

  // Filtro opcional por frete (reduz ruído; a autoridade continua no backend).
  const freteFiltro = req.query && req.query.frete_id ? String(req.query.frete_id) : null;

  // Headers SSE. X-Accel-Buffering:no evita buffering em proxies (Railway/nginx).
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Sugere o intervalo de reconnect do EventSource e abre o stream.
  res.write('retry: 3000\n\n');
  res.write(': conectado\n\n');

  const enviar = (evento) => {
    if (!evento) return;
    if (freteFiltro && evento.freight_id && String(evento.freight_id) !== freteFiltro) return;
    try {
      res.write(`id: ${evento.event_id}\n`);
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    } catch (_) { /* conexão caindo: o close cuida do cleanup */ }
  };

  const unsubscribe = bus.subscribe(empresaId, enviar);

  const heartbeat = setInterval(() => {
    try { res.write(`: hb ${Date.now()}\n\n`); }
    catch (_) { /* idem */ }
  }, HEARTBEAT_MS);

  let encerrado = false;
  const encerrar = () => {
    if (encerrado) return;
    encerrado = true;
    clearInterval(heartbeat);
    unsubscribe();
    conns.release(userId, empresaId); // libera a vaga de conexão
    try { res.end(); } catch (_) { /* já encerrado */ }
  };

  req.on('close', encerrar);
  req.on('error', encerrar);
  res.on('error', encerrar);
}

// Observabilidade sem PII (só cardinalidades). Restrito a super-admin.
function stats(req, res) {
  if (!(req.user && req.user.is_super_admin === true)) {
    return res.status(403).json({ message: 'Acesso restrito.' });
  }
  return res.status(200).json(conns.stats());
}

module.exports = { stream, stats };

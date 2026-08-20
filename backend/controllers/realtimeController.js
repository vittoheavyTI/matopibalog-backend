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

const HEARTBEAT_MS = 25000; // < timeouts de proxy/idle comuns; barato

function stream(req, res) {
  const empresaId = req.empresa_id || null;
  if (!empresaId) {
    // Sem empresa resolvida não há canal seguro para assinar (ex.: super-admin sem
    // ?empresa_id=). Não assinamos "tudo" — isolamento de tenant é inegociável.
    return res.status(400).json({ message: 'Empresa não identificada para o stream.' });
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
    try { res.end(); } catch (_) { /* já encerrado */ }
  };

  req.on('close', encerrar);
  req.on('error', encerrar);
  res.on('error', encerrar);
}

module.exports = { stream };

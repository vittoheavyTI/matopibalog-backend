import { useEffect, useRef } from 'react';
import api from '../api';

// Evento mínimo do stream SSE (o mesmo envelope publicado pelo backend). O cliente
// usa isto só para saber "algo mudou" e então REFAZER o fetch canônico.
export type LancamentoEvento = {
  type: string;
  empresa_id?: string;
  entity_type?: string;
  entity_id?: string;
  freight_id?: string | null;
  version?: number | null;
  occurred_at?: string;
  [k: string]: unknown;
};

/**
 * Assina o stream SSE autenticado do backend (GET /realtime/stream) e chama `onSync`
 * a cada evento — e também ao (re)conectar e ao a aba voltar a ficar visível — para o
 * componente refazer o fetch do estado canônico. Sem EventSource (não permite header
 * Authorization): usamos fetch + ReadableStream, enviando Bearer + cookie.
 *
 * Robustez (contrato da Onda 1): reconnect com backoff; refetch no reconnect e no
 * visibilitychange; AbortController no cleanup (sem listener duplicado/leak). O SSE é
 * canal SECUNDÁRIO: um evento perdido nunca deixa a tela permanentemente errada porque
 * o reconnect/visibility forçam o refetch canônico.
 */
export function useLancamentosRealtime(
  onSync: (ev: LancamentoEvento) => void,
  opts?: { freteId?: string | null; enabled?: boolean },
): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const freteId = opts?.freteId ?? null;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let tentativa = 0;
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');

    async function conectar(): Promise<void> {
      if (stopped) return;
      controller = new AbortController();
      let token: string | null = null;
      try { token = localStorage.getItem('auth_token'); } catch { token = null; }
      const url = `${base}/realtime/stream${freteId ? `?frete_id=${encodeURIComponent(freteId)}` : ''}`;
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          credentials: 'include',
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) throw new Error(`sse_${resp.status}`);
        tentativa = 0;
        // (Re)conexão OK → refetch canônico (fecha qualquer gap desde a última leitura).
        onSyncRef.current({ type: '__reconnect__' });
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dados = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!dados) continue; // heartbeat/comentário (linha ':') → ignora
            try { onSyncRef.current(JSON.parse(dados) as LancamentoEvento); } catch { /* frame inválido */ }
          }
        }
      } catch { /* rede/abort/401: reconecta com backoff abaixo */ }
      if (stopped) return;
      tentativa = Math.min(tentativa + 1, 6);
      const espera = Math.min(1000 * 2 ** tentativa, 15000);
      await new Promise((r) => setTimeout(r, espera));
      if (!stopped) void conectar();
    }

    void conectar();

    const onVis = () => {
      if (document.visibilityState === 'visible') onSyncRef.current({ type: '__visible__' });
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopped = true;
      try { controller?.abort(); } catch { /* noop */ }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [freteId, enabled]);
}

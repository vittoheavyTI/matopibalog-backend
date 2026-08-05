import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Reducer } from 'react';
import {
  estadoInicial, reduzir, derivarView, classificarErro, ehErroRetriavel,
  type EstadoCarregamento, type Evento,
} from '../utils/estadoCarregamento';

export interface OpcoesCarregamento {
  retries?: number;             // nº máx. de RE-tentativas automáticas (default 2)
  backoffMs?: number[];         // atraso por tentativa (default [1000, 3000])
  pollingMs?: number;           // atualização periódica (default 0 = desligado)
  refetchOnFocus?: boolean;     // revalida ao voltar à aba (default true)
  refetchOnReconnect?: boolean; // revalida ao reconectar (default true)
}

// Retry-After (segundos) do 429, se presente. Retorna ms ou undefined.
function lerRetryAfterMs(erro: any): number | undefined {
  const h = erro?.response?.headers?.['retry-after'] ?? erro?.response?.headers?.['Retry-After'];
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, 60000) : undefined;
}

// Hook de carregamento de LISTAS com:
//   - estados distintos (loading/sucesso/vazio/erro) + stale-while-revalidate;
//   - AbortController + stale-guard (resposta antiga não sobrescreve a nova);
//   - RETRY automático de GET idempotente (rede/timeout/5xx/429) com backoff+jitter;
//   - atualização automática: foco/visibilidade, reconexão e polling opcional —
//     tudo suspenso com aba oculta, offline, desmontado ou já com chamada em voo.
// Mutações (POST/PUT/PATCH/DELETE/upload) NÃO usam este hook → nunca têm retry.
export function useCarregamento<T>(
  fetcher: (signal: AbortSignal) => Promise<T[]>,
  deps: unknown[] = [],
  opcoes: OpcoesCarregamento = {},
) {
  const { retries = 2, backoffMs = [1000, 3000], pollingMs = 0, refetchOnFocus = true, refetchOnReconnect = true } = opcoes;

  const [estado, dispatch] = useReducer(
    reduzir as unknown as Reducer<EstadoCarregamento<T[]>, Evento<T>>,
    undefined,
    () => estadoInicial<T[]>(),
  );

  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montadoRef = useRef(true);
  const emVooRef = useRef(false); // impede chamadas equivalentes concorrentes

  const limparTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const executar = useCallback(() => {
    if (abortRef.current) abortRef.current.abort(); // cancela a anterior em voo
    limparTimer();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    emVooRef.current = true;

    const tentar = (n: number) => {
      dispatch({ tipo: 'iniciar', reqId });
      fetcherRef.current(ctrl.signal)
        .then((dados) => { emVooRef.current = false; dispatch({ tipo: 'sucesso', reqId, dados: (dados || []) as T[] }); })
        .catch((erro) => {
          const cls = classificarErro(erro);
          // Observabilidade sanitizada (só DEV): categoria + tentativa. NUNCA token,
          // payload, dados pessoais ou Authorization.
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug('[carregamento] falha', { categoria: 'cancelado' in cls ? 'cancelado' : cls.tipo, tentativa: n });
          }
          if ('cancelado' in cls) { emVooRef.current = false; dispatch({ tipo: 'falha', reqId, erro }); return; } // reducer ignora
          const podeRetry = n < retries && ehErroRetriavel(cls) && !ctrl.signal.aborted && montadoRef.current;
          if (podeRetry) {
            const base = backoffMs[Math.min(n, backoffMs.length - 1)] ?? 1000;
            const delay = lerRetryAfterMs(erro) ?? (base + Math.floor(Math.random() * 300)); // jitter
            timerRef.current = setTimeout(() => { if (!ctrl.signal.aborted && montadoRef.current) tentar(n + 1); }, delay);
          } else {
            emVooRef.current = false;
            dispatch({ tipo: 'falha', reqId, erro });
          }
        });
    };
    tentar(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Carga inicial + quando as deps mudam.
  useEffect(() => {
    montadoRef.current = true;
    executar();
    return () => { montadoRef.current = false; if (abortRef.current) abortRef.current.abort(); limparTimer(); };
  }, [executar]);

  // Revalidação discreta (foco/reconexão/polling): só quando visível, online e
  // sem chamada equivalente em andamento.
  const revalidar = useCallback(() => {
    if (emVooRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    executar();
  }, [executar]);

  useEffect(() => {
    if (!refetchOnFocus && !refetchOnReconnect && !pollingMs) return;
    const onFoco = () => { if (refetchOnFocus && document.visibilityState === 'visible') revalidar(); };
    const onOnline = () => { if (refetchOnReconnect) revalidar(); };
    if (refetchOnFocus) { document.addEventListener('visibilitychange', onFoco); window.addEventListener('focus', onFoco); }
    if (refetchOnReconnect) window.addEventListener('online', onOnline);
    const intervalo = pollingMs && pollingMs > 0 ? setInterval(() => { revalidar(); }, pollingMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', onFoco);
      window.removeEventListener('focus', onFoco);
      window.removeEventListener('online', onOnline);
      if (intervalo) clearInterval(intervalo);
    };
  }, [revalidar, refetchOnFocus, refetchOnReconnect, pollingMs]);

  return {
    estado,
    view: derivarView(estado),
    recarregar: executar,
    tentarNovamente: executar,
    revalidar,
  };
}

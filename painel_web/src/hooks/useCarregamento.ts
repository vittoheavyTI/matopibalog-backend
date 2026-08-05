import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Reducer } from 'react';
import {
  estadoInicial, reduzir, derivarView,
  type EstadoCarregamento, type Evento,
} from '../utils/estadoCarregamento';

// Hook de carregamento de LISTAS com estados distintos (loading/sucesso/vazio/erro),
// AbortController (cancela ao desmontar/rerequisitar), stale-guard (resposta antiga
// não sobrescreve a nova) e "tentar novamente".
//
// O `fetcher` recebe um AbortSignal e deve devolver um array. Ex.:
//   useCarregamento((signal) => api.get('/x', { signal }).then(r => r.data || []), [dep])
//
// Cancelamento (navegação/desmontagem) NÃO vira erro/toast — o reducer ignora.
export function useCarregamento<T>(
  fetcher: (signal: AbortSignal) => Promise<T[]>,
  deps: unknown[] = [],
) {
  const [estado, dispatch] = useReducer(
    reduzir as unknown as Reducer<EstadoCarregamento<T[]>, Evento<T>>,
    undefined,
    () => estadoInicial<T[]>(),
  );

  // fetcher sempre atual (evita re-executar por mudança de identidade da função).
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const executar = useCallback(() => {
    if (abortRef.current) abortRef.current.abort(); // cancela a anterior em voo
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    dispatch({ tipo: 'iniciar', reqId });
    fetcherRef.current(ctrl.signal)
      .then((dados) => dispatch({ tipo: 'sucesso', reqId, dados: (dados || []) as T[] }))
      .catch((erro) => dispatch({ tipo: 'falha', reqId, erro }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    executar();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [executar]);

  return {
    estado,
    view: derivarView(estado),
    recarregar: executar,
    tentarNovamente: executar,
  };
}

import { describe, test, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCarregamento } from './useCarregamento';

describe('useCarregamento (integração hook + reducer)', () => {
  test('loading inicial → sucesso com dados', async () => {
    const fetcher = vi.fn(async () => [1, 2, 3]);
    const { result } = renderHook(() => useCarregamento<number>(fetcher, []));
    expect(result.current.view.mostrarLoading).toBe(true);
    await waitFor(() => expect(result.current.estado.status).toBe('sucesso'));
    expect(result.current.estado.dados).toEqual([1, 2, 3]);
  });

  test('erro mostra estado de erro e NÃO estado vazio', async () => {
    const fetcher = vi.fn(async () => { throw { response: { status: 403 } }; }); // 403 = não-retriável → erro imediato
    const { result } = renderHook(() => useCarregamento<number>(fetcher, []));
    await waitFor(() => expect(result.current.view.mostrarErro).toBe(true));
    expect(result.current.view.mostrarVazio).toBe(false);
    expect(result.current.view.podeTentarNovamente).toBe(true);
  });

  test('array vazio → estado vazio (diferente de erro)', async () => {
    const fetcher = vi.fn(async () => []);
    const { result } = renderHook(() => useCarregamento<number>(fetcher, []));
    await waitFor(() => expect(result.current.view.mostrarVazio).toBe(true));
    expect(result.current.view.mostrarErro).toBe(false);
  });

  test('tentarNovamente refaz a chamada e recupera', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => { n += 1; if (n === 1) throw { response: { status: 403 } }; return [7]; }); // 403 não auto-retenta
    const { result } = renderHook(() => useCarregamento<number>(fetcher, []));
    await waitFor(() => expect(result.current.view.mostrarErro).toBe(true));
    act(() => { result.current.tentarNovamente(); });
    await waitFor(() => expect(result.current.estado.status).toBe('sucesso'));
    expect(result.current.estado.dados).toEqual([7]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('stale-guard: resposta antiga não sobrescreve a nova (deps mudam)', async () => {
    const resolvers: Array<(v: number[]) => void> = [];
    const fetcher = vi.fn(() => new Promise<number[]>((res) => { resolvers.push(res); }));
    const { result, rerender } = renderHook(({ d }) => useCarregamento<number>(fetcher, [d]), { initialProps: { d: 1 } });
    rerender({ d: 2 }); // dispara a segunda requisição
    await waitFor(() => expect(resolvers.length).toBe(2));
    resolvers[1]([2]); // a NOVA resolve primeiro
    await waitFor(() => expect(result.current.estado.dados).toEqual([2]));
    resolvers[0]([1]); // a ANTIGA resolve depois
    await act(async () => { await Promise.resolve(); });
    expect(result.current.estado.dados).toEqual([2]); // manteve a mais nova
  });

  test('auto-retry: falha transitória (5xx) recupera SEM retry manual', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => { n += 1; if (n < 3) throw { response: { status: 500 } }; return [7]; });
    const { result } = renderHook(() => useCarregamento<number>(fetcher, [], { backoffMs: [1, 1] }));
    await waitFor(() => expect(result.current.estado.status).toBe('sucesso'), { timeout: 3000 });
    expect(result.current.estado.dados).toEqual([7]);
    expect(fetcher).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retries
  });

  test('auto-retry esgotado → estado de erro (nunca vazio)', async () => {
    const fetcher = vi.fn(async () => { throw { response: { status: 503 } }; });
    const { result } = renderHook(() => useCarregamento<number>(fetcher, [], { backoffMs: [1, 1] }));
    await waitFor(() => expect(result.current.view.mostrarErro).toBe(true), { timeout: 3000 });
    expect(result.current.view.mostrarVazio).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test('401/403/404 NÃO fazem retry (erro imediato)', async () => {
    const fetcher = vi.fn(async () => { throw { response: { status: 401 } }; });
    const { result } = renderHook(() => useCarregamento<number>(fetcher, [], { backoffMs: [1, 1] }));
    await waitFor(() => expect(result.current.view.mostrarErro).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('revalidar NÃO duplica quando há chamada equivalente em voo', async () => {
    let resolver: (v: number[]) => void = () => {};
    const fetcher = vi.fn(() => new Promise<number[]>((r) => { resolver = r; }));
    const { result } = renderHook(() => useCarregamento<number>(fetcher, []));
    expect(fetcher).toHaveBeenCalledTimes(1); // carga inicial em voo
    act(() => { result.current.revalidar(); }); // deve ser ignorada (em voo)
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolver([1]);
    await waitFor(() => expect(result.current.estado.status).toBe('sucesso'));
  });
});

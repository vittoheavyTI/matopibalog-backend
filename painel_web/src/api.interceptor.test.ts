import { describe, test, expect } from 'vitest';
import {
  aguardarTokenPublicadoAposColisao,
  avaliarErroResposta,
  classificarFalhaRefreshWeb,
  podeTentarRefresh,
} from './api';

// Decisão pura do interceptor de resposta (comportamento de sessão/rate-limit).
// Erros SEM resposta (timeout/cancelamento) não passam por esta função — o
// interceptor só a chama quando há `response` — logo NUNCA deslogam nem fazem retry.
describe('avaliarErroResposta (interceptor)', () => {
  test('21. 401 → sessão expirada (logout)', () => {
    expect(avaliarErroResposta({ status: 401 }).sessaoExpirada).toBe(true);
  });

  test('22. 403 com token inválido/expirado → sessão expirada', () => {
    expect(avaliarErroResposta({ status: 403, tokenExpiradoInvalido: true }).sessaoExpirada).toBe(true);
  });

  test('23. 403 comum (permissão/negócio) → NÃO desloga', () => {
    expect(avaliarErroResposta({ status: 403, tokenExpiradoInvalido: false }).sessaoExpirada).toBe(false);
  });

  test('24. 429 → rate limited e NÃO desloga', () => {
    const r = avaliarErroResposta({ status: 429 });
    expect(r.rateLimited).toBe(true);
    expect(r.sessaoExpirada).toBe(false);
  });

  test('401 em rota de auth NÃO desloga (evita loop de logout)', () => {
    expect(avaliarErroResposta({ status: 401, url: '/auth/me' }).sessaoExpirada).toBe(false);
  });

  test('401 na tela de login NÃO desloga', () => {
    expect(avaliarErroResposta({ status: 401, pathname: '/login' }).sessaoExpirada).toBe(false);
  });

  test('20/25. status de servidor (500) não desloga; timeout/cancelamento nem chegam aqui', () => {
    // 500 tem resposta mas não é sessão expirada nem rate limit.
    const r = avaliarErroResposta({ status: 500 });
    expect(r.sessaoExpirada).toBe(false);
    expect(r.rateLimited).toBe(false);
  });
});

describe('refresh web SEC-1 — colisao entre abas', () => {
  test('RefreshAlreadyRotated e recuperavel, nao definitivo', () => {
    expect(classificarFalhaRefreshWeb(409, 'RefreshAlreadyRotated')).toBe('collision');
    expect(classificarFalhaRefreshWeb(401, 'RefreshReuseDetected')).toBe('definitive');
    expect(classificarFalhaRefreshWeb(409, 'SessionConflict')).toBe('transient');
    expect(classificarFalhaRefreshWeb(409, 'Outro409')).toBe('invalid_response');
  });

  test('duas abas: perdedora relê o novo access publicado pela vencedora', async () => {
    const leituras = ['access-antigo', 'access-novo'];
    let chamadas = 0;
    const token = await aguardarTokenPublicadoAposColisao(
      'access-antigo',
      () => leituras[Math.min(chamadas++, leituras.length - 1)],
      async () => {},
    );

    expect(token).toBe('access-novo');
    expect(chamadas).toBe(2);
  });

  test('RefreshAlreadyRotated sem token novo tem releituras limitadas e nao limpa sessao', async () => {
    let chamadas = 0;
    const token = await aguardarTokenPublicadoAposColisao(
      'access-antigo',
      () => {
        chamadas++;
        return 'access-antigo';
      },
      async () => {},
    );

    expect(token).toBeNull();
    expect(chamadas).toBe(3);
  });
});

describe('podeTentarRefresh (SEC-1)', () => {
  test('tenta refresh para GET 401 uma única vez', () => {
    expect(podeTentarRefresh({ status: 401, url: '/auth/me', method: 'get' })).toBe(true);
    expect(podeTentarRefresh({ status: 401, url: '/auth/me', method: 'get', jaTentou: true })).toBe(false);
  });

  test('não tenta refresh em POST arbitrário nem nas rotas de refresh/login', () => {
    expect(podeTentarRefresh({ status: 401, url: '/fretes', method: 'post' })).toBe(false);
    expect(podeTentarRefresh({ status: 401, url: '/auth/refresh', method: 'post' })).toBe(false);
    expect(podeTentarRefresh({ status: 401, url: '/auth/login', method: 'post' })).toBe(false);
  });

  test('403 só tenta refresh quando representa sessão/token inválido', () => {
    expect(podeTentarRefresh({ status: 403, tokenExpiradoInvalido: true, url: '/dashboard', method: 'get' })).toBe(true);
    expect(podeTentarRefresh({ status: 403, tokenExpiradoInvalido: false, url: '/dashboard', method: 'get' })).toBe(false);
  });
});

import axios from 'axios';
import { registrarMotivoSessao } from './utils/sessionReason';
import { montarHeadersContextoOperacional } from './utils/operationalContextStorage';

const api = axios.create({
  // Tente adicionar o /api no final do baseURL se suas rotas do backend usam /api
  baseURL: import.meta.env.VITE_API_URL || 'https://api.matopibalog.com.br',
  withCredentials: true,
  // Timeout de rede: sem ele, uma requisição travada (rede/backend lento) nunca
  // rejeita e o `finally` da página nunca roda → loader infinito. 30s é folgado
  // para as consultas do painel; só rejeita o que de fato travou (vira estado de
  // erro recuperável, não logout). NÃO altera validateStatus (304 é convertido
  // pelo navegador em 200 — o axios nunca vê 304).
  timeout: 30000,
});

// Envia Authorization: Bearer <token> em todas as requisições quando presente
api.interceptors.request.use((config) => {
  try {
    const url = String(config.url || '');
    if (url.includes('/auth/refresh')) {
      if (config.headers) delete (config.headers as any).Authorization;
      return config;
    }
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
    // E1.6A: assinatura de CONTRATO NOVO (web) — só nos endpoints de lançamento, onde o
    // backend a usa (ex.: observação obrigatória). NÃO enviamos em auth/demais rotas para
    // não introduzir header custom (e preflight CORS) fora do necessário. O APK legado
    // não envia o header e mantém compatibilidade transitória.
    if (/^\/(despesas|abastecimentos|vales)\b/.test(url)) {
      config.headers = config.headers || {};
      (config.headers as any)['X-Client-Platform'] = 'web';
    }
    const operationalHeaders = montarHeadersContextoOperacional();
    for (const [key, value] of Object.entries(operationalHeaders)) {
      config.headers = config.headers || {};
      (config.headers as any)[key] = value;
    }
  } catch (e) {
    // ignore
  }
  return config;
});

// Decodifica o payload de um JWT no formato base64url, sem dependência externa e
// SEM logar o token. Retorna o objeto do payload ou null se não decodificar.
export function decodificarPayloadJwt(token: string): any | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const resto = b64.length % 4;
    if (resto) b64 += '='.repeat(4 - resto);
    return JSON.parse(atob(b64));
  } catch (e) {
    return null;
  }
}

// Determina se o encerramento foi por token EXPIRADO (exp já passou) ou por token
// INVÁLIDO/ausente. O backend não distingue os dois no 403, então inferimos aqui a
// partir do `exp` do JWT em localStorage — lendo APENAS o campo exp, nunca o token.
function motivoPorToken(): 'expired' | 'invalid' {
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) return 'invalid'; // 401 sem token
    const payload = decodificarPayloadJwt(token);
    if (payload && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return 'expired';
    }
    return 'invalid';
  } catch (e) {
    return 'invalid';
  }
}

// Flag de módulo para não disparar 'auth:unauthorized' em duplicidade quando
// várias requisições falham ao mesmo tempo. Uma resposta 2xx (ex.: novo login)
// rearma naturalmente o disparo.
let encerrando = false;
type ResultadoRefresh =
  | { kind: 'success'; token: string }
  | { kind: 'collision'; token: string | null }
  | { kind: 'definitive' }
  | { kind: 'transient' }
  | { kind: 'invalid_response' };

let refreshEmAndamento: Promise<ResultadoRefresh> | null = null;
// Debounce do aviso de 429 (rate limit) para não floodar a UI quando várias
// requisições/polling batem no limite ao mesmo tempo.
let ultimoAviso429 = 0;

// Interceptor de resposta: avisa o sistema quando a SESSÃO expira, para acionar o
// logout automático (AuthContext escuta 'auth:unauthorized').
// - 401: comportamento original (sessão sem token / não autenticada).
// - 403 com body { error: 'Token inválido ou expirado.' }: o backend (auth.js)
//   devolve ESSE 403 específico quando o JWT expira/é inválido. Sem isto a sessão
//   expirava silenciosamente (a tela travava sem deslogar). Os demais 403 (permissão/
//   negócio) usam a chave `message`, então NÃO são tratados como logout.
// Antes de disparar o evento, registra o motivo (expired/invalid) em sessionStorage
// para o Login exibir a mensagem correta. Registro é "soft": não sobrescreve um
// motivo já definido por um fluxo explícito (idle/manual).
// Decisão PURA e testável do tratamento de um erro de RESPOSTA (com status HTTP).
// Isolada para poder ser testada sem simular todo o axios. Regras:
//   - 401, ou 403 com token expirado/inválido → sessão expirada (logout), EXCETO
//     nas rotas de auth e na própria tela de login;
//   - 429 → rate limited (NÃO é logout);
//   - demais 403 (permissão/negócio) e outros status → nenhuma ação especial.
// Erros SEM resposta (timeout/cancelamento/rede) NÃO passam por aqui → nunca
// disparam logout nem retry.
export function avaliarErroResposta(
  { status, tokenExpiradoInvalido = false, url = '', pathname = '' }:
  { status: number; tokenExpiradoInvalido?: boolean; url?: string; pathname?: string },
): { sessaoExpirada: boolean; rateLimited: boolean } {
  const isAuthRoute = url.includes('/auth/me') || url.includes('/auth/login');
  const naTelaLogin = pathname === '/login';
  const sessaoExpirada = (status === 401 || (status === 403 && tokenExpiradoInvalido)) && !isAuthRoute && !naTelaLogin;
  return { sessaoExpirada, rateLimited: status === 429 };
}

export function podeTentarRefresh({ status, tokenExpiradoInvalido = false, url = '', method = 'get', jaTentou = false }:
  { status: number; tokenExpiradoInvalido?: boolean; url?: string; method?: string; jaTentou?: boolean },
): boolean {
  if (jaTentou) return false;
  if (url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/mobile/refresh')) return false;
  const metodoSeguro = ['get', 'head', 'options'].includes(method.toLowerCase());
  if (!metodoSeguro) return false;
  return status === 401 || (status === 403 && tokenExpiradoInvalido);
}

const refreshDefinitivo = new Set([
  'RefreshReuseDetected',
  'RefreshInvalid',
  'RefreshExpired',
  'RefreshRevoked',
  'SessionInvalid',
  'SessionNotFound',
  'SessionRevoked',
  'SessionIdleExpired',
  'SessionAbsoluteExpired',
]);

export function classificarFalhaRefreshWeb(status: number, error?: string): ResultadoRefresh['kind'] {
  if (error === 'RefreshAlreadyRotated') return 'collision';
  if (refreshDefinitivo.has(String(error || ''))) return 'definitive';
  if (error === 'SessionConflict') return 'transient';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (status === 401 || status === 403) return 'definitive';
  return 'invalid_response';
}

export async function aguardarTokenPublicadoAposColisao(
  tokenAntes: string | null,
  lerToken: () => string | null = () => localStorage.getItem('auth_token'),
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string | null> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const tokenAtual = lerToken();
    if (tokenAtual && tokenAtual !== tokenAntes) return tokenAtual;
    if (tentativa < 2) await esperar(40);
  }
  return null;
}

async function renovarAccessToken(): Promise<ResultadoRefresh> {
  if (!refreshEmAndamento) {
    const tokenAntes = localStorage.getItem('auth_token');
    refreshEmAndamento = api.post('/auth/refresh', undefined, { headers: {}, _sec1Refresh: true } as any)
      .then((res) => {
        const token = res.data?.token;
        if (typeof token === 'string' && token.length > 0) {
          localStorage.setItem('auth_token', token);
          return { kind: 'success', token } as ResultadoRefresh;
        }
        return { kind: 'invalid_response' } as ResultadoRefresh;
      })
      .catch(async (err) => {
        const status = err?.response?.status ?? 0;
        const error = err?.response?.data?.error;
        const kind = classificarFalhaRefreshWeb(status, error);
        if (kind === 'collision') {
          const token = await aguardarTokenPublicadoAposColisao(tokenAntes);
          return { kind: 'collision', token } as ResultadoRefresh;
        }
        return { kind } as ResultadoRefresh;
      })
      .finally(() => { refreshEmAndamento = null; });
  }
  return refreshEmAndamento;
}

api.interceptors.response.use((response) => {
  encerrando = false;
  return response;
}, async (error) => {
  const response = error.response;
  // Sem resposta = timeout (ECONNABORTED) / cancelamento (ERR_CANCELED) / rede.
  // NÃO desloga, NÃO faz retry — apenas rejeita para a página tratar como erro
  // recuperável (ou, no caso de cancelamento, ser ignorado pelo hook/reducer).
  if (response) {
    const data: any = response.data;
    const config: any = error.config || {};
    const tokenExpiradoInvalido = data?.error === 'Token inválido ou expirado.'
      || data?.error === 'SessionNotFound'
      || data?.error === 'SessionRevoked'
      || data?.error === 'SessionIdleExpired'
      || data?.error === 'SessionAbsoluteExpired'
      || data?.error === 'SessionInvalid';
    if (!config._sec1Refresh && podeTentarRefresh({
      status: response.status,
      tokenExpiradoInvalido,
      url: config.url ?? '',
      method: config.method ?? 'get',
      jaTentou: config._sec1Retry === true,
    })) {
      const refresh = await renovarAccessToken();
      if (refresh.kind === 'success' || (refresh.kind === 'collision' && refresh.token)) {
        const novoToken = refresh.token;
        config._sec1Retry = true;
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${novoToken}`;
        return api.request(config);
      }
      if (refresh.kind === 'collision' || refresh.kind === 'transient') {
        config._sec1RefreshRecoverable = true;
      }
    }
    const { sessaoExpirada, rateLimited } = avaliarErroResposta({
      status: response.status,
      tokenExpiradoInvalido,
      url: error.config?.url ?? '',
      pathname: (typeof window !== 'undefined' && window.location?.pathname) || '',
    });
    if (sessaoExpirada && !encerrando && !config._sec1RefreshRecoverable) {
      encerrando = true;
      registrarMotivoSessao(motivoPorToken());
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    // 429 (rate limit): NÃO desloga, NÃO apaga token. Só avisa (debounced).
    if (rateLimited) {
      const agora = Date.now();
      if (agora - ultimoAviso429 > 10000) {
        ultimoAviso429 = agora;
        const msg = (data && data.message) || 'Muitas requisições. Aguarde alguns minutos e tente novamente.';
        window.dispatchEvent(new CustomEvent('api:rate-limited', { detail: { message: msg } }));
      }
    }
  }
  return Promise.reject(error);
});

/**
 * Gera um identificador único por tentativa de envio, usado para idempotência de
 * lançamentos (despesa/abastecimento/vale). O backend deduplica por
 * (motorista_id, client_request_id), então o mesmo envio/retry deve reusar o
 * mesmo id e um novo lançamento deve receber um id novo.
 *
 * Sem dependência externa: usa crypto.randomUUID() quando disponível (contexto
 * seguro/HTTPS) e cai para um UUID v4 montado com crypto.getRandomValues.
 */
export function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Versão (4) e variante (10xx) conforme RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default api;

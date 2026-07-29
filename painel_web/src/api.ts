import axios from 'axios';
import { registrarMotivoSessao } from './utils/sessionReason';

const api = axios.create({
  // Tente adicionar o /api no final do baseURL se suas rotas do backend usam /api
  baseURL: import.meta.env.VITE_API_URL || 'https://matopibalog-backend-production.up.railway.app',
  withCredentials: false, // Não depender de cookie; usaremos Bearer token em Authorization
});

// Envia Authorization: Bearer <token> em todas as requisições quando presente
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
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
api.interceptors.response.use((response) => {
  encerrando = false;
  return response;
}, (error) => {
  const response = error.response;
  if (response) {
    const url: string = error.config?.url ?? '';
    const data: any = response.data;
    const isAuthRoute = url.includes('/auth/me') || url.includes('/auth/login');
    const sessaoExpirada =
      response.status === 401 ||
      (response.status === 403 && data?.error === 'Token inválido ou expirado.');
    const naTelaLogin =
      typeof window !== 'undefined' && window.location?.pathname === '/login';
    if (sessaoExpirada && !isAuthRoute && !naTelaLogin && !encerrando) {
      encerrando = true;
      registrarMotivoSessao(motivoPorToken());
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    // 429 (rate limit) NÃO é sessão expirada: NÃO desloga, NÃO apaga token.
    // Só avisa (debounced) para a UI mostrar a mensagem certa. A sessão segue viva.
    if (response.status === 429) {
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

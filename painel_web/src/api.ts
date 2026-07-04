import axios from 'axios';

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

// Interceptor de resposta: avisa o sistema quando a SESSÃO expira, para acionar o
// logout automático (AuthContext escuta 'auth:unauthorized').
// - 401: comportamento original (sessão sem token / não autenticada).
// - 403 com body { error: 'Token inválido ou expirado.' }: o backend (auth.js)
//   devolve ESSE 403 específico quando o JWT expira/é inválido. Sem isto a sessão
//   expirava silenciosamente (a tela travava sem deslogar). Os demais 403 (permissão/
//   negócio) usam a chave `message`, então NÃO são tratados como logout.
api.interceptors.response.use((response) => {
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
    if (sessaoExpirada && !isAuthRoute) {
      window.dispatchEvent(new Event('auth:unauthorized'));
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
